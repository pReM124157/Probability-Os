import cron from "node-cron";
import supabase from "../services/supabase.service.js";
import { runMorningBriefing } from "../scanner/morningScheduler.js";

import { runRiskAgent } from "../agents/risk.agent.js";
import { analyzePortfolio as runPortfolioAgent } from "../agents/portfolioAgent.js";
import { runRebalancingAgent } from "../agents/rebalancing.agent.js";

import { sendTelegramAlert } from "../services/alert.service.js";
import { sendEmail, sendEmailAlert } from "../services/email.service.js";
import { updatePerformanceTracking } from "../agents/performanceTracker.agent.js";

import { masterAgent } from "../agents/master.agent.js";
import {
  claimAlertDelivery,
  finalizeAlertDelivery,
  releaseAlertDeliveryClaim,
  saveAlert
} from "../services/alertMemory.service.js";
import bot from "../services/telegram.service.js";
import { buildAnalysisContext } from "../core/analysisContext.js";
import { runWithSchedulerLease } from "../services/schedulerLease.service.js";
import { createTraceId, logError, logEvent } from "../services/telemetry.service.js";

function buildMorningBriefingMessage(packet) {
  const reportText = packet?.report?.report || "Morning briefing unavailable.";
  return [
    "FinSight Pro Morning Briefing",
    "",
    reportText,
    "",
    "Educational only. Not SEBI-registered investment advice."
  ].join("\n");
}

export const runPortfolioMonitor = async (leaseContext = {}) => {
  const traceId = createTraceId("portfolio_monitor");
  logEvent("portfolio_monitor.started", { traceId });
  const { data: holdings, error } = await supabase
    .from("holdings")
    .select("*");
  if (error || !holdings?.length) {
    logEvent("portfolio_monitor.no_holdings", { traceId });
    return;
  }
  for (const holding of holdings) {
    try {
      leaseContext.assertLease?.();
      const { stockData } = await buildAnalysisContext(holding.symbol);
      const result = await masterAgent(stockData, { strictValidation: true });
      const exitSignal = result.exitSignal || {};
      const eventRisk = result.eventRisk || {};
      
      const isUrgent =
        exitSignal.signal === "STOP LOSS EXIT" ||
        exitSignal.signal === "FULL EXIT" ||
        (
          exitSignal.signal === "TRIM POSITION" &&
          exitSignal.urgency === "HIGH"
        ) ||
        (
          eventRisk.riskLevel === "HIGH" &&
          eventRisk.eventType === "EARNINGS RESULT"
        );

      if (!isUrgent) continue;
      const alertType = exitSignal.signal || eventRisk.eventType;

      const claim = await claimAlertDelivery(
        holding.chat_id,
        holding.symbol,
        alertType,
        { traceId }
      );
      if (!claim.claimed) continue;

      const message = `
🚨 URGENT PORTFOLIO ALERT
📈 Stock: ${holding.symbol}
⚠ Alert Type: ${alertType}
🔥 Urgency: ${exitSignal.urgency || eventRisk.riskLevel}
📌 Action Required:
${exitSignal.action || eventRisk.action}
🧠 Reason:
${exitSignal.reason || eventRisk.reason}
⚠ Immediate review recommended.
`.trim();

      try {
        await bot.telegram.sendMessage(
          holding.chat_id,
          message
        );
        await sendEmail({
          subject: `URGENT PORTFOLIO ALERT — ${holding.symbol}`,
          text: message
        });
        await finalizeAlertDelivery(
          holding.chat_id,
          holding.symbol,
          alertType,
          claim.ownerId,
          traceId
        );
        await saveAlert(
          holding.chat_id,
          holding.symbol,
          alertType
        );
        logEvent("portfolio_monitor.alert_sent", {
          traceId,
          chatId: holding.chat_id,
          symbol: holding.symbol,
          alertType
        });
      } catch (deliveryError) {
        try {
          await releaseAlertDeliveryClaim(
            holding.chat_id,
            holding.symbol,
            alertType,
            claim.ownerId,
            traceId
          );
        } catch (releaseError) {
          logError("portfolio_monitor.alert_release_error", releaseError, {
            traceId,
            chatId: holding.chat_id,
            symbol: holding.symbol,
            alertType
          });
        }
        throw deliveryError;
      }
    } catch (err) {
      logError("portfolio_monitor.holding_error", err, {
        traceId,
        symbol: holding.symbol
      });
    }
  }
  logEvent("portfolio_monitor.completed", { traceId });
};

export const startMonitoringJob = () => {
  console.log("🚀 Monitoring Job Started");

  // Portfolio Risk Monitor (8:00 AM)
  cron.schedule(
    "0 8 * * *",
    async () => {
      await runWithSchedulerLease("scheduler:portfolio_risk_monitor", async (leaseContext) => {
        await runPortfolioMonitor(leaseContext);
      }, {
        ttlSeconds: 20 * 60
      });
    },
    {
      timezone: "Asia/Kolkata"
    }
  );

  // Daily Performance Update Loop (Midnight)
  cron.schedule(
    "0 0 * * *",
    async () => {
      await runWithSchedulerLease("scheduler:daily_performance_update", async ({ traceId }) => {
        logEvent("scheduler.daily_performance_update.started", { traceId });
        const result = await updatePerformanceTracking();
        logEvent("scheduler.daily_performance_update.completed", {
          traceId,
          updated: result.updated
        });
      }).catch((error) => {
        logError("scheduler.daily_performance_update.error", error);
      });
    },
    {
      timezone: "Asia/Kolkata"
    }
  );

  cron.schedule(
    "30 8 * * *",
    async () => {
      await runWithSchedulerLease("scheduler:morning_scanner_alert", async ({ traceId }) => {
        logEvent("scheduler.morning_scanner_alert.started", { traceId });
        const packet = await runMorningBriefing();
        const message = buildMorningBriefingMessage(packet);
        
        await sendTelegramAlert(message);
        await sendEmailAlert(
          "FinSight Morning Scanner Report",
          message
        );
        logEvent("scheduler.morning_scanner_alert.completed", { traceId });
      }, {
        ttlSeconds: 30 * 60
      }).catch((error) => {
        logError("scheduler.morning_scanner_alert.error", error);
      });
    },
    {
      timezone: "Asia/Kolkata"
    }
  );
};

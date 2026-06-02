import cron from "node-cron";
import supabase from "../services/supabase.service.js";
import { Telegraf } from "telegraf";
import { isPro } from "../core/user.js";
import { runMorningBriefing } from "../scanner/morningScheduler.js";
import { runWithSchedulerLease } from "../services/schedulerLease.service.js";
import { logError, logEvent } from "../services/telemetry.service.js";
import { getMarketStateIST } from "../utils/time.js";
import { withSchedulerFailureIsolation } from "../utils/pipelineShape.js";
import { recordSchedulerSuccess, recordSchedulerFailure } from "../services/telemetryAggregator.service.js";

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
let dailyHookSchedulerStarted = false;

function isMorningBriefingEligible(user) {
  if (!user?.telegram_chat_id) return false;
  if (!isPro(user)) return false;

  const status = String(user.status || "").toLowerCase();
  if (status && !["active", "trialing"].includes(status)) {
    return false;
  }

  const expiry = user.expires_at || user.subscription_end;
  if (expiry && new Date(expiry) < new Date()) {
    return false;
  }

  return true;
}

function buildTelegramMorningMessage(packet) {
  const reportText = packet?.report?.report || "Morning briefing unavailable.";
  const marketState = getMarketStateIST();

  const parts = ["FinSight Pro Morning Briefing", ""];

  // Confidence state tag always present
  parts.push(`Confidence State: [${marketState.tag}]`, "");

  // Full market-closed notice when market is not live
  if (!marketState.open) {
    parts.push(
      "⚠️ MARKET STATUS NOTICE",
      "",
      "Indian markets are currently closed.",
      "All prices, institutional flows, volatility models, and scanner outputs are based on the latest available closing-session data and post-close processing.",
      "",
      "Intraday confirmations, liquidity shifts, breakout validations, and institutional participation strength can materially change after the next market open.",
      "",
      "Finsight AI does not execute trades automatically. All signals, watchlists, and institutional intelligence outputs are probabilistic decision-support insights and should be independently validated before taking any trading or investment action.",
      "",
      "Market Closed • Signals generated using latest available market data. Final trade confirmation requires live market validation after open.",
      ""
    );
  }

  parts.push(reportText, "", "Educational only. Not SEBI-registered investment advice.");
  return parts.join("\n");
}

export function startDailyHook() {
  if (dailyHookSchedulerStarted) {
    console.log("⏰ Morning Briefing Scheduler already started — skipping duplicate registration");
    return;
  }
  dailyHookSchedulerStarted = true;
  console.log("⏰ Morning Briefing Scheduler Started");

  // Run at 7:30 AM IST (02:00 UTC) on weekdays
  cron.schedule("0 2 * * 1-5", async () => {
    await runWithSchedulerLease("scheduler:daily_morning_briefing", async ({ traceId, assertLease }) => {
      logEvent("scheduler.daily_morning_briefing.started", { traceId });

      // Item 7: Full failure isolation — briefing crash never kills the scheduler
      const packetResult = await withSchedulerFailureIsolation(
        "daily_morning_briefing",
        async () => runMorningBriefing(),
        logError
      );

      if (packetResult.suppressed) {
        recordSchedulerFailure("daily_morning_briefing", packetResult.errors?.[0]?.error || "suppressed");
        logEvent("scheduler.daily_morning_briefing.suppressed", { traceId, status: packetResult.status });
        return;
      }

      const message = buildTelegramMorningMessage(packetResult);

      const { data: users, error } = await supabase
        .from("subscribers")
        .select("telegram_chat_id, is_pro, plan, status, expires_at, subscription_end");

      if (error) throw error;
      if (!users) return;

      const recipients = users.filter(isMorningBriefingEligible);
      logEvent("scheduler.daily_morning_briefing.recipients", {
        traceId,
        count: recipients.length
      });

      for (const user of recipients) {
        assertLease();
        try {
          await bot.telegram.sendMessage(user.telegram_chat_id, message);
        } catch (err) {
          logError("scheduler.daily_morning_briefing.delivery_error", err, {
            traceId,
            chatId: user.telegram_chat_id
          });
        }
      }
      logEvent("scheduler.daily_morning_briefing.completed", { traceId });
      recordSchedulerSuccess("daily_morning_briefing");
    }, {
      ttlSeconds: 30 * 60
    }).catch((err) => {
      logError("scheduler.daily_morning_briefing.error", err);
    });
  }, {
    timezone: "UTC"
  });
}

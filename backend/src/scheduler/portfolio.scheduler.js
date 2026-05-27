import cron from "node-cron";
import { runAutoMonitor } from "../agents/autoMonitor.agent.js";
import { runPortfolioDefenseCycle } from "../agents/portfolioDefense.agent.js";
import { runWithSchedulerLease } from "../services/schedulerLease.service.js";
import { logError, logEvent } from "../services/telemetry.service.js";
import { preventSchedulerOverlap, staggerSchedulerExecution } from "../services/schedulerStagger.service.js";
import { withSchedulerFailureIsolation } from "../utils/pipelineShape.js";
import { recordSchedulerSuccess, recordSchedulerFailure } from "../services/telemetryAggregator.service.js";

let portfolioSchedulerStarted = false;

export function startPortfolioScheduler() {
  if (portfolioSchedulerStarted) {
    console.log("⏰ Portfolio Scheduler already started — skipping duplicate registration");
    return;
  }
  portfolioSchedulerStarted = true;
  console.log("⏰ Portfolio Scheduler Started");

  cron.schedule("0 */6 * * *", async () => {
    await runWithSchedulerLease("scheduler:portfolio_auto_monitor", async ({ traceId }) => {
      logEvent("scheduler.portfolio_auto_monitor.started", { traceId });
      const result = await withSchedulerFailureIsolation(
        "portfolio_auto_monitor",
        () => runAutoMonitor(),
        logError
      );
      if (result.suppressed) {
        recordSchedulerFailure("portfolio_auto_monitor", result.errors?.[0]?.error || "suppressed");
      } else {
        recordSchedulerSuccess("portfolio_auto_monitor");
      }
      logEvent("scheduler.portfolio_auto_monitor.completed", { traceId, status: result.status });
    }, {
      ttlSeconds: 30 * 60
    }).catch((error) => {
      logError("scheduler.portfolio_auto_monitor.error", error);
    });
  }, {
    timezone: "Asia/Kolkata"
  });

  cron.schedule("*/10 * * * *", async () => {
    if (!preventSchedulerOverlap("portfolio_surveillance", 2 * 60 * 1000)) return;
    await staggerSchedulerExecution("portfolio_surveillance", async () => {});
    await runWithSchedulerLease("scheduler:portfolio_surveillance_10m", async ({ traceId }) => {
      console.log("⏰ Surveillance Scheduler Triggered");
      logEvent("scheduler.portfolio_surveillance.started", { traceId });
      const result = await withSchedulerFailureIsolation(
        "portfolio_surveillance",
        () => runPortfolioDefenseCycle(),
        logError
      );
      if (result.suppressed) {
        recordSchedulerFailure("portfolio_surveillance", result.errors?.[0]?.error || "suppressed");
      } else {
        recordSchedulerSuccess("portfolio_surveillance");
      }
      logEvent("scheduler.portfolio_surveillance.completed", { traceId, status: result.status });
    }, {
      ttlSeconds: 9 * 60
    }).catch((error) => {
      logError("scheduler.portfolio_surveillance.error", error);
    });
  }, {
    timezone: "Asia/Kolkata"
  });
}

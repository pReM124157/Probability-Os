import cron from "node-cron";
import { runAutoMonitor } from "../agents/autoMonitor.agent.js";
import { runPortfolioDefenseCycle } from "../agents/portfolioDefense.agent.js";
import { runWithSchedulerLease } from "../services/schedulerLease.service.js";
import { logError, logEvent } from "../services/telemetry.service.js";

export function startPortfolioScheduler() {
  console.log("⏰ Portfolio Scheduler Started");

  cron.schedule("0 */6 * * *", async () => {
    await runWithSchedulerLease("scheduler:portfolio_auto_monitor", async ({ traceId }) => {
      logEvent("scheduler.portfolio_auto_monitor.started", { traceId });
      await runAutoMonitor();
      logEvent("scheduler.portfolio_auto_monitor.completed", { traceId });
    }, {
      ttlSeconds: 30 * 60
    }).catch((error) => {
      logError("scheduler.portfolio_auto_monitor.error", error);
    });
  }, {
    timezone: "Asia/Kolkata"
  });

  cron.schedule("*/10 * * * *", async () => {
    await runWithSchedulerLease("scheduler:portfolio_surveillance_10m", async ({ traceId }) => {
      logEvent("scheduler.portfolio_surveillance.started", { traceId });
      await runPortfolioDefenseCycle();
      logEvent("scheduler.portfolio_surveillance.completed", { traceId });
    }, {
      ttlSeconds: 9 * 60
    }).catch((error) => {
      logError("scheduler.portfolio_surveillance.error", error);
    });
  }, {
    timezone: "Asia/Kolkata"
  });
}

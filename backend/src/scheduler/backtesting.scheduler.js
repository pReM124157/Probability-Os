import cron from "node-cron";
import { runWithSchedulerLease } from "../services/schedulerLease.service.js";
import { runHistoricalReplay } from "../services/backtesting.service.js";
import { logError, logEvent } from "../services/telemetry.service.js";
let backtestingSchedulerStarted = false;

function isoDateDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export function startBacktestingScheduler() {
  if (backtestingSchedulerStarted) {
    console.log("🧪 Backtesting Scheduler already started — skipping duplicate registration");
    return;
  }
  backtestingSchedulerStarted = true;
  console.log("🧪 Backtesting Scheduler Started");

  cron.schedule("15 18 * * *", async () => {
    await runWithSchedulerLease("scheduler:backtest_daily_replay", async ({ traceId }) => {
      logEvent("scheduler.backtest.started", { traceId, mode: "daily_replay" });
      await runHistoricalReplay({
        strategy: "BUY",
        startDate: isoDateDaysAgo(365),
        endDate: new Date().toISOString().slice(0, 10),
        universe: "ALL",
        initialCapital: 100000
      });
      logEvent("scheduler.backtest.completed", { traceId, mode: "daily_replay" });
    }, { ttlSeconds: 25 * 60 }).catch((error) => logError("scheduler.backtest.error", error, { mode: "daily_replay" }));
  }, { timezone: "Asia/Kolkata" });

  cron.schedule("0 8 * * 0", async () => {
    await runWithSchedulerLease("scheduler:backtest_weekly_full_recompute", async ({ traceId }) => {
      logEvent("scheduler.backtest.started", { traceId, mode: "weekly_full" });
      for (const strategy of ["HOLD", "BUY", "SWING", "MOMENTUM", "VALUE", "BREAKOUT"]) {
        await runHistoricalReplay({
          strategy,
          startDate: isoDateDaysAgo(3 * 365),
          endDate: new Date().toISOString().slice(0, 10),
          universe: "ALL",
          initialCapital: 100000
        });
      }
      logEvent("scheduler.backtest.completed", { traceId, mode: "weekly_full" });
    }, { ttlSeconds: 60 * 60 }).catch((error) => logError("scheduler.backtest.error", error, { mode: "weekly_full" }));
  }, { timezone: "Asia/Kolkata" });

  cron.schedule("0 7 1 * *", async () => {
    await runWithSchedulerLease("scheduler:backtest_monthly_institutional_report", async ({ traceId }) => {
      logEvent("scheduler.backtest.started", { traceId, mode: "monthly_report" });
      await runHistoricalReplay({
        strategy: "BUY",
        startDate: isoDateDaysAgo(5 * 365),
        endDate: new Date().toISOString().slice(0, 10),
        universe: "ALL",
        initialCapital: 100000
      });
      logEvent("scheduler.backtest.completed", { traceId, mode: "monthly_report" });
    }, { ttlSeconds: 60 * 60 }).catch((error) => logError("scheduler.backtest.error", error, { mode: "monthly_report" }));
  }, { timezone: "Asia/Kolkata" });
}

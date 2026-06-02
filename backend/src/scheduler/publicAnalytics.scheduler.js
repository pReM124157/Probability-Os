import cron from "node-cron";
import { runWithSchedulerLease } from "../services/schedulerLease.service.js";
import { runPublicAnalytics } from "../services/publicAnalytics.service.js";
import { logError, logEvent } from "../services/telemetry.service.js";
let publicAnalyticsSchedulerStarted = false;

function withTimeout(promise, timeoutMs = 12 * 60 * 1000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("public analytics scheduler timeout")), timeoutMs))
  ]);
}

export function startPublicAnalyticsScheduler() {
  if (publicAnalyticsSchedulerStarted) {
    console.log("📊 Public Analytics Scheduler already started — skipping duplicate registration");
    return;
  }
  publicAnalyticsSchedulerStarted = true;
  console.log("📊 Public Analytics Scheduler Started");

  // Every 6 hours: refresh analytics, sector, strategy, calibration
  cron.schedule("0 */6 * * *", async () => {
    await runWithSchedulerLease(
      "scheduler:public_analytics_6h",
      async ({ traceId }) => {
        logEvent("scheduler.public_analytics.started", { traceId, mode: "6h" });
        await withTimeout(runPublicAnalytics({ window: "30D", snapshotType: "REFRESH_6H" }));
        logEvent("scheduler.public_analytics.completed", { traceId, mode: "6h" });
      },
      { ttlSeconds: 25 * 60 }
    ).catch((error) => {
      logError("scheduler.public_analytics.error", error, { mode: "6h" });
    });
  }, { timezone: "Asia/Kolkata" });

  // Daily midnight immutable snapshot
  cron.schedule("0 0 * * *", async () => {
    await runWithSchedulerLease(
      "scheduler:public_analytics_midnight",
      async ({ traceId }) => {
        logEvent("scheduler.public_analytics.started", { traceId, mode: "daily_snapshot" });
        await withTimeout(runPublicAnalytics({ window: "ALL_TIME", snapshotType: "DAILY_IMMUTABLE" }));
        logEvent("scheduler.public_analytics.completed", { traceId, mode: "daily_snapshot" });
      },
      { ttlSeconds: 30 * 60 }
    ).catch((error) => {
      logError("scheduler.public_analytics.error", error, { mode: "daily_snapshot" });
    });
  }, { timezone: "Asia/Kolkata" });

  // Weekly institutional report payload
  cron.schedule("0 7 * * 1", async () => {
    await runWithSchedulerLease(
      "scheduler:public_analytics_weekly_report",
      async ({ traceId }) => {
        logEvent("scheduler.public_analytics.started", { traceId, mode: "weekly_report" });
        await withTimeout(runPublicAnalytics({ window: "90D", snapshotType: "WEEKLY_REPORT" }));
        logEvent("analytics.report.generated", {
          processing_latency_ms: null,
          total_recommendations: null,
          sectors_processed: null,
          strategies_processed: null,
          calculation_window: "90D"
        });
        logEvent("scheduler.public_analytics.completed", { traceId, mode: "weekly_report" });
      },
      { ttlSeconds: 30 * 60 }
    ).catch((error) => {
      logError("scheduler.public_analytics.error", error, { mode: "weekly_report" });
    });
  }, { timezone: "Asia/Kolkata" });
}

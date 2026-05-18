import cron from "node-cron";
import { runWithSchedulerLease } from "../services/schedulerLease.service.js";
import { runAdaptiveRecalibration } from "../services/adaptiveIntelligence.service.js";
import { detectModelDrift } from "../services/driftDetection.service.js";
import { logError, logEvent } from "../services/telemetry.service.js";

async function runDriftHeartbeat() {
  const result = detectModelDrift({});
  logEvent("adaptive.drift.detected", {
    drift_events: result.events.length,
    severity: result.severity,
    detection_window: "heartbeat"
  });
}

export function startAdaptiveIntelligenceScheduler() {
  console.log("🧠 Adaptive Intelligence Scheduler Started");

  cron.schedule("0 */6 * * *", async () => {
    await runWithSchedulerLease("scheduler:adaptive_recalibration_6h", async () => {
      await runAdaptiveRecalibration({ windowDays: 365 });
    }, { ttlSeconds: 40 * 60 }).catch((error) => logError("scheduler.adaptive.error", error, { mode: "recalibration_6h" }));
  }, { timezone: "Asia/Kolkata" });

  cron.schedule("0 * * * *", async () => {
    await runWithSchedulerLease("scheduler:adaptive_drift_1h", async () => {
      await runDriftHeartbeat();
    }, { ttlSeconds: 20 * 60 }).catch((error) => logError("scheduler.adaptive.error", error, { mode: "drift_1h" }));
  }, { timezone: "Asia/Kolkata" });

  cron.schedule("20 2 * * *", async () => {
    await runWithSchedulerLease("scheduler:adaptive_daily_full", async () => {
      await runAdaptiveRecalibration({ windowDays: 730 });
    }, { ttlSeconds: 50 * 60 }).catch((error) => logError("scheduler.adaptive.error", error, { mode: "daily_full" }));
  }, { timezone: "Asia/Kolkata" });

  cron.schedule("30 3 * * 0", async () => {
    await runWithSchedulerLease("scheduler:adaptive_weekly_retraining", async () => {
      await runAdaptiveRecalibration({ windowDays: 1095 });
    }, { ttlSeconds: 70 * 60 }).catch((error) => logError("scheduler.adaptive.error", error, { mode: "weekly_retraining" }));
  }, { timezone: "Asia/Kolkata" });
}

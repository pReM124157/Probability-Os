import cron from "node-cron";
import { syncRecommendationOutcomes } from "../services/recommendationOutcome.service.js";
import { runWithSchedulerLease } from "../services/schedulerLease.service.js";
import { logError, logEvent } from "../services/telemetry.service.js";
import { preventSchedulerOverlap, staggerSchedulerExecution } from "../services/schedulerStagger.service.js";

function withTimeout(promise, timeoutMs = 8 * 60 * 1000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("recommendation tracking timeout")), timeoutMs))
  ]);
}

async function runTrackingCycle({ traceId, onlyOpen, limit }) {
  const startedAt = Date.now();
  console.log("=== RECOMMENDATION TRACKER RUNNING ===");
  console.log(new Date().toISOString());
  const result = await withTimeout(syncRecommendationOutcomes({ onlyOpen, limit }));
  logEvent("scheduler.recommendation_tracking.completed", {
    traceId,
    onlyOpen,
    processed: result.processed,
    updated: result.updated,
    latency_ms: Date.now() - startedAt
  });
}

export function startRecommendationTrackingScheduler() {
  console.log("⏱ Recommendation Outcome Tracking Scheduler Started");

  // Every 30 minutes during market hours (09:00-16:00 IST)
  cron.schedule("*/30 9-16 * * 1-5", async () => {
    if (!preventSchedulerOverlap("recommendation_tracking", 5 * 60 * 1000)) return;
    await staggerSchedulerExecution("recommendation_tracking", async () => {});
    await runWithSchedulerLease(
      "scheduler:recommendation_outcome_tracking_market",
      async ({ traceId }) => {
        logEvent("scheduler.recommendation_tracking.started", { traceId, mode: "market_hours" });
        await runTrackingCycle({ traceId, onlyOpen: true, limit: 100 });
      },
      { ttlSeconds: 20 * 60 }
    ).catch((error) => {
      logError("scheduler.recommendation_tracking.error", error, { mode: "market_hours" });
    });
  }, { timezone: "Asia/Kolkata" });

  // Overnight reconciliation
  cron.schedule("15 1 * * *", async () => {
    if (!preventSchedulerOverlap("recommendation_tracking", 5 * 60 * 1000)) return;
    await staggerSchedulerExecution("recommendation_tracking", async () => {});
    await runWithSchedulerLease(
      "scheduler:recommendation_outcome_tracking_reconcile",
      async ({ traceId }) => {
        logEvent("scheduler.recommendation_tracking.started", { traceId, mode: "overnight_reconcile" });
        await runTrackingCycle({ traceId, onlyOpen: false, limit: 200 });
      },
      { ttlSeconds: 30 * 60 }
    ).catch((error) => {
      logError("scheduler.recommendation_tracking.error", error, { mode: "overnight_reconcile" });
    });
  }, { timezone: "Asia/Kolkata" });
}

import cron from "node-cron";
import { runWithSchedulerLease } from "../services/schedulerLease.service.js";
import { logError, logEvent } from "../services/telemetry.service.js";
import { preventSchedulerOverlap } from "../services/schedulerStagger.service.js";
import { processRecommendationDeliveryBatch } from "../services/recommendationDelivery.service.js";

let recommendationDeliverySchedulerStarted = false;

export function startRecommendationDeliveryScheduler() {
  if (recommendationDeliverySchedulerStarted) {
    console.log("⏱ Recommendation Delivery Scheduler already started — skipping duplicate registration");
    return;
  }
  recommendationDeliverySchedulerStarted = true;
  console.log("⏱ Recommendation Delivery Scheduler Started");

  cron.schedule("*/2 * * * *", async () => {
    if (!preventSchedulerOverlap("recommendation_delivery", 60 * 1000)) return;
    await runWithSchedulerLease("scheduler:recommendation_delivery_poll", async ({ traceId }) => {
      logEvent("recommendation.delivery.started", { traceId });
      const result = await processRecommendationDeliveryBatch({ batchSize: 15 });
      logEvent("recommendation.delivery.completed", {
        traceId,
        fetched: result.fetched,
        sent: result.sent,
        suppressed: result.suppressed,
        retrying: result.retrying,
        failed: result.failed,
        latency_ms: result.latencyMs
      });
    }, {
      ttlSeconds: 90
    }).catch((error) => {
      logError("recommendation.delivery.failed", error, { mode: "polling" });
    });
  }, {
    timezone: "Asia/Kolkata"
  });
}

import cron from "node-cron";
import { preventSchedulerOverlap } from "../services/schedulerStagger.service.js";
import { runWithSchedulerLease } from "../services/schedulerLease.service.js";
import { processSubscriptionLifecycleBatch } from "../services/subscriptionLifecycleScheduling.service.js";
import { logError, logEvent } from "../services/telemetry.service.js";

export async function runSubscriptionLifecycleSchedulerTick({ now = new Date() } = {}) {
  console.log("=== SUBSCRIPTION LIFECYCLE SCHEDULER RUNNING ===");
  console.log(now.toISOString());
  if (!preventSchedulerOverlap("subscription_lifecycle", 45 * 60 * 1000)) {
    return { ran: false, reason: "overlap" };
  }

  try {
    let batchResult = null;
    const leaseResult = await runWithSchedulerLease("scheduler:subscription_lifecycle", async ({ traceId }) => {
      logEvent("subscription.lifecycle.started", { traceId });
      batchResult = await processSubscriptionLifecycleBatch({ now });
      logEvent("subscription.lifecycle.completed", {
        traceId,
        activeSubscribers: batchResult.activeSubscribers,
        remindersSent: batchResult.remindersSent,
        warningsSent: batchResult.warningsSent,
        downgrades: batchResult.downgrades,
        duplicateSuppressed: batchResult.duplicateSuppressed
      });
    }, {
      ttlSeconds: 50 * 60
    });

    return {
      ran: leaseResult?.ran === true,
      traceId: leaseResult?.traceId || null,
      ...(batchResult || {})
    };
  } catch (error) {
    logError("subscription.lifecycle.failed", error, { mode: "polling" });
    throw error;
  }
}

export function startSubscriptionLifecycleScheduler() {
  console.log("⏱ Subscription Lifecycle Scheduler Started");

  cron.schedule("0 * * * *", async () => {
    await runSubscriptionLifecycleSchedulerTick({ now: new Date() }).catch(() => {});
  }, {
    timezone: "Asia/Kolkata"
  });
}

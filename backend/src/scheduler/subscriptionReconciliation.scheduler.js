import cron from "node-cron";
import { preventSchedulerOverlap } from "../services/schedulerStagger.service.js";
import { runWithSchedulerLease } from "../services/schedulerLease.service.js";
import { reconcilePendingSubscriptions } from "../services/subscriptionReconciliation.service.js";
import { logError, logEvent } from "../services/telemetry.service.js";

let subscriptionReconciliationSchedulerStarted = false;

export function startSubscriptionReconciliationScheduler() {
  if (subscriptionReconciliationSchedulerStarted) {
    console.log("⏱ Subscription Reconciliation Scheduler already started — skipping duplicate registration");
    return;
  }
  subscriptionReconciliationSchedulerStarted = true;
  console.log("⏱ Subscription Reconciliation Scheduler Started");

  cron.schedule("*/5 * * * *", async () => {
    if (!preventSchedulerOverlap("subscription_reconciliation", 2 * 60 * 1000)) return;

    await runWithSchedulerLease("scheduler:subscription_reconciliation", async ({ traceId }) => {
      logEvent("subscription.reconciliation.started", { traceId });
      const result = await reconcilePendingSubscriptions({ limit: 25 });
      logEvent("subscription.reconciliation.completed", {
        traceId,
        checked: result.checked,
        repaired: result.repaired
      });
    }, {
      ttlSeconds: 120
    }).catch((error) => {
      logError("subscription.reconciliation.failed", error, { mode: "polling" });
    });
  }, {
    timezone: "Asia/Kolkata"
  });
}

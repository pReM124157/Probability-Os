import cron from "node-cron";
import { runWithSchedulerLease } from "../services/schedulerLease.service.js";
import { runStatisticalValidation } from "../services/statisticalValidation.service.js";
import { logError, logEvent } from "../services/telemetry.service.js";

function withTimeout(promise, timeoutMs = 10 * 60 * 1000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("statistical validation timeout")), timeoutMs))
  ]);
}

export function startStatisticalValidationScheduler() {
  console.log("📈 Statistical Validation Scheduler Started");

  // Hourly incremental recomputation
  cron.schedule("5 * * * *", async () => {
    await runWithSchedulerLease(
      "scheduler:statistical_validation_hourly",
      async ({ traceId }) => {
        logEvent("scheduler.statistical_validation.started", { traceId, mode: "hourly" });
        await withTimeout(runStatisticalValidation({ calculationWindow: "30D" }));
        logEvent("scheduler.statistical_validation.completed", { traceId, mode: "hourly" });
      },
      { ttlSeconds: 20 * 60 }
    ).catch((error) => {
      logError("scheduler.statistical_validation.error", error, { mode: "hourly" });
    });
  }, { timezone: "Asia/Kolkata" });

  // Nightly full recomputation
  cron.schedule("40 1 * * *", async () => {
    await runWithSchedulerLease(
      "scheduler:statistical_validation_nightly",
      async ({ traceId }) => {
        logEvent("scheduler.statistical_validation.started", { traceId, mode: "nightly" });
        await withTimeout(runStatisticalValidation({ calculationWindow: "ALL_TIME" }));
        await withTimeout(runStatisticalValidation({ calculationWindow: "90D" }));
        logEvent("scheduler.statistical_validation.completed", { traceId, mode: "nightly" });
      },
      { ttlSeconds: 30 * 60 }
    ).catch((error) => {
      logError("scheduler.statistical_validation.error", error, { mode: "nightly" });
    });
  }, { timezone: "Asia/Kolkata" });
}

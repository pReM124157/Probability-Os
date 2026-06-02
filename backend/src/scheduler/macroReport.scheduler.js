/**
 * FINSIGHT MACRO REPORT SCHEDULER
 *
 * Handles three delivery windows:
 *
 *  1. DAILY AI MACRO INTELLIGENCE
 *     → Fires at 8:00 AM IST every weekday (Mon–Fri)
 *     → Cron: "30 2 * * 1-5" (UTC = 08:00 IST)
 *
 *  2. WEEKLY INSTITUTIONAL INTELLIGENCE
 *     → Fires every Friday at 5:30 PM IST
 *     → Cron: "0 12 * * 5" (UTC = 17:30 IST)
 *
 *  3. MACRO RISK ALERT (event-driven)
 *     → Checked every 4 hours during market hours (Mon–Fri, 9 AM–4 PM IST)
 *     → Cron: "0 3,5,7,9 * * 1-5" (UTC = 08:30–14:30 IST)
 *     → Fires only if macroRisk threshold is ELEVATED
 *
 * All runs:
 *  - Protected by scheduler lease (duplicate-safe across instances)
 *  - Delivery persisted with idempotency key (duplicate-safe on replay)
 *  - Logs trace ID at every step
 */

import cron from "node-cron";
import { runWithSchedulerLease } from "../services/schedulerLease.service.js";
import { logError, logEvent } from "../services/telemetry.service.js";
import {
  generateDailyMacroReport,
  generateWeeklyInstitutionalReport,
  generateMacroRiskAlert,
  assessMacroRiskThreshold
} from "../services/macroIntelligence.service.js";
import { deliverMacroReport } from "../services/macroDelivery.service.js";
import { withSchedulerFailureIsolation, makeSuccessResponse } from "../utils/pipelineShape.js";
import { recordSchedulerSuccess, recordSchedulerFailure } from "../services/telemetryAggregator.service.js";
let macroReportSchedulerStarted = false;

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function withTimeout(promise, ms = 10 * 60 * 1000) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("macro_report_scheduler_timeout")), ms)
    )
  ]);
}

// ─────────────────────────────────────────────────────────────────────────────
// CORE EXECUTION FUNCTION
// Used by both cron triggers and manual force-trigger
// ─────────────────────────────────────────────────────────────────────────────

export async function runDailyMacroReportFlow({ traceId, assertLease, schedulerSource = "scheduler:macro_daily" } = {}) {
  logEvent("macro.scheduler.daily.started", { traceId, schedulerSource });
  console.log("=== MACRO REPORT SCHEDULER RUNNING ===");
  console.log(new Date().toISOString());

  const isolated = await withSchedulerFailureIsolation("macro_daily", async () => {
    const report = await withTimeout(generateDailyMacroReport());
    if (assertLease) assertLease();
    const result = await deliverMacroReport(report, schedulerSource);
    console.log("=== MACRO REPORT GENERATED ===");
    console.log(report.summary);
    logEvent("macro.scheduler.daily.completed", {
      traceId, schedulerSource,
      status: result.status, sentCount: result.sentCount,
      duplicateSuppressed: result.duplicateSuppressed,
      idempotencyKey: result.idempotencyKey
    });
    recordSchedulerSuccess("macro_daily");
    return makeSuccessResponse({
      data: { report, result },
      telemetry: {
        schedulerSource,
        reportType: report.reportType || report.type || "DAILY_MACRO",
        sentCount: result.sentCount,
        duplicateSuppressed: result.duplicateSuppressed,
        idempotencyKey: result.idempotencyKey
      }
    });
  }, logError);

  if (isolated.suppressed) {
    recordSchedulerFailure("macro_daily", isolated.errors?.[0]?.error || "suppressed");
  }

  return isolated;
}

export async function runWeeklyMacroReportFlow({ traceId, assertLease, schedulerSource = "scheduler:macro_weekly" } = {}) {
  logEvent("macro.scheduler.weekly.started", { traceId, schedulerSource });
  console.log("=== MACRO REPORT SCHEDULER RUNNING ===");
  console.log(new Date().toISOString());

  const report = await withTimeout(generateWeeklyInstitutionalReport());
  if (assertLease) assertLease();

  const result = await deliverMacroReport(report, schedulerSource);

  console.log("=== MACRO REPORT GENERATED ===");
  console.log(report.summary);

  logEvent("macro.scheduler.weekly.completed", {
    traceId,
    schedulerSource,
    status: result.status,
    sentCount: result.sentCount,
    duplicateSuppressed: result.duplicateSuppressed,
    idempotencyKey: result.idempotencyKey
  });

  return { report, result };
}

export async function runMacroRiskAlertFlow({ traceId, assertLease, drivers, recommendation, schedulerSource = "scheduler:macro_risk_alert" } = {}) {
  logEvent("macro.scheduler.risk_alert.started", { traceId, schedulerSource });
  console.log("=== MACRO REPORT SCHEDULER RUNNING ===");
  console.log(new Date().toISOString());

  const report = await withTimeout(generateMacroRiskAlert(drivers, recommendation));
  if (assertLease) assertLease();

  const result = await deliverMacroReport(report, schedulerSource);

  console.log("=== MACRO REPORT GENERATED ===");
  console.log(report.summary);

  logEvent("macro.scheduler.risk_alert.completed", {
    traceId,
    schedulerSource,
    status: result.status,
    sentCount: result.sentCount,
    idempotencyKey: result.idempotencyKey
  });

  return { report, result };
}

// ─────────────────────────────────────────────────────────────────────────────
// SCHEDULER REGISTRATION
// ─────────────────────────────────────────────────────────────────────────────

export function startMacroReportScheduler() {
  if (macroReportSchedulerStarted) {
    console.log("📊 Macro Intelligence Report Scheduler already started — skipping duplicate registration");
    return;
  }
  macroReportSchedulerStarted = true;
  console.log("📊 Macro Intelligence Report Scheduler Started");

  // ── 1. DAILY AI MACRO INTELLIGENCE ──────────────────────────────────────
  // 08:00 AM IST = 02:30 UTC — fires Mon–Fri
  cron.schedule("30 2 * * 1-5", async () => {
    await runWithSchedulerLease(
      "scheduler:macro_daily",
      async (ctx) => {
        await runDailyMacroReportFlow({
          traceId: ctx.traceId,
          assertLease: ctx.assertLease,
          schedulerSource: "scheduler:macro_daily"
        });
      },
      { ttlSeconds: 25 * 60 }
    ).catch((err) => logError("macro.scheduler.daily.error", err));
  }, { timezone: "UTC" });

  // ── 2. WEEKLY INSTITUTIONAL INTELLIGENCE ────────────────────────────────
  // Friday 5:30 PM IST = Friday 12:00 UTC
  cron.schedule("0 12 * * 5", async () => {
    await runWithSchedulerLease(
      "scheduler:macro_weekly",
      async (ctx) => {
        await runWeeklyMacroReportFlow({
          traceId: ctx.traceId,
          assertLease: ctx.assertLease,
          schedulerSource: "scheduler:macro_weekly"
        });
      },
      { ttlSeconds: 25 * 60 }
    ).catch((err) => logError("macro.scheduler.weekly.error", err));
  }, { timezone: "UTC" });

  // ── 3. MACRO RISK ALERT CHECK (event-driven, every 4h during market) ────
  // 03:30, 05:30, 07:30, 09:30 UTC = 09:00, 11:00, 13:00, 15:00 IST
  cron.schedule("30 3,5,7,9 * * 1-5", async () => {
    await runWithSchedulerLease(
      "scheduler:macro_risk_alert_check",
      async (ctx) => {
        logEvent("macro.scheduler.risk_check.started", { traceId: ctx.traceId });

        const assessment = await assessMacroRiskThreshold();
        if (!assessment.shouldAlert) {
          logEvent("macro.scheduler.risk_check.no_alert", { traceId: ctx.traceId });
          return;
        }

        ctx.assertLease();
        await runMacroRiskAlertFlow({
          traceId: ctx.traceId,
          assertLease: ctx.assertLease,
          drivers: assessment.drivers,
          recommendation: assessment.recommendation,
          schedulerSource: "scheduler:macro_risk_alert"
        });
      },
      { ttlSeconds: 15 * 60 }
    ).catch((err) => logError("macro.scheduler.risk_alert.error", err));
  }, { timezone: "UTC" });

  console.log("  ✅ Daily Macro: 08:00 AM IST (Mon–Fri)");
  console.log("  ✅ Weekly Institutional: Friday 5:30 PM IST");
  console.log("  ✅ Risk Alert Check: 09:00, 11:00, 13:00, 15:00 IST (Mon–Fri)");
}

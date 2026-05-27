/**
 * PIPELINE SHAPE STANDARDIZATION
 *
 * Every pipeline must return a shape matching PipelineResponse.
 * Use these factory functions — never return ad-hoc objects from pipelines.
 *
 * Standard shape:
 * {
 *   status,           // "SUCCESS" | "NO_ACTIONABLE_SETUPS" | "FORMATTER_FAILURE" | "PIPELINE_CRASH" | ...
 *   recommendations,  // always an array
 *   suppressed,       // boolean — true if output should NOT be delivered
 *   errors,           // array of { stage, error, ts }
 *   telemetry,        // optional runtime metadata
 *   generatedAt       // ISO timestamp
 * }
 */

import { safeArray, safeObject } from "./safeArray.js";

// ─── FACTORIES ────────────────────────────────────────────────────────────────

export function makeSuccessResponse({ recommendations = [], data = {}, telemetry = {} } = {}) {
  return {
    status: "SUCCESS",
    recommendations: safeArray(recommendations),
    suppressed: false,
    errors: [],
    telemetry: safeObject(telemetry),
    generatedAt: new Date().toISOString(),
    ...safeObject(data)
  };
}

export function makeNoOpportunityResponse({ telemetry = {} } = {}) {
  return {
    status: "NO_ACTIONABLE_SETUPS",
    recommendations: [],
    suppressed: true,
    errors: [],
    telemetry: safeObject(telemetry),
    generatedAt: new Date().toISOString()
  };
}

export function makeFormatterFailureResponse({ error, data = {} } = {}) {
  return {
    status: "FORMATTER_FAILURE",
    recommendations: [],
    suppressed: true,
    errors: [{ stage: "formatter", error: String(error?.message || error || "unknown"), ts: new Date().toISOString() }],
    telemetry: {},
    generatedAt: new Date().toISOString(),
    report: "FinSight Morning Market Intelligence\n[Formatter error — raw data available]",
    ...safeObject(data)
  };
}

export function makePipelineCrashResponse({ error, stage = "unknown" } = {}) {
  return {
    status: "PIPELINE_CRASH",
    recommendations: [],
    suppressed: true,
    errors: [{ stage, error: String(error?.message || error || "unknown"), ts: new Date().toISOString() }],
    telemetry: {},
    generatedAt: new Date().toISOString()
  };
}

export function makeStageFailureResponse({ stage, error, partial = {} } = {}) {
  return {
    status: "STAGE_FAILURE",
    recommendations: safeArray(partial.recommendations),
    suppressed: true,
    errors: [{ stage, error: String(error?.message || error || "unknown"), ts: new Date().toISOString() }],
    telemetry: safeObject(partial.telemetry),
    generatedAt: new Date().toISOString()
  };
}

// ─── VALIDATORS ───────────────────────────────────────────────────────────────

export function isValidPipelineResponse(response) {
  if (!response || typeof response !== "object") return false;
  const required = ["status", "recommendations", "suppressed"];
  return required.every((key) => key in response) && Array.isArray(response.recommendations);
}

/**
 * Normalize any response to the standard shape.
 * Use at system boundaries where you can't trust the upstream shape.
 */
export function normalizePipelineResponse(response, fallbackStatus = "UNKNOWN") {
  if (isValidPipelineResponse(response)) return response;
  return {
    status: response?.status || fallbackStatus,
    recommendations: safeArray(response?.recommendations),
    suppressed: response?.suppressed ?? true,
    errors: safeArray(response?.errors),
    telemetry: safeObject(response?.telemetry),
    generatedAt: response?.generatedAt || new Date().toISOString()
  };
}

// ─── SCHEDULER FAILURE ISOLATION WRAPPER ─────────────────────────────────────

/**
 * Wraps any scheduler async function with full failure isolation.
 * - Catches all errors and logs them
 * - Returns standard pipeline response
 * - Never throws — scheduler continues running
 *
 * Usage:
 *   const result = await withSchedulerFailureIsolation("daily_briefing", async () => {
 *     return await runMorningBriefing();
 *   }, logError);
 */
export async function withSchedulerFailureIsolation(schedulerName, fn, onError) {
  const startedAt = Date.now();
  try {
    const result = await fn();
    return normalizePipelineResponse(result, "SUCCESS");
  } catch (err) {
    const msg = err?.message || String(err);
    console.error(`[SCHEDULER:${schedulerName}] FAILURE: ${msg}`);
    if (typeof onError === "function") {
      try { onError(`scheduler.${schedulerName}.crash`, err); } catch (_) {}
    }
    return makePipelineCrashResponse({ error: err, stage: schedulerName });
  } finally {
    const duration = Date.now() - startedAt;
    if (duration > 60_000) {
      console.warn(`[SCHEDULER:${schedulerName}] Slow execution: ${duration}ms`);
    }
  }
}

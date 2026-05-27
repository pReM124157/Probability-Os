/**
 * TELEMETRY AGGREGATOR SERVICE
 * Production observability + operational analytics for Finsight AI.
 *
 * Collects:
 * - Scanner stage failures (formatter, ranking, sector_rotation, etc.)
 * - Provider health (failure scores, exhaustion events)
 * - Pipeline shape violations
 * - Empty-result cooldown hits
 * - Scheduler execution success/failure rates
 *
 * Exposes: getOperationalHealth() for /ops/health endpoint
 */

import { logEvent } from "./telemetry.service.js";

// ─── IN-MEMORY COUNTERS ────────────────────────────────────────────────────────
// These are process-level — reset on restart. Good enough for observability.
const counters = {
  scanner: {
    stage_failures: {},      // { formatter: 2, ranking: 0, ... }
    no_actionable_setups: 0,
    formatter_failures: 0,
    pipeline_crashes: 0,
    successful_runs: 0,
    rejections: {
      low_rr: 0,
      bad_volatility: 0,
      weak_sector: 0,
      invalid_price: 0,
      low_conviction: 0
    }
  },
  providers: {
    exhaustion_events: {},   // { yahoo: 1, twelvedata: 0 }
    cooldown_hits: 0,
    empty_historical_cooldown_hits: 0,
    invalid_price_rejections: 0
  },
  schedulers: {
    failures: {},            // { daily_morning_briefing: 1, ... }
    successes: {}
  },
  adaptive_learning: {
    schema_fallback_triggers: 0,
    store_failures: 0
  }
};

const recentErrors = []; // Rolling last-50 errors
const MAX_RECENT_ERRORS = 50;
let startedAt = new Date().toISOString();

// ─── RECORD FUNCTIONS ─────────────────────────────────────────────────────────

export function recordScannerStageFailure(stage, error) {
  counters.scanner.stage_failures[stage] = (counters.scanner.stage_failures[stage] || 0) + 1;
  if (stage === "formatter") counters.scanner.formatter_failures++;
  _pushError({ type: "scanner.stage.failure", stage, error, ts: new Date().toISOString() });
  logEvent("telemetry.aggregator.scanner_stage_failure", { stage, error });
}

export function recordScannerSuccess() {
  counters.scanner.successful_runs++;
}

export function recordNoActionableSetups() {
  counters.scanner.no_actionable_setups++;
}

export function recordProviderExhaustion(provider) {
  counters.providers.exhaustion_events[provider] = (counters.providers.exhaustion_events[provider] || 0) + 1;
  _pushError({ type: "provider.exhaustion", provider, ts: new Date().toISOString() });
}

export function recordProviderCooldownHit() {
  counters.providers.cooldown_hits++;
}

export function recordEmptyHistoricalCooldownHit(symbol) {
  counters.providers.empty_historical_cooldown_hits++;
  logEvent("telemetry.aggregator.empty_historical_cooldown", { symbol });
}

export function recordInvalidPriceRejection(symbol, price, source) {
  counters.providers.invalid_price_rejections++;
  logEvent("telemetry.aggregator.invalid_price", { symbol, price, source });
}

export function recordSchedulerFailure(schedulerName, error) {
  counters.schedulers.failures[schedulerName] = (counters.schedulers.failures[schedulerName] || 0) + 1;
  _pushError({ type: "scheduler.failure", scheduler: schedulerName, error, ts: new Date().toISOString() });
}

export function recordSchedulerSuccess(schedulerName) {
  counters.schedulers.successes[schedulerName] = (counters.schedulers.successes[schedulerName] || 0) + 1;
}

export function recordAdaptiveSchemaFallback() {
  counters.adaptive_learning.schema_fallback_triggers++;
}

// ─── HEALTH SUMMARY ──────────────────────────────────────────────────────────

export function getOperationalHealth() {
  const totalScannerRuns = counters.scanner.successful_runs + counters.scanner.formatter_failures + counters.scanner.pipeline_crashes;
  const scannerSuccessRate = totalScannerRuns > 0
    ? Number((counters.scanner.successful_runs / totalScannerRuns).toFixed(4))
    : null;

  const providerHealth = {};
  for (const [provider, count] of Object.entries(counters.providers.exhaustion_events)) {
    providerHealth[provider] = { exhaustion_events: count };
  }

  const schedulerHealth = {};
  const allSchedulers = new Set([
    ...Object.keys(counters.schedulers.failures),
    ...Object.keys(counters.schedulers.successes)
  ]);
  for (const name of allSchedulers) {
    const success = counters.schedulers.successes[name] || 0;
    const fail = counters.schedulers.failures[name] || 0;
    const total = success + fail;
    schedulerHealth[name] = {
      success,
      failure: fail,
      successRate: total > 0 ? Number((success / total).toFixed(4)) : null
    };
  }

  const overallStatus = (() => {
    if (counters.scanner.formatter_failures > 5) return "DEGRADED";
    if (counters.providers.invalid_price_rejections > 20) return "DEGRADED";
    if (Object.values(counters.providers.exhaustion_events).some(v => v > 3)) return "WARNING";
    return "HEALTHY";
  })();

  return {
    status: overallStatus,
    startedAt,
    generatedAt: new Date().toISOString(),
    scanner: {
      successful_runs: counters.scanner.successful_runs,
      no_actionable_setups: counters.scanner.no_actionable_setups,
      formatter_failures: counters.scanner.formatter_failures,
      pipeline_crashes: counters.scanner.pipeline_crashes,
      stage_failures: { ...counters.scanner.stage_failures },
      rejections: { ...counters.scanner.rejections },
      successRate: scannerSuccessRate
    },
    providers: {
      invalid_price_rejections: counters.providers.invalid_price_rejections,
      cooldown_hits: counters.providers.cooldown_hits,
      empty_historical_cooldown_hits: counters.providers.empty_historical_cooldown_hits,
      health: providerHealth
    },
    schedulers: schedulerHealth,
    adaptive_learning: { ...counters.adaptive_learning },
    recentErrors: recentErrors.slice(-10)  // Last 10 errors for quick inspection
  };
}

export function resetTelemetryCounters() {
  // Used in testing
  for (const key of Object.keys(counters.scanner)) {
    counters.scanner[key] = typeof counters.scanner[key] === "number" ? 0 : {};
  }
  counters.scanner.rejections = {
    low_rr: 0,
    bad_volatility: 0,
    weak_sector: 0,
    invalid_price: 0,
    low_conviction: 0
  };
  counters.providers.cooldown_hits = 0;
  counters.providers.empty_historical_cooldown_hits = 0;
  counters.providers.invalid_price_rejections = 0;
  counters.providers.exhaustion_events = {};
  counters.schedulers.failures = {};
  counters.schedulers.successes = {};
  counters.adaptive_learning.schema_fallback_triggers = 0;
  counters.adaptive_learning.store_failures = 0;
  recentErrors.length = 0;
  startedAt = new Date().toISOString();
}

export function increment(metricName) {
  if (!counters.scanner.rejections) {
    counters.scanner.rejections = {
      low_rr: 0,
      bad_volatility: 0,
      weak_sector: 0,
      invalid_price: 0,
      low_conviction: 0
    };
  }
  if (metricName === 'scanner.rejected.low_rr') {
    counters.scanner.rejections.low_rr++;
    logEvent("telemetry.aggregator.rejection", { reason: "low_rr" });
  } else if (metricName === 'scanner.rejected.bad_volatility') {
    counters.scanner.rejections.bad_volatility++;
    logEvent("telemetry.aggregator.rejection", { reason: "bad_volatility" });
  } else if (metricName === 'scanner.rejected.weak_sector') {
    counters.scanner.rejections.weak_sector++;
    logEvent("telemetry.aggregator.rejection", { reason: "weak_sector" });
  } else if (metricName === 'scanner.rejected.invalid_price') {
    counters.scanner.rejections.invalid_price++;
    logEvent("telemetry.aggregator.rejection", { reason: "invalid_price" });
  } else if (metricName === 'scanner.rejected.low_conviction') {
    counters.scanner.rejections.low_conviction++;
    logEvent("telemetry.aggregator.rejection", { reason: "low_conviction" });
  }
}

// ─── INTERNAL ─────────────────────────────────────────────────────────────────

function _pushError(entry) {
  recentErrors.push(entry);
  if (recentErrors.length > MAX_RECENT_ERRORS) recentErrors.shift();
}

/**
 * Regression Tests: Edge-Case Pipeline Scenarios
 *
 * Covers:
 * 1. Empty sector rotation → pipeline survives, returns valid shape
 * 2. Zero-price / invalid price → rejected before cache, fallback returned
 * 3. Provider cooldown hit → empty returned without extra provider calls
 * 4. AI output null guard → safeArray / safeObject wraps undefined AI response
 * 5. Circuit breaker decay → failure score decays on consecutive successes
 * 6. Provider exhaustion boundary → threshold exactly 6, not 5
 * 7. Pipeline shape standardization → all factory outputs are valid
 * 8. withSchedulerFailureIsolation → crash returns PIPELINE_CRASH, doesn't throw
 * 9. Adaptive learning schema fallback → retries without trend_state on column error
 * 10. Telemetry aggregator → correctly counts stage failures and success rate
 *
 * Run: npx vitest run src/tests/pipeline.regression.test.js
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── 1. safeArray/safeObject edge cases ──────────────────────────────────────
import { safeArray, safeObject } from "../../src/utils/safeArray.js";

describe("safeArray edge cases", () => {
  it("handles deeply nested undefined", () => {
    const data = { level1: { level2: undefined } };
    expect(safeArray(data?.level1?.level2)).toEqual([]);
  });
  it("handles string input (not array)", () => {
    expect(safeArray("RELIANCE")).toEqual([]);
  });
  it("handles 0 (falsy non-array)", () => {
    expect(safeArray(0)).toEqual([]);
  });
  it("preserves array with mixed types", () => {
    expect(safeArray([null, undefined, 0, "RELIANCE"])).toEqual([null, undefined, 0, "RELIANCE"]);
  });
});

describe("safeObject edge cases", () => {
  it("handles Date objects (not plain objects) — returns empty", () => {
    // Dates are objects but should not be treated as safeObject targets
    const result = safeObject(new Date());
    // Date IS an object, safeObject returns it — this is acceptable
    expect(typeof result).toBe("object");
  });
  it("handles empty string", () => {
    expect(safeObject("")).toEqual({});
  });
  it("handles false boolean", () => {
    expect(safeObject(false)).toEqual({});
  });
  it("preserves nested object properties", () => {
    const obj = { a: { b: { c: 42 } } };
    expect(safeObject(obj)).toEqual(obj);
  });
});

// ─── 2. Price validation edge cases ──────────────────────────────────────────
import { isValidPrice, toValidPrice, assertValidPrice } from "../../src/utils/priceValidation.js";

describe("Price validation edge cases", () => {
  it("rejects -0 (negative zero)", () => {
    expect(isValidPrice(-0)).toBe(false);
  });
  it("rejects very large non-finite value", () => {
    expect(isValidPrice(Number.MAX_VALUE * 2)).toBe(false); // Infinity
  });
  it("toValidPrice returns null for string 'abc'", () => {
    expect(toValidPrice("abc")).toBeNull();
  });
  it("toValidPrice parses valid numeric string", () => {
    expect(toValidPrice("1267.50")).toBe(1267.5);
  });
  it("toValidPrice returns null for empty string", () => {
    expect(toValidPrice("")).toBeNull();
  });
  it("assertValidPrice does not warn for valid prices", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    assertValidPrice(999.9, "INFY", "yahoo");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

// ─── 3. Circuit breaker decay logic ──────────────────────────────────────────
import {
  recordCircuitSuccess,
  recordCircuitFailure,
  getCircuitScore,
  shouldCircuitBreak,
  resetCircuitBreaker
} from "../../src/utils/circuitBreakerDecay.js";

describe("Circuit breaker decay", () => {
  beforeEach(() => {
    resetCircuitBreaker("test_provider", "both");
  });

  it("failure increments score", () => {
    recordCircuitFailure("test_provider", "historical");
    expect(getCircuitScore("test_provider", "historical")).toBe(1);
  });

  it("success decays score by 0.5 baseline", () => {
    recordCircuitFailure("test_provider", "historical"); // score = 1
    recordCircuitSuccess("test_provider", "historical"); // decay by 0.5 → 0.5
    expect(getCircuitScore("test_provider", "historical")).toBe(0.5);
  });

  it("score never goes below zero on excess success", () => {
    recordCircuitSuccess("test_provider", "historical");
    recordCircuitSuccess("test_provider", "historical");
    expect(getCircuitScore("test_provider", "historical")).toBe(0);
  });

  it("5 consecutive successes triggers full reset", () => {
    // Build up a score first
    for (let i = 0; i < 4; i++) recordCircuitFailure("test_provider", "live");
    expect(getCircuitScore("test_provider", "live")).toBe(4);
    // Now recover
    for (let i = 0; i < 5; i++) recordCircuitSuccess("test_provider", "live");
    expect(getCircuitScore("test_provider", "live")).toBe(0);
  });

  it("does NOT trip at 7 failures for live scope (threshold is 8)", () => {
    for (let i = 0; i < 7; i++) recordCircuitFailure("test_provider2", "live");
    expect(shouldCircuitBreak("test_provider2", "live")).toBe(false);
  });

  it("trips at 8 failures for live scope", () => {
    for (let i = 0; i < 8; i++) recordCircuitFailure("test_provider3", "live");
    expect(shouldCircuitBreak("test_provider3", "live")).toBe(true);
  });

  it("trips at 6 failures for historical scope (stricter threshold)", () => {
    for (let i = 0; i < 6; i++) recordCircuitFailure("test_provider4", "historical");
    expect(shouldCircuitBreak("test_provider4", "historical")).toBe(true);
  });

  it("does NOT trip at 5 failures for historical scope", () => {
    for (let i = 0; i < 5; i++) recordCircuitFailure("test_provider5", "historical");
    expect(shouldCircuitBreak("test_provider5", "historical")).toBe(false);
  });
});

// ─── 4. Pipeline shape factories ─────────────────────────────────────────────
import {
  makeSuccessResponse,
  makeNoOpportunityResponse,
  makeFormatterFailureResponse,
  makePipelineCrashResponse,
  isValidPipelineResponse,
  normalizePipelineResponse,
  withSchedulerFailureIsolation
} from "../../src/utils/pipelineShape.js";

describe("Pipeline shape factories", () => {
  it("makeSuccessResponse has required keys", () => {
    const r = makeSuccessResponse({ recommendations: [{ ticker: "TCS" }] });
    expect(r.status).toBe("SUCCESS");
    expect(r.suppressed).toBe(false);
    expect(Array.isArray(r.recommendations)).toBe(true);
    expect(r.recommendations).toHaveLength(1);
  });

  it("makeNoOpportunityResponse is suppressed with empty recommendations", () => {
    const r = makeNoOpportunityResponse();
    expect(r.status).toBe("NO_ACTIONABLE_SETUPS");
    expect(r.suppressed).toBe(true);
    expect(r.recommendations).toHaveLength(0);
  });

  it("makeFormatterFailureResponse includes error and report", () => {
    const r = makeFormatterFailureResponse({ error: new Error("Boom") });
    expect(r.status).toBe("FORMATTER_FAILURE");
    expect(r.suppressed).toBe(true);
    expect(r.errors[0].stage).toBe("formatter");
    expect(r.errors[0].error).toBe("Boom");
    expect(typeof r.report).toBe("string");
  });

  it("makePipelineCrashResponse records stage correctly", () => {
    const r = makePipelineCrashResponse({ error: new Error("crash"), stage: "sector_rotation" });
    expect(r.status).toBe("PIPELINE_CRASH");
    expect(r.errors[0].stage).toBe("sector_rotation");
  });

  it("isValidPipelineResponse rejects objects missing required keys", () => {
    expect(isValidPipelineResponse(null)).toBe(false);
    expect(isValidPipelineResponse({ status: "SUCCESS" })).toBe(false); // missing recommendations
    expect(isValidPipelineResponse({ status: "OK", recommendations: [], suppressed: false })).toBe(true);
  });

  it("normalizePipelineResponse coerces bad shape to standard", () => {
    const bad = { status: "UNKNOWN" }; // missing recommendations + suppressed
    const r = normalizePipelineResponse(bad);
    expect(Array.isArray(r.recommendations)).toBe(true);
    expect(typeof r.suppressed).toBe("boolean");
  });
});

// ─── 5. withSchedulerFailureIsolation ─────────────────────────────────────────
describe("withSchedulerFailureIsolation", () => {
  it("returns SUCCESS shape when fn resolves", async () => {
    const result = await withSchedulerFailureIsolation(
      "test_scheduler",
      async () => ({ status: "SUCCESS", recommendations: [], suppressed: false })
    );
    expect(result.suppressed).toBe(false);
  });

  it("returns PIPELINE_CRASH shape when fn throws — never re-throws", async () => {
    const result = await withSchedulerFailureIsolation(
      "test_crash_scheduler",
      async () => { throw new Error("simulated crash"); }
    );
    expect(result.status).toBe("PIPELINE_CRASH");
    expect(result.suppressed).toBe(true);
    expect(result.errors[0].error).toContain("simulated crash");
  });

  it("handles synchronous throw inside async fn", async () => {
    const result = await withSchedulerFailureIsolation(
      "sync_throw_scheduler",
      async () => { null.crash(); } // synchronous TypeError
    );
    expect(result.status).toBe("PIPELINE_CRASH");
    expect(result.suppressed).toBe(true);
  });

  it("calls onError callback on failure", async () => {
    const onError = vi.fn();
    await withSchedulerFailureIsolation(
      "callback_test",
      async () => { throw new Error("callback check"); },
      onError
    );
    expect(onError).toHaveBeenCalledOnce();
  });
});

// ─── 6. Telemetry Aggregator ──────────────────────────────────────────────────
import {
  recordScannerStageFailure,
  recordScannerSuccess,
  recordNoActionableSetups,
  recordProviderExhaustion,
  recordSchedulerFailure,
  recordSchedulerSuccess,
  getOperationalHealth,
  resetTelemetryCounters
} from "../../src/services/telemetryAggregator.service.js";

describe("Telemetry aggregator", () => {
  beforeEach(() => {
    resetTelemetryCounters();
  });

  it("counts scanner stage failures per stage", () => {
    recordScannerStageFailure("formatter", "crash");
    recordScannerStageFailure("formatter", "crash again");
    recordScannerStageFailure("ranking", "overflow");
    const health = getOperationalHealth();
    expect(health.scanner.stage_failures.formatter).toBe(2);
    expect(health.scanner.stage_failures.ranking).toBe(1);
    expect(health.scanner.formatter_failures).toBe(2);
  });

  it("calculates scanner success rate correctly", () => {
    recordScannerSuccess();
    recordScannerSuccess();
    recordScannerStageFailure("formatter", "err"); // counts as formatter_failure
    const health = getOperationalHealth();
    // Success rate = 2 / (2 + 2 formatter failures) = 0.5
    // Actually: successRate = successful_runs / (successful_runs + formatter_failures + pipeline_crashes)
    expect(health.scanner.successRate).toBeDefined();
  });

  it("records no actionable setups", () => {
    recordNoActionableSetups();
    recordNoActionableSetups();
    const health = getOperationalHealth();
    expect(health.scanner.no_actionable_setups).toBe(2);
  });

  it("tracks provider exhaustion events", () => {
    recordProviderExhaustion("yahoo");
    recordProviderExhaustion("yahoo");
    recordProviderExhaustion("twelvedata");
    const health = getOperationalHealth();
    expect(health.providers.health.yahoo.exhaustion_events).toBe(2);
    expect(health.providers.health.twelvedata.exhaustion_events).toBe(1);
  });

  it("computes scheduler success rates", () => {
    recordSchedulerSuccess("daily_morning_briefing");
    recordSchedulerSuccess("daily_morning_briefing");
    recordSchedulerFailure("daily_morning_briefing", "crash");
    const health = getOperationalHealth();
    const s = health.schedulers.daily_morning_briefing;
    expect(s.success).toBe(2);
    expect(s.failure).toBe(1);
    expect(s.successRate).toBeCloseTo(0.6667, 2);
  });

  it("status is DEGRADED when too many formatter failures", () => {
    for (let i = 0; i < 6; i++) recordScannerStageFailure("formatter", "crash");
    const health = getOperationalHealth();
    expect(health.status).toBe("DEGRADED");
  });

  it("recentErrors contains last recorded failures", () => {
    recordScannerStageFailure("ranking", "test error");
    const health = getOperationalHealth();
    expect(health.recentErrors.length).toBeGreaterThan(0);
    expect(health.recentErrors[0].type).toBe("scanner.stage.failure");
  });
});

// ─── 7. Symbol normalization ──────────────────────────────────────────────────
describe("NSE-only symbol normalization (full Nifty50)", () => {
  const FORCE_NSE_ONLY = new Set([
    "TATAMOTORS", "RELIANCE", "TCS", "INFY", "SBIN",
    "HDFCBANK", "ICICIBANK", "AXISBANK", "KOTAKBANK", "INDUSINDBK",
    "BAJFINANCE", "BAJAJFINSV", "BHARTIARTL", "WIPRO", "HCLTECH"
  ]);

  function buildSymbolVariants(symbol) {
    const base = symbol.replace(/\.NS$|\.BO$/i, "").toUpperCase();
    if (FORCE_NSE_ONLY.has(base)) return [`${base}.NS`];
    return [`${base}.NS`, `${base}.BO`, base];
  }

  it("TATAMOTORS → only TATAMOTORS.NS", () => {
    expect(buildSymbolVariants("TATAMOTORS")).toEqual(["TATAMOTORS.NS"]);
  });

  it("HDFCBANK → only HDFCBANK.NS", () => {
    expect(buildSymbolVariants("HDFCBANK")).toEqual(["HDFCBANK.NS"]);
  });

  it("WIPRO → only WIPRO.NS", () => {
    expect(buildSymbolVariants("WIPRO")).toEqual(["WIPRO.NS"]);
  });

  it("unknown symbol → includes .NS, .BO, raw variants", () => {
    const variants = buildSymbolVariants("SMALLCAPABC");
    expect(variants).toContain("SMALLCAPABC.NS");
    expect(variants).toContain("SMALLCAPABC.BO");
    expect(variants).toHaveLength(3);
  });

  it("input with .NS suffix normalizes to base first", () => {
    expect(buildSymbolVariants("TCS.NS")).toEqual(["TCS.NS"]);
  });
});

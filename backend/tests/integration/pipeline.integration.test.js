import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockSupabase } from "./helpers/mockSupabase.js";

const eventLog = [];
let mockSupabase;

vi.mock("../../src/services/telemetry.service.js", () => ({
  createTraceId: (prefix = "test") => `${prefix}_trace`,
  logEvent: (event, details = {}) => {
    eventLog.push({ event, ...details });
  },
  logError: (event, error, details = {}) => {
    eventLog.push({ event, message: error?.message || "error", ...details });
  }
}));

vi.mock("../../src/services/supabase.service.js", () => ({
  default: new Proxy({}, {
    get(_target, prop) {
      return mockSupabase[prop].bind(mockSupabase);
    }
  })
}));

vi.mock("../../src/services/marketData.service.js", () => ({
  getHistoricalCandles: async () => ([
    { date: "2026-01-01T00:00:00.000Z", open: 100, high: 104, low: 99, close: 102 },
    { date: "2026-01-02T00:00:00.000Z", open: 102, high: 108, low: 101, close: 107 },
    { date: "2026-01-03T00:00:00.000Z", open: 107, high: 110, low: 106, close: 109 }
  ])
}));

describe("integration: audit->outcome->stats->adaptive", () => {
  beforeEach(() => {
    eventLog.length = 0;
    mockSupabase = createMockSupabase({
      recommendation_audit: [],
      recommendation_outcomes: [],
      recommendation_statistics: [],
      confidence_calibration: [],
      strategy_performance: [],
      adaptive_model_state: [],
      model_drift_events: [],
      adaptive_recommendation_scores: []
    });
  });

  it("persists deterministic end-to-end pipeline without bootstrap contamination", async () => {
    const { insertRecommendationAudit } = await import("../../src/services/recommendationAudit.service.js");
    const { initializeOutcomeForRecommendation, syncRecommendationOutcomes } = await import("../../src/services/recommendationOutcome.service.js");
    const { runStatisticalValidation } = await import("../../src/services/statisticalValidation.service.js");
    const { runAdaptiveRecalibration } = await import("../../src/services/adaptiveIntelligence.service.js");

    for (let i = 0; i < 35; i += 1) {
      const recommendationId = `rec_${i}`;
      await insertRecommendationAudit({
        recommendationId,
        symbol: "TCS",
        exchange: "NSE",
        recommendationType: "BUY",
        action: "BUY",
        confidence: 75,
        conviction: "MEDIUM",
        entryPrice: 100,
        stopLoss: 95,
        targetPrice: 108,
        rrRatio: 1.6,
        horizon: "SWING",
        sector: "IT",
        marketRegime: "BULL",
        valuationScore: 7,
        technicalScore: 7,
        riskScore: 4,
        liquidityScore: 8,
        volatilityScore: 2,
        aiSummary: "deterministic test recommendation",
        reasoningSnapshot: {},
        indicatorSnapshot: {},
        marketSnapshot: {},
        providerMetadata: { source: "test" },
        analysisVersion: "integration-test",
        generatedBy: "test-suite",
        userId: "u1",
        telegramChatId: "c1",
        createdAt: "2026-01-01T00:00:00.000Z"
      });
      await initializeOutcomeForRecommendation({
        recommendation_id: recommendationId,
        symbol: "TCS",
        entry_price: 100,
        rr_ratio: 1.6,
        volatility_score: 2,
        horizon: "SWING",
        provider_metadata: { source: "test" },
        created_at: "2026-01-01T00:00:00.000Z"
      });
    }

    const outcomeResult = await syncRecommendationOutcomes({ onlyOpen: true, limit: 100 });
    expect(outcomeResult.processed).toBeGreaterThan(0);

    // force closed deterministic TARGET_HIT outcomes for stable downstream stats
    const outRows = mockSupabase.__getTable("recommendation_outcomes").map((r) => ({
      ...r,
      outcome_status: "TARGET_HIT",
      realized_return_pct: 6,
      recommendation_created_at: "2026-01-01T00:00:00.000Z",
      closed_at: "2026-01-03T00:00:00.000Z"
    }));
    mockSupabase = createMockSupabase({
      recommendation_audit: mockSupabase.__getTable("recommendation_audit"),
      recommendation_outcomes: outRows,
      recommendation_statistics: [],
      confidence_calibration: [],
      strategy_performance: [],
      adaptive_model_state: [],
      model_drift_events: [],
      adaptive_recommendation_scores: []
    });

    const statsResult = await runStatisticalValidation({ calculationWindow: "ALL_TIME" });
    expect(statsResult.status).toBeUndefined();
    expect(mockSupabase.__getTable("recommendation_statistics").length).toBeGreaterThan(0);
    expect(mockSupabase.__getTable("confidence_calibration").length).toBeGreaterThan(0);
    expect(mockSupabase.__getTable("confidence_calibration").some((r) => r.confidence_bucket === "BOOTSTRAP")).toBe(false);

    const adaptiveResult = await runAdaptiveRecalibration({ windowDays: 365 });
    expect(adaptiveResult.models_processed).toBeGreaterThan(0);
    expect(mockSupabase.__getTable("adaptive_model_state").length).toBeGreaterThan(0);
    expect(mockSupabase.__getTable("adaptive_recommendation_scores").length).toBeGreaterThan(0);
    expect(eventLog.some((e) => e.event === "statistics.validation.completed")).toBe(true);
    expect(eventLog.some((e) => e.event === "adaptive.recalibration.completed")).toBe(true);
  });
});

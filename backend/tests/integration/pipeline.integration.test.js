import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockSupabase } from "./helpers/mockSupabase.js";

const eventLog = [];
let mockSupabase;
const telegramAlerts = [];
const telegramAlertsDetailed = [];

vi.mock("../../src/services/telemetry.service.js", () => ({
  createTraceId: (prefix = "test") => `${prefix}_trace`,
  logEvent: (event, details = {}) => {
    eventLog.push({ event, ...details });
  },
  logError: (event, error, details = {}) => {
    eventLog.push({ event, message: error?.message || "error", ...details });
  },
  logMetric: (metric, value, details = {}) => {}
}));

vi.mock("../../src/services/supabase.service.js", () => ({
  isSupabaseSchemaMissing: (error) => false,
  logInfraFallbackOnce: (key, message) => {},
  default: new Proxy({}, {
    get(_target, prop) {
      return mockSupabase[prop].bind(mockSupabase);
    }
  })
}));

vi.mock("../../src/services/alert.service.js", () => ({
  sendTelegramAlert: async (message) => {
    telegramAlerts.push(message);
  }
}));

vi.mock("../../src/services/telegram.service.js", () => ({
  default: {
    telegram: {
      sendMessage: async (chatId, message) => {
        telegramAlerts.push(message);
        telegramAlertsDetailed.push({ chatId, message });
        return { message_id: 999 };
      }
    }
  }
}));

let mockLiveMarketDataResponse = {
  symbol: "TCS",
  currentPrice: 109,
  price: 109,
  regularMarketPrice: 109,
  chosenPrice: 109,
  chosenPriceField: "regularMarketPrice",
  priceSource: "YAHOO",
  priceField: "regularMarketPrice",
  completeness: "FULL",
  dataConfidence: "HIGH",
  status: "LIVE",
  isMarketOpen: true,
  marketStatus: { isMarketOpen: true }
};

vi.mock("../../src/services/marketData.service.js", () => ({
  getHistoricalCandles: async () => ([
    { date: "2026-01-01T00:00:00.000Z", open: 100, high: 104, low: 99, close: 102 },
    { date: "2026-01-02T00:00:00.000Z", open: 102, high: 108, low: 101, close: 107 },
    { date: "2026-01-03T00:00:00.000Z", open: 107, high: 110, low: 106, close: 109 }
  ]),
  getLiveMarketData: async () => {
    if (mockLiveMarketDataResponse === null) return null;
    return mockLiveMarketDataResponse;
  },
  getIndianIndices: async () => ({ nifty: { change: 0.5 }, sensex: { change: 0.4 } }),
  getIndianSectors: async () => ({ bank: 0.2, it: 0.5 }),
  getIndianMarketNews: async () => ["Market rises today on strong earnings", "IT sector leads gains"]
}));

describe("integration: audit->outcome->stats->adaptive", () => {
  beforeEach(() => {
    eventLog.length = 0;
    telegramAlerts.length = 0;
    telegramAlertsDetailed.length = 0;
    mockSupabase = createMockSupabase({
      recommendation_audit: [],
      recommendation_outcomes: [],
      recommendation_statistics: [],
      confidence_calibration: [],
      strategy_performance: [],
      adaptive_model_state: [],
      model_drift_events: [],
      adaptive_recommendation_scores: [],
      subscribers: [
        { telegram_chat_id: "123456", status: "active" }
      ]
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
        providerMetadata: { source: "YAHOO" },
        analysisVersion: "integration-test",
        generatedBy: "pipeline-suite",
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
        provider_metadata: { source: "YAHOO" },
        created_at: "2026-01-01T00:00:00.000Z"
      });
    }

    const outcomeResult = await syncRecommendationOutcomes({ onlyOpen: true, limit: 100 });
    expect(outcomeResult.processed).toBeGreaterThan(0);
    expect(telegramAlerts.some((message) => message.includes("✅ TARGET HIT"))).toBe(true);
    expect(telegramAlerts.some((message) => message.includes("Action:\nMove Stop Loss to Cost"))).toBe(true);
    expect(telegramAlerts.some((message) => message.includes("Momentum continuation confirmed."))).toBe(true);

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

  it("filters lifecycle notifications based on subscriber preferences", async () => {
    const { initializeOutcomeForRecommendation, syncRecommendationOutcomes } = await import("../../src/services/recommendationOutcome.service.js");
    
    mockSupabase = createMockSupabase({
      recommendation_audit: [
        {
          recommendation_id: "rec_filter_live",
          symbol: "TCS",
          exchange: "NSE",
          recommendation_type: "BUY",
          action: "BUY",
          confidence: 75,
          conviction: "MEDIUM",
          entry_price: 100,
          stop_loss: 95,
          target_price: 108,
          rr_ratio: 1.6,
          horizon: "SWING",
          sector: "IT",
          risk_score: 5,
          created_at: "2026-01-01T00:00:00.000Z"
        }
      ],
      recommendation_outcomes: [],
      subscribers: [
        // Match: risk low (<=3) - NO (recomm is 5)
        { telegram_chat_id: "111", status: "active", preferred_risk: "LOW", preferred_sectors: ["IT"], enable_trade_updates: true },
        // Match: risk medium (<=6) and sector IT - YES
        { telegram_chat_id: "222", status: "active", preferred_risk: "MEDIUM", preferred_sectors: ["IT"], enable_trade_updates: true },
        // Match: risk high (<=10) but sector Auto - NO
        { telegram_chat_id: "333", status: "active", preferred_risk: "HIGH", preferred_sectors: ["AUTO"], enable_trade_updates: true },
        // Match: trade updates disabled - NO
        { telegram_chat_id: "444", status: "active", preferred_risk: null, preferred_sectors: null, enable_trade_updates: false },
        // Match: no preferences - YES
        { telegram_chat_id: "555", status: "active", preferred_risk: null, preferred_sectors: null, enable_trade_updates: true }
      ]
    });

    await initializeOutcomeForRecommendation({
      recommendation_id: "rec_filter_live",
      symbol: "TCS",
      entry_price: 100,
      rr_ratio: 1.6,
      volatility_score: 2,
      horizon: "SWING",
      provider_metadata: { source: "YAHOO" },
      created_at: "2026-01-01T00:00:00.000Z"
    });

    telegramAlertsDetailed.length = 0;
    const outcomeResult = await syncRecommendationOutcomes({ onlyOpen: true, limit: 100 });
    expect(outcomeResult.processed).toBeGreaterThan(0);
    
    // Only "222" and "555" should receive the messages
    const receivedChatIds = telegramAlertsDetailed.map(a => a.chatId);
    const uniqueChatIds = Array.from(new Set(receivedChatIds)).sort();
    expect(uniqueChatIds).toEqual(["222", "555"]);
  });

  it("handles empty/non-actionable setups safely in scanner agent and pipeline", async () => {
    const { runMorningScannerPipeline, scannerAgent } = await import("../../src/agents/scanner.agent.js");

    try {
      mockLiveMarketDataResponse = null;
      eventLog.length = 0;
      const morningResult = await runMorningScannerPipeline(5);
      expect(morningResult.status).toBe("NO_ACTIONABLE_SETUPS");
      expect(morningResult.recommendations).toEqual([]);
      expect(morningResult.suppressed).toBe(true);
      expect(morningResult.report).toContain("No actionable opportunities identified today.");

      const agentResult = await scannerAgent();
      expect(agentResult.status).toBe("NO_ACTIONABLE_SETUPS");
      expect(agentResult.recommendations).toEqual([]);
      expect(agentResult.suppressed).toBe(true);

      // Verify telemetry was logged
      expect(eventLog.some((e) => e.event === "scanner.no_actionable_setups")).toBe(true);
    } finally {
      mockLiveMarketDataResponse = { currentPrice: 109 };
    }
  });
}, 30000);

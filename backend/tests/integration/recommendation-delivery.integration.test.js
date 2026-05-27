import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockSupabase } from "./helpers/mockSupabase.js";

process.env.TELEGRAM_BOT_TOKEN = "1234567890:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi";
process.env.TELEGRAM_CHAT_ID = "test-chat";

let mockSupabase;
let telegramSendMessage;
let runtimeState;

beforeEach(async () => {
  vi.resetModules();

  telegramSendMessage = vi.fn(async () => ({ message_id: 999 }));

  runtimeState = {
    connected: true,
    degradedMode: false,
    lastSuccessfulConnection: "2026-05-20T00:00:00.000Z"
  };

  mockSupabase = createMockSupabase({
    recommendation_audit: [seedRow()],
    subscribers: [
      { telegram_chat_id: "123456", status: "active" },
      { telegram_chat_id: "456789", status: "active" },
      { telegram_chat_id: "999999", status: "inactive" }
    ]
  });

  vi.mock("../../src/services/telemetry.service.js", () => ({
    logEvent: vi.fn(),
    logError: vi.fn()
  }));

  vi.mock("../../src/services/supabase.service.js", () => ({
    default: new Proxy({}, {
      get(_target, prop) {
        return mockSupabase[prop].bind(mockSupabase);
      }
    })
  }));

  vi.mock("../../src/services/telegram.service.js", () => ({
    default: {
      telegram: {
        sendMessage: (...args) => telegramSendMessage(...args)
      }
    },
    formatAnalysis: (res, symbol) => `formatted:${symbol}:${res?.decision?.finalDecision || "HOLD"}`,
    getTelegramRuntimeState: () => runtimeState
  }));
});

function seedRow(overrides = {}) {
  return {
    recommendation_id: "REC-1",
    symbol: "INFY.NS",
    exchange: "NSE",
    recommendation_type: "BUY",
    action: "BUY",
    confidence: 58,
    conviction: "HIGH",
    entry_price: 1480,
    stop_loss: 1450,
    target_price: 1525,
    rr_ratio: 2.33,
    horizon: "SWING",
    ai_summary: "Institutional hold guidance",
    reasoning_snapshot: {
      technical: {
        trend: "Bullish",
        momentum: "Strong",
        volume: "Above Average"
      }
    },
    telegram_delivery_status: "PENDING",
    telegram_delivery_attempts: 0,
    created_at: new Date().toISOString(),
    indicator_snapshot: {
      trend: "Bullish",
      momentum: "Strong",
      volumeTrend: "Above Average"
    },
    market_snapshot: {},
    telegram_chat_id: "123456",
    telegram_delivery_last_attempt: null,
    telegram_delivery_error: null,
    ...overrides
  };
}

describe("integration: recommendation delivery pipeline", () => {
  it("pending recommendation sends and persists SENT state", async () => {
    const { processRecommendationDeliveryBatch } = await import(
      "../../src/services/recommendationDelivery.service.js"
    );

    const result = await processRecommendationDeliveryBatch({ batchSize: 10 });

    expect(result.sent).toBe(1);
    expect(telegramSendMessage).toHaveBeenCalledTimes(2);
    expect(telegramSendMessage.mock.calls.map((call) => call[0])).toEqual(["123456", "456789"]);
    expect(telegramSendMessage.mock.calls[0][1]).toContain("🚨 INSTITUTIONAL SIGNAL");
    expect(telegramSendMessage.mock.calls[0][1]).toContain("Stock: INFY.NS");

    const row = mockSupabase.__getTable("recommendation_audit")[0];
    expect(row.telegram_delivery_status).toBe("SENT");
    expect(row.telegram_delivery_message_id).toBe("123456:999|456789:999");
    expect(row.telegram_delivery_attempts).toBe(1);
    expect(row.telegram_delivery_sent_at).toBeTruthy();
  });

  it("telegram failure marks RETRY_SCHEDULED", async () => {
    telegramSendMessage = vi.fn(async () => {
      throw new Error("telegram network down");
    });

    const { processRecommendationDeliveryBatch } = await import(
      "../../src/services/recommendationDelivery.service.js"
    );

    const result = await processRecommendationDeliveryBatch({ batchSize: 10 });

    expect(result.retrying).toBe(1);
    expect(telegramSendMessage).toHaveBeenCalledTimes(1);

    const row = mockSupabase.__getTable("recommendation_audit")[0];
    expect(row.telegram_delivery_status).toBe("RETRY_SCHEDULED");
    expect(row.telegram_delivery_attempts).toBe(1);
    expect(String(row.telegram_delivery_error)).toContain("telegram network down");
  });

  it("duplicate poll never resends SENT recommendation", async () => {
    const { processRecommendationDeliveryBatch } = await import(
      "../../src/services/recommendationDelivery.service.js"
    );

    await processRecommendationDeliveryBatch({ batchSize: 10 });
    await processRecommendationDeliveryBatch({ batchSize: 10 });

    expect(telegramSendMessage).toHaveBeenCalledTimes(2);

    const row = mockSupabase.__getTable("recommendation_audit")[0];
    expect(row.telegram_delivery_status).toBe("SENT");
  });

  it("parallel batch runners claim once and suppress duplicate sends", async () => {
    let releaseSend;
    let notifyFirstSendReady;
    const firstSendReady = new Promise((resolve) => {
      notifyFirstSendReady = resolve;
    });
    let gateUsed = false;

    telegramSendMessage = vi.fn(() => {
      if (!gateUsed) {
        gateUsed = true;
        return new Promise((resolve) => {
          releaseSend = () => resolve({ message_id: 999 });
          notifyFirstSendReady();
        });
      }
      return Promise.resolve({ message_id: 999 });
    });

    const { processRecommendationDeliveryBatch } = await import(
      "../../src/services/recommendationDelivery.service.js"
    );

    const firstRun = processRecommendationDeliveryBatch({ batchSize: 10 });
    const secondRun = processRecommendationDeliveryBatch({ batchSize: 10 });

    await firstSendReady;
    releaseSend();

    const [firstResult, secondResult] = await Promise.all([firstRun, secondRun]);

    expect(firstResult.sent + secondResult.sent).toBe(1);
    expect(firstResult.skipped + secondResult.skipped).toBe(1);
    expect(telegramSendMessage).toHaveBeenCalledTimes(2);
    expect(telegramSendMessage.mock.calls.map((call) => call[0])).toEqual(["123456", "456789"]);

    const row = mockSupabase.__getTable("recommendation_audit")[0];
    expect(row.telegram_delivery_status).toBe("SENT");
    expect(row.telegram_delivery_attempts).toBe(1);
  });

  it("HOLD recommendation is suppressed", async () => {
    mockSupabase = createMockSupabase({
      recommendation_audit: [
        seedRow({
          action: "HOLD",
          recommendation_type: "HOLD",
          confidence: 30
        })
      ],
      subscribers: [
        { telegram_chat_id: "123456", status: "active" }
      ]
    });

    const { processRecommendationDeliveryBatch } = await import(
      "../../src/services/recommendationDelivery.service.js"
    );

    const result = await processRecommendationDeliveryBatch({ batchSize: 10 });

    expect(result.suppressed).toBe(1);
    expect(telegramSendMessage).toHaveBeenCalledTimes(0);

    const row = mockSupabase.__getTable("recommendation_audit")[0];
    expect(row.telegram_delivery_status).toBe("SUPPRESSED");
    expect(row.telegram_delivery_error).toBe("NON_ACTIONABLE_RECOMMENDATION");
  });

  it("degraded mode queues safely without crashing", async () => {
    runtimeState = {
      connected: false,
      degradedMode: true,
      lastSuccessfulConnection: null
    };

    const { processRecommendationDeliveryBatch } = await import(
      "../../src/services/recommendationDelivery.service.js"
    );

    const result = await processRecommendationDeliveryBatch({ batchSize: 10 });

    expect(result.sent).toBe(1);
    expect(telegramSendMessage).toHaveBeenCalledTimes(2);

    const row = mockSupabase.__getTable("recommendation_audit")[0];
    expect(row.telegram_delivery_status).toBe("SENT");
    expect(row.telegram_delivery_attempts).toBe(1);
    expect(row.telegram_delivery_error).toBeNull();
  });

  it("retry-scheduled recommendation waits for backoff and then retries once", async () => {
    const lastAttempt = new Date(Date.now() - 16000).toISOString();
    mockSupabase = createMockSupabase({
      recommendation_audit: [
        seedRow({
          telegram_delivery_status: "RETRY_SCHEDULED",
          telegram_delivery_attempts: 1,
          telegram_delivery_last_attempt: lastAttempt
        })
      ],
      subscribers: [
        { telegram_chat_id: "123456", status: "active" },
        { telegram_chat_id: "456789", status: "active" }
      ]
    });

    const { processRecommendationDeliveryBatch } = await import(
      "../../src/services/recommendationDelivery.service.js"
    );

    const result = await processRecommendationDeliveryBatch({ batchSize: 10 });

    expect(result.sent).toBe(1);
    expect(telegramSendMessage).toHaveBeenCalledTimes(2);

    const row = mockSupabase.__getTable("recommendation_audit")[0];
    expect(row.telegram_delivery_status).toBe("SENT");
    expect(row.telegram_delivery_attempts).toBe(2);
    expect(row.telegram_delivery_message_id).toBe("123456:999|456789:999");
  });

  it("retry only resumes undelivered subscribers after partial fanout failure", async () => {
    const sendPlan = [
      { ok: true, messageId: 701 },
      { ok: false, error: "telegram timeout" },
      { ok: true, messageId: 702 }
    ];

    telegramSendMessage = vi.fn(async () => {
      const next = sendPlan.shift();
      if (!next?.ok) {
        throw new Error(next?.error || "telegram failure");
      }
      return { message_id: next.messageId };
    });

    const { processRecommendationDeliveryBatch } = await import(
      "../../src/services/recommendationDelivery.service.js"
    );

    const firstResult = await processRecommendationDeliveryBatch({ batchSize: 10 });

    expect(firstResult.retrying).toBe(1);
    expect(telegramSendMessage).toHaveBeenCalledTimes(2);

    let row = mockSupabase.__getTable("recommendation_audit")[0];
    expect(row.telegram_delivery_status).toBe("RETRY_SCHEDULED");
    expect(row.telegram_delivery_attempts).toBe(1);
    expect(row.telegram_delivery_message_id).toBe("123456:701");

    row.telegram_delivery_last_attempt = new Date(Date.now() - 16000).toISOString();

    const secondResult = await processRecommendationDeliveryBatch({ batchSize: 10 });

    expect(secondResult.sent).toBe(1);
    expect(telegramSendMessage).toHaveBeenCalledTimes(3);
    expect(telegramSendMessage.mock.calls.map((call) => call[0])).toEqual(["123456", "456789", "456789"]);

    row = mockSupabase.__getTable("recommendation_audit")[0];
    expect(row.telegram_delivery_status).toBe("SENT");
    expect(row.telegram_delivery_attempts).toBe(2);
    expect(row.telegram_delivery_message_id).toBe("123456:701|456789:702");
  });

  it("filters subscribers by risk score and sector preferences", async () => {
    mockSupabase = createMockSupabase({
      recommendation_audit: [
        seedRow({
          risk_score: 5,
          sector: "IT",
        })
      ],
      subscribers: [
        // Match: risk low (<=3) - NO (recomm is 5)
        { telegram_chat_id: "111", status: "active", preferred_risk: "LOW", preferred_sectors: ["IT"] },
        // Match: risk medium (<=6) and sector IT - YES
        { telegram_chat_id: "222", status: "active", preferred_risk: "MEDIUM", preferred_sectors: ["IT"] },
        // Match: risk high (<=10) but sector Auto - NO
        { telegram_chat_id: "333", status: "active", preferred_risk: "HIGH", preferred_sectors: ["AUTO"] },
        // Match: no filters - YES
        { telegram_chat_id: "444", status: "active", preferred_risk: null, preferred_sectors: null }
      ]
    });

    const { processRecommendationDeliveryBatch } = await import(
      "../../src/services/recommendationDelivery.service.js"
    );

    const result = await processRecommendationDeliveryBatch({ batchSize: 10 });
    expect(result.sent).toBe(1);
    // Only "222" and "444" should receive it
    expect(telegramSendMessage).toHaveBeenCalledTimes(2);
    expect(telegramSendMessage.mock.calls.map((call) => call[0]).sort()).toEqual(["222", "444"]);
  });
});


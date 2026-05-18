import crypto from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockSupabase } from "./helpers/mockSupabase.js";

const telemetryEvents = [];
let mockSupabase;

vi.mock("../../src/services/telemetry.service.js", () => ({
  createTraceId: (prefix = "trace") => `${prefix}_test`,
  logEvent: (event, details = {}) => telemetryEvents.push({ event, ...details }),
  logError: (event, error, details = {}) => telemetryEvents.push({ event, message: error?.message || "err", ...details })
}));

vi.mock("../../src/services/telegram.service.js", () => ({
  default: {
    telegram: {
      sendMessage: vi.fn(async () => true)
    }
  }
}));

vi.mock("../../src/services/supabase.service.js", () => ({
  default: new Proxy({}, {
    get(_target, prop) {
      return mockSupabase[prop].bind(mockSupabase);
    }
  })
}));

function createRes() {
  return {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    }
  };
}

async function invokeWebhook(handler, body, signature = "", eventId = "evt_test") {
  const req = {
    headers: {
      "x-razorpay-signature": signature,
      "x-razorpay-event-id": eventId
    },
    body: Buffer.from(body, "utf8")
  };
  const res = createRes();
  await handler(req, res);
  return res;
}

describe("integration: webhook signature verification", () => {
  beforeEach(() => {
    telemetryEvents.length = 0;
    process.env.RAZORPAY_WEBHOOK_SECRET = "test_secret";
    mockSupabase = createMockSupabase({
      subscription_events: [],
      subscribers: [{ telegram_chat_id: "123", razorpay_subscription_id: "sub_1" }],
      payments: []
    });
  });

  it("accepts valid payload and rejects tampered/malformed/invalid/replay safely", async () => {
    const webhookRouter = (await import("../../src/routes/webhook.js")).default;
    const layer = webhookRouter.stack.find((l) => l?.route?.path === "/razorpay" && l.route.methods.post);
    const handler = layer.route.stack[layer.route.stack.length - 1].handle;

      const validBody = JSON.stringify({
        event: "payment.captured",
        payload: {
          payment: {
            entity: {
              id: "pay_1",
              subscription_id: "sub_1",
              amount: 1000,
              currency: "INR",
              notes: { telegram_chat_id: "123" }
            }
          }
        }
      });
      const validSig = crypto.createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET).update(validBody).digest("hex");
      const okRes = await invokeWebhook(handler, validBody, validSig, "evt_test_valid");
      expect(okRes.statusCode).toBe(200);

      const tampered = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: "pay_x" } } } });
      const tamperedRes = await invokeWebhook(handler, tampered, validSig, "evt_test_tampered");
      expect(tamperedRes.statusCode).toBe(401);

      const malformedBody = "{\"event\":";
      const malformedSig = crypto.createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET).update(malformedBody).digest("hex");
      const malformedRes = await invokeWebhook(handler, malformedBody, malformedSig, "evt_test_malformed");
      expect(malformedRes.statusCode).toBe(400);

      const invalidSigRes = await invokeWebhook(handler, validBody, "deadbeef", "evt_test_invalid_sig");
      expect(invalidSigRes.statusCode).toBe(401);

      const replayRes = await invokeWebhook(handler, validBody, validSig, "evt_test_valid");
      expect(replayRes.statusCode).toBe(200);
      expect(telemetryEvents.some((e) => e.event === "webhook.razorpay.replay_detected")).toBe(true);
      expect(mockSupabase.__getTable("payments").length).toBe(1);
  });
});

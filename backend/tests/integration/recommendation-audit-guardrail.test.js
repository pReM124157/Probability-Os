import { describe, expect, it } from "vitest";
import { insertRecommendationAudit } from "../../src/services/recommendationAudit.service.js";

describe("recommendation audit guardrail", () => {
  it("rejects HOLD recommendations before insert", async () => {
    await expect(insertRecommendationAudit({
      symbol: "TCS",
      exchange: "NSE",
      recommendationType: "HOLD",
      action: "HOLD",
      confidence: 62,
      entryPrice: 3200,
      stopLoss: 3120,
      targetPrice: 3340,
      rrRatio: 1.4
    })).rejects.toThrow(/not auditable/i);
  });
});


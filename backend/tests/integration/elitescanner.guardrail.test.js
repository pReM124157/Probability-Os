import { describe, expect, it } from "vitest";
import { validateSignal } from "../../src/scanner/signalGuards.js";
import { formatInstitutionalScannerReport } from "../../src/scanner/scannerFormatter.js";

function mkSignal(overrides = {}) {
  return {
    approved: true,
    stock: "TCS",
    decision: "BUY",
    confidenceScore: 82,
    rewardRiskRatio: 2.2,
    volumeRatio: 1.4,
    rsi: 62,
    currentPrice: 3200,
    stopLoss: 3020,
    idealEntryZone: "₹3180 - ₹3200",
    trend: "BULLISH",
    momentumConfirmed: true,
    allocation: "4%",
    strategy: "STRONG ENTRY",
    initialTarget: "₹3380",
    target2: "₹3440",
    ...overrides
  };
}

describe("elite scanner guardrails", () => {
  it("rejects rr below 1.5", () => {
    expect(validateSignal(mkSignal({ rewardRiskRatio: 1.04 })).approved).toBe(false);
  });

  it("rejects HOLD decision", () => {
    expect(validateSignal(mkSignal({ decision: "HOLD" })).approved).toBe(false);
  });

  it("rejects low confidence < 70", () => {
    expect(validateSignal(mkSignal({ confidenceScore: 64 })).approved).toBe(false);
  });

  it("rejects overbought RSI", () => {
    expect(validateSignal(mkSignal({ rsi: 80 })).approved).toBe(false);
  });

  it("rejects weak volume", () => {
    expect(validateSignal(mkSignal({ volumeRatio: 0.3 })).approved).toBe(false);
  });

  it("rejects stop wider than 6%", () => {
    expect(validateSignal(mkSignal({ stopLoss: 2800 })).approved).toBe(false);
  });

  it("rejects giant entry zone", () => {
    expect(validateSignal(mkSignal({ idealEntryZone: "₹2290 - ₹2835" })).approved).toBe(false);
  });

  it("rejects WAIT strategy", () => {
    expect(validateSignal(mkSignal({ strategy: "WAIT FOR SETUP" })).approved).toBe(false);
  });

  it("passes elite setup", () => {
    const verdict = validateSignal(mkSignal());
    expect(verdict.approved).toBe(true);
  });

  it("formatter blocks rejected signal delivery", () => {
    expect(() => formatInstitutionalScannerReport([mkSignal({ rewardRiskRatio: 0.66 })])).toThrow();
  });
});

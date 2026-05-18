import { describe, it, expect } from "vitest";
import {
  abstractStatus,
  sanitizeInstitutionalAction,
  synthesizePrimaryLimitation
} from "../../src/services/presentationAbstraction.service.js";

describe("integration: presentation abstraction + limitation synthesis", () => {
  it("abstracts raw engineering enums into institutional language", () => {
    const text = abstractStatus("INSUFFICIENT_REPLAY_DEPTH").message;
    expect(text).not.toContain("INSUFFICIENT_REPLAY_DEPTH");
    expect(text).toMatch(/institutional confidence thresholds/i);
  });

  it("collapses repeated reliability warnings into one primary limitation", () => {
    const result = synthesizePrimaryLimitation({
      replayStatus: "INSUFFICIENT_REPLAY_DEPTH",
      calibrationStatus: "INSUFFICIENT_DATA",
      driftStatus: "NOT_AVAILABLE_IN_THIS_PATH",
      benchmarkStatus: "NOT_AVAILABLE_IN_THIS_PATH",
      warnings: ["NON_EXECUTABLE_LIVE_PRICE", "NON_EXECUTABLE_LIVE_PRICE", "TRADABILITY_HOLD_BIAS"]
    });

    expect(result.primary.message).not.toMatch(/INSUFFICIENT_|NOT_AVAILABLE_|NON_EXECUTABLE|TRADABILITY_/);
    expect(result.supporting.length).toBeLessThanOrEqual(2);
  });

  it("rewrites generic wait-for-confirmation language into institutional execution language", () => {
    const rewritten = sanitizeInstitutionalAction("Wait for confirmation after market opens.");
    expect(rewritten.toLowerCase()).not.toContain("wait for confirmation");
    expect(rewritten).toMatch(/institutional execution thresholds/i);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockSupabase } from "./helpers/mockSupabase.js";

let mockSupabase;

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

describe("integration: bootstrap contamination guard", () => {
  beforeEach(() => {
    mockSupabase = createMockSupabase({
      recommendation_outcomes: [],
      recommendation_audit: [],
      recommendation_statistics: [],
      confidence_calibration: [],
      strategy_performance: []
    });
  });

  it("returns deterministic INSUFFICIENT_DATA and persists nothing under threshold", async () => {
    const { runStatisticalValidation } = await import("../../src/services/statisticalValidation.service.js");
    const result = await runStatisticalValidation({ calculationWindow: "ALL_TIME" });
    expect(result).toEqual({
      status: "INSUFFICIENT_DATA",
      minimumRequired: 30,
      current: 0
    });
    expect(mockSupabase.__getTable("recommendation_statistics")).toHaveLength(0);
    expect(mockSupabase.__getTable("confidence_calibration")).toHaveLength(0);
    expect(mockSupabase.__getTable("strategy_performance")).toHaveLength(0);
  });
});

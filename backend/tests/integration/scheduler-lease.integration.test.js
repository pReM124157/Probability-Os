import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockSupabase } from "./helpers/mockSupabase.js";

let mockSupabase;

vi.mock("../../src/services/telemetry.service.js", () => ({
  createTraceId: (prefix = "trace") => `${prefix}_${Math.random().toString(36).slice(2)}`,
  logEvent: vi.fn(),
  logError: vi.fn()
}));

vi.mock("../../src/services/supabase.service.js", () => ({
  default: new Proxy({}, {
    get(_target, prop) {
      return mockSupabase[prop].bind(mockSupabase);
    }
  }),
  isSupabaseSchemaMissing: () => false,
  logInfraFallbackOnce: vi.fn()
}));

describe("integration: scheduler lease conflict", () => {
  beforeEach(() => {
    mockSupabase = createMockSupabase();
    let claimCount = 0;
    const baseRpc = mockSupabase.rpc.bind(mockSupabase);
    mockSupabase.rpc = async (name, params = {}) => {
      if (name === "claim_scheduler_lease") {
        claimCount += 1;
        return { data: claimCount === 1, error: null };
      }
      return baseRpc(name, params);
    };
  });

  it("allows only one winner across concurrent lease claims", async () => {
    const { claimSchedulerLease } = await import("../../src/services/schedulerLease.service.js");
    const [a, b] = await Promise.all([
      claimSchedulerLease("scheduler:test_conflict", 60),
      claimSchedulerLease("scheduler:test_conflict", 60)
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
  });
});

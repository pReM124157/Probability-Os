import { describe, it, expect } from "vitest";
import { normalizeFundamentalMetrics } from "../../src/services/marketData.service.js";

describe("integration: fundamental metric normalization", () => {
  it("normalizes debt/equity 100x mismatch to canonical ratio", () => {
    const normalized = normalizeFundamentalMetrics({
      provider: "yahoo",
      symbol: "RELIANCE.NS",
      raw: {
        debtToEquity: 36.65,
        roe: 0.128,
        profitMargin: 0.093,
        revenueGrowth: 0.14,
        earningsGrowth: 0.19,
        pe: 24.12
      }
    });

    expect(normalized.canonical.debtToEquity).toBeCloseTo(0.3665, 4);
    expect(normalized.display.debtToEquity).toBe("0.37");
  });

  it("keeps already canonical debt/equity ratio unchanged", () => {
    const normalized = normalizeFundamentalMetrics({
      provider: "alpha_vantage",
      symbol: "TCS.NS",
      raw: { debtToEquity: "0.36" }
    });

    expect(normalized.canonical.debtToEquity).toBeCloseTo(0.36, 2);
    expect(normalized.display.debtToEquity).toBe("0.36");
  });

  it("handles malformed and null metric values fail-closed", () => {
    const normalized = normalizeFundamentalMetrics({
      provider: "finnhub",
      symbol: "INFY.NS",
      raw: {
        debtToEquity: "N/A",
        roe: null,
        profitMargin: "bad-data"
      }
    });

    expect(normalized.canonical.debtToEquity).toBeNull();
    expect(normalized.display.debtToEquity).toBe("-");
    expect(normalized.display.roe).toBe("-");
    expect(normalized.display.profitMargin).toBe("-");
  });

  it("normalizes yahoo decimal percent metrics to percent display", () => {
    const normalized = normalizeFundamentalMetrics({
      provider: "yahoo",
      symbol: "HDFCBANK.NS",
      raw: {
        roe: 0.1678,
        profitMargin: 0.214,
        revenueGrowth: 0.112,
        earningsGrowth: -0.052
      }
    });

    expect(normalized.display.roe).toBe("16.78%");
    expect(normalized.display.profitMargin).toBe("21.40%");
    expect(normalized.display.revenueGrowth).toBe("11.20%");
    expect(normalized.display.earningsGrowth).toBe("-5.20%");
  });

  it("rejects impossible debt/equity values", () => {
    const normalized = normalizeFundamentalMetrics({
      provider: "finnhub",
      symbol: "ICICIBANK.NS",
      raw: { debtToEquity: 99000 }
    });

    expect(normalized.canonical.debtToEquity).toBeNull();
    expect(normalized.display.debtToEquity).toBe("-");
  });
});


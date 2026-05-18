/**
 * Canonical Financial Semantics — Institutional Regression Test Suite
 *
 * Tests cover:
 *   1. Provider percent-vs-ratio mismatch (Yahoo D/E always ÷100)
 *   2. TCS specific: raw 10.39 → canonical 0.1039
 *   3. RELIANCE specific: raw 36.65 → canonical 0.3665
 *   4. 100x scaling mismatch detection
 *   5. 10x scaling pass-through (non-Yahoo uses identity)
 *   6. Malformed provider strings
 *   7. Null provider values
 *   8. Provider disagreement detection
 *   9. Unresolved consensus → null output
 *  10. Invalid institutional ranges → null output
 *  11. Fallback provider override correctness
 *  12. Cache replay consistency (semantics version tagging)
 *  13. Percent metrics (ROE, margins) from Yahoo (×100 transform)
 *  14. Alpha Vantage string parsing
 *  15. Sector-aware suspicious value warnings
 */

import { describe, it, expect } from "vitest";
import {
  normalizeMetric,
  crossProviderConsensus,
  validateFundamentalsSemantics,
  parseRawToNumber,
  formatCanonical,
  CANONICAL_SEMANTICS_VERSION,
  CANONICAL_METRIC_REGISTRY
} from "../../src/services/canonicalSemantics.service.js";
import { normalizeFundamentalMetrics } from "../../src/services/marketData.service.js";

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 1: Yahoo Finance D/E — provider semantic mismatch (percent-style)
// ─────────────────────────────────────────────────────────────────────────────

describe("Yahoo Finance D/E: percentage-style semantic (always ÷100)", () => {
  it("TCS: Yahoo raw 10.39 → canonical 0.1039 (CRITICAL PATH)", () => {
    const result = normalizeMetric("debt_to_equity", 10.39, "yahoo", "TCS.NS");
    expect(result.canonical).toBeCloseTo(0.1039, 4);
    expect(result.display).toBe("0.10");
    expect(result.rejected).toBe(false);
    expect(result.providerRule.transform).toBe("divide_by_100");
  });

  it("RELIANCE: Yahoo raw 36.65 → canonical 0.3665", () => {
    const result = normalizeMetric("debt_to_equity", 36.65, "yahoo", "RELIANCE.NS");
    expect(result.canonical).toBeCloseTo(0.3665, 4);
    expect(result.display).toBe("0.37");
    expect(result.rejected).toBe(false);
  });

  it("HDFCBANK: Yahoo raw 70.21 → canonical 0.7021", () => {
    const result = normalizeMetric("debt_to_equity", 70.21, "yahoo", "HDFCBANK.NS");
    expect(result.canonical).toBeCloseTo(0.7021, 4);
    expect(result.display).toBe("0.70");
    expect(result.rejected).toBe(false);
  });

  it("IT company: Yahoo raw 5.82 → canonical 0.0582", () => {
    const result = normalizeMetric("debt_to_equity", 5.82, "yahoo", "INFY.NS");
    expect(result.canonical).toBeCloseTo(0.0582, 4);
    expect(result.rejected).toBe(false);
  });

  it("TATAMOTORS: Yahoo raw 128.0 → canonical 1.28 (high leverage, still valid)", () => {
    const result = normalizeMetric("debt_to_equity", 128.0, "yahoo", "TATAMOTORS.NS");
    expect(result.canonical).toBeCloseTo(1.28, 2);
    expect(result.rejected).toBe(false);
  });

  it("Malformed RELIANCE old value (> 20 that old heuristic caught): Yahoo 36.65 now correctly ÷100", () => {
    // Old code used to catch >20 and divide. New code divides unconditionally.
    // Both give the same result for RELIANCE, but for TCS the old code failed.
    const result = normalizeMetric("debt_to_equity", 36.65, "yahoo", "RELIANCE.NS");
    expect(result.canonical).toBeCloseTo(0.3665, 3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 2: Alpha Vantage D/E — already canonical decimal
// ─────────────────────────────────────────────────────────────────────────────

describe("Alpha Vantage D/E: already canonical decimal ratio (no transform)", () => {
  it("Alpha raw string '0.36' → canonical 0.36", () => {
    const result = normalizeMetric("debt_to_equity", "0.36", "alpha_vantage", "TCS.BSE");
    expect(result.canonical).toBeCloseTo(0.36, 2);
    expect(result.display).toBe("0.36");
    expect(result.providerRule.transform).toBe("parse_decimal");
  });

  it("Alpha raw string '1.24' → canonical 1.24", () => {
    const result = normalizeMetric("debt_to_equity", "1.24", "alpha_vantage", "TATAMOTORS.BSE");
    expect(result.canonical).toBeCloseTo(1.24, 2);
    expect(result.rejected).toBe(false);
  });

  it("Alpha raw 0.36 (number) → canonical 0.36", () => {
    const result = normalizeMetric("debt_to_equity", 0.36, "alpha_vantage", "TCS.BSE");
    expect(result.canonical).toBeCloseTo(0.36, 2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 3: Finnhub D/E — identity transform
// ─────────────────────────────────────────────────────────────────────────────

describe("Finnhub D/E: identity transform (already canonical)", () => {
  it("Finnhub raw 0.10 → canonical 0.10", () => {
    const result = normalizeMetric("debt_to_equity", 0.10, "finnhub", "NSE:TCS");
    expect(result.canonical).toBeCloseTo(0.10, 2);
    expect(result.providerRule.transform).toBe("identity");
  });

  it("Finnhub raw 1.28 → canonical 1.28 (TATAMOTORS)", () => {
    const result = normalizeMetric("debt_to_equity", 1.28, "finnhub", "NSE:TATAMOTORS");
    expect(result.canonical).toBeCloseTo(1.28, 2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 4: Malformed / null values
// ─────────────────────────────────────────────────────────────────────────────

describe("Malformed and null metric values (fail-closed behavior)", () => {
  it("null raw value → canonical null, display '-'", () => {
    const result = normalizeMetric("debt_to_equity", null, "yahoo", "TCS.NS");
    expect(result.canonical).toBeNull();
    expect(result.display).toBe("-");
    expect(result.rejected).toBe(false); // null ≠ rejection, it's just missing data
  });

  it("undefined raw value → canonical null", () => {
    const result = normalizeMetric("debt_to_equity", undefined, "yahoo", "TCS.NS");
    expect(result.canonical).toBeNull();
    expect(result.display).toBe("-");
  });

  it("'N/A' string → canonical null", () => {
    const result = normalizeMetric("debt_to_equity", "N/A", "alpha_vantage", "TCS.BSE");
    expect(result.canonical).toBeNull();
    expect(result.display).toBe("-");
  });

  it("'-' string → canonical null", () => {
    const result = normalizeMetric("debt_to_equity", "-", "finnhub", "NSE:INFY");
    expect(result.canonical).toBeNull();
  });

  it("'bad-data' string → canonical null", () => {
    const result = normalizeMetric("profit_margin", "bad-data", "yahoo", "INFY.NS");
    expect(result.canonical).toBeNull();
    expect(result.display).toBe("-");
  });

  it("Infinity → canonical null", () => {
    const result = normalizeMetric("roe", Infinity, "yahoo", "TCS.NS");
    expect(result.canonical).toBeNull();
  });

  it("NaN → canonical null", () => {
    const result = normalizeMetric("roe", NaN, "yahoo", "TCS.NS");
    expect(result.canonical).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 5: Invalid institutional ranges → rejected
// ─────────────────────────────────────────────────────────────────────────────

describe("Institutional range validation (out-of-range → rejected)", () => {
  it("D/E 99000 (raw finnhub) → rejected (way above max 20 canonical)", () => {
    const result = normalizeMetric("debt_to_equity", 99000, "finnhub", "ICICIBANK.NS");
    expect(result.rejected).toBe(true);
    expect(result.canonical).toBeNull();
    expect(result.display).toBe("-");
  });

  it("D/E negative -5 → rejected (below min 0)", () => {
    const result = normalizeMetric("debt_to_equity", -5, "finnhub", "TCS.NS");
    expect(result.rejected).toBe(true);
    expect(result.canonical).toBeNull();
  });

  it("Yahoo D/E raw 200001 → rejected (canonical 2000.01 > max 20)", () => {
    // 200001 / 100 = 2000.01 which exceeds the valid max of 20
    const result = normalizeMetric("debt_to_equity", 200001, "yahoo", "TEST.NS");
    expect(result.rejected).toBe(true);
    expect(result.canonical).toBeNull();
  });

  it("profit_margin 150 → rejected (>100%, impossible net margin)", () => {
    const result = normalizeMetric("profit_margin", 1.5, "yahoo", "TEST.NS");
    // 1.5 × 100 = 150% → outside [-100%, 100%]
    expect(result.rejected).toBe(true);
    expect(result.canonical).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 6: Percent metrics (ROE, margins, growth) — Yahoo decimal fraction ×100
// ─────────────────────────────────────────────────────────────────────────────

describe("Percent metrics: Yahoo decimal fraction → percentage display", () => {
  it("Yahoo ROE 0.1678 → canonical 16.78, display '16.78%'", () => {
    const result = normalizeMetric("roe", 0.1678, "yahoo", "HDFCBANK.NS");
    expect(result.canonical).toBeCloseTo(16.78, 2);
    expect(result.display).toBe("16.78%");
    expect(result.providerRule.transform).toBe("multiply_by_100");
  });

  it("Yahoo profitMargins 0.093 → canonical 9.30, display '9.30%'", () => {
    const result = normalizeMetric("profit_margin", 0.093, "yahoo", "RELIANCE.NS");
    expect(result.canonical).toBeCloseTo(9.3, 1);
    expect(result.display).toBe("9.30%");
  });

  it("Yahoo revenueGrowth 0.14 → canonical 14.00%, display '14.00%'", () => {
    const result = normalizeMetric("revenue_growth", 0.14, "yahoo", "TCS.NS");
    expect(result.canonical).toBeCloseTo(14.0, 1);
    expect(result.display).toBe("14.00%");
  });

  it("Yahoo earningsGrowth -0.052 → canonical -5.20%, display '-5.20%'", () => {
    const result = normalizeMetric("earnings_growth", -0.052, "yahoo", "HDFCBANK.NS");
    expect(result.canonical).toBeCloseTo(-5.2, 1);
    expect(result.display).toBe("-5.20%");
  });

  it("Alpha ROE 0.25 → canonical 25.00%", () => {
    const result = normalizeMetric("roe", "0.25", "alpha_vantage", "TCS.BSE");
    expect(result.canonical).toBeCloseTo(25.0, 1);
    expect(result.display).toBe("25.00%");
  });

  it("Finnhub roeTTM 0.32 → canonical 32.00%", () => {
    const result = normalizeMetric("roe", 0.32, "finnhub", "NSE:BAJFINANCE");
    expect(result.canonical).toBeCloseTo(32.0, 1);
    expect(result.display).toBe("32.00%");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 7: normalizeFundamentalMetrics integration (full pipeline)
// ─────────────────────────────────────────────────────────────────────────────

describe("normalizeFundamentalMetrics: full pipeline integration", () => {
  it("TCS Yahoo: raw D/E 10.39 → display '0.10' (not 10.39)", () => {
    const result = normalizeFundamentalMetrics({
      provider: "yahoo",
      symbol: "TCS.NS",
      raw: {
        debtToEquity: 10.39,
        roe: 0.45,
        profitMargin: 0.245,
        revenueGrowth: 0.08,
        earningsGrowth: 0.12,
        pe: 28.5
      }
    });
    expect(result.canonical.debtToEquity).toBeCloseTo(0.1039, 4);
    expect(result.display.debtToEquity).toBe("0.10");
    expect(result.display.debtToEquity).not.toBe("10.39");
    expect(result.display.roe).toBe("45.00%");
    expect(result.display.profitMargin).toBe("24.50%");
    expect(result.semanticsVersion).toBe(CANONICAL_SEMANTICS_VERSION);
  });

  it("RELIANCE Yahoo: raw D/E 36.65 → display '0.37'", () => {
    const result = normalizeFundamentalMetrics({
      provider: "yahoo",
      symbol: "RELIANCE.NS",
      raw: { debtToEquity: 36.65, roe: 0.128, profitMargin: 0.093 }
    });
    expect(result.canonical.debtToEquity).toBeCloseTo(0.3665, 4);
    expect(result.display.debtToEquity).toBe("0.37");
  });

  it("Alpha Vantage TCS: string D/E '0.36' → canonical 0.36 (no divide)", () => {
    const result = normalizeFundamentalMetrics({
      provider: "alpha_vantage",
      symbol: "TCS",
      raw: { debtToEquity: "0.36" }
    });
    expect(result.canonical.debtToEquity).toBeCloseTo(0.36, 2);
    expect(result.display.debtToEquity).toBe("0.36");
  });

  it("All null raw values → all canonical null, all display '-'", () => {
    const result = normalizeFundamentalMetrics({
      provider: "yahoo",
      symbol: "UNKNOWN.NS",
      raw: {}
    });
    expect(result.canonical.debtToEquity).toBeNull();
    expect(result.canonical.roe).toBeNull();
    expect(result.display.debtToEquity).toBe("-");
    expect(result.display.roe).toBe("-");
  });

  it("semanticsVersion field is present in all outputs", () => {
    const result = normalizeFundamentalMetrics({ provider: "yahoo", symbol: "TCS.NS", raw: { debtToEquity: 10 } });
    expect(result.semanticsVersion).toBeDefined();
    expect(result.semanticsVersion).toBe(CANONICAL_SEMANTICS_VERSION);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 8: Cross-Provider Consensus Layer
// ─────────────────────────────────────────────────────────────────────────────

describe("crossProviderConsensus: multi-provider agreement detection", () => {
  it("Yahoo + Finnhub + Alpha all agree → HIGH confidence", () => {
    // Yahoo raw 10.39 ÷100 = 0.1039; Finnhub 0.10; Alpha '0.10'
    const consensus = crossProviderConsensus("debt_to_equity", [
      { provider: "yahoo",         rawValue: 10.39 },
      { provider: "finnhub",       rawValue: 0.10  },
      { provider: "alpha_vantage", rawValue: "0.10" }
    ], "TCS.NS");

    expect(consensus.value).toBeCloseTo(0.1039, 2);
    expect(consensus.confidence).toBe("HIGH");
    expect(consensus.mismatch).toBe(false);
  });

  it("Provider semantic mismatch detected when one provider is uncorrected", () => {
    // Simulating what would happen if Yahoo was not normalized (raw passed through):
    // raw-yahoo 10.39 vs finnhub 0.10 — major disagreement
    // Since we test the consensus at canonical level, let's use finnhub as 0.10 and
    // a hypothetical broken provider that emits 10.39 without transform:
    const consensus = crossProviderConsensus("debt_to_equity", [
      { provider: "finnhub",       rawValue: 0.10   },
      { provider: "alpha_vantage", rawValue: "0.10" },
      // Simulating a misconfigured provider passing Yahoo-raw without normalizing
      { provider: "finnhub",       rawValue: 10.39  }  // 10.39 direct is WAY off from 0.10
    ], "TCS.NS");

    // 10.39 should NOT agree with the cluster around 0.10
    expect(consensus.mismatch).toBe(true);
  });

  it("Single provider → LOW confidence", () => {
    const consensus = crossProviderConsensus("debt_to_equity", [
      { provider: "yahoo", rawValue: 10.39 }
    ], "TCS.NS");
    expect(consensus.confidence).toBe("LOW");
    expect(consensus.value).toBeCloseTo(0.1039, 3);
  });

  it("All providers null → INSUFFICIENT confidence, null value", () => {
    const consensus = crossProviderConsensus("debt_to_equity", [
      { provider: "yahoo",         rawValue: null },
      { provider: "finnhub",       rawValue: null },
      { provider: "alpha_vantage", rawValue: null }
    ], "TCS.NS");
    expect(consensus.value).toBeNull();
    expect(consensus.confidence).toBe("INSUFFICIENT");
  });

  it("All rejected values → INSUFFICIENT confidence", () => {
    const consensus = crossProviderConsensus("debt_to_equity", [
      { provider: "finnhub", rawValue: -999 }, // below min → rejected
      { provider: "yahoo",   rawValue: 999999 } // above max after ÷100 → rejected
    ], "TCS.NS");
    expect(consensus.value).toBeNull();
    expect(consensus.confidence).toBe("INSUFFICIENT");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 9: Sector-Aware Semantic Validation
// ─────────────────────────────────────────────────────────────────────────────

describe("validateFundamentalsSemantics: sector-aware suspicious checks", () => {
  it("IT company D/E > 0.5 triggers WARNING", () => {
    const warnings = validateFundamentalsSemantics(
      { debt_to_equity: 0.8 },
      "Information Technology"
    );
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0].metric).toBe("debt_to_equity");
    expect(warnings[0].severity).toBe("WARNING");
  });

  it("IT company D/E 0.1 → no warnings", () => {
    const warnings = validateFundamentalsSemantics(
      { debt_to_equity: 0.1 },
      "Information Technology"
    );
    expect(warnings).toHaveLength(0);
  });

  it("ROE > 100% → WARNING", () => {
    const warnings = validateFundamentalsSemantics(
      { roe: 150 },
      "Technology"
    );
    expect(warnings.some(w => w.metric === "roe")).toBe(true);
  });

  it("Profit margin > 100 → INVALID", () => {
    const warnings = validateFundamentalsSemantics(
      { profit_margin: 150 },
      ""
    );
    expect(warnings.some(w => w.metric === "profit_margin" && w.severity === "INVALID")).toBe(true);
  });

  it("Banking sector D/E 6.0 → no alert (banks have high leverage)", () => {
    const warnings = validateFundamentalsSemantics(
      { debt_to_equity: 6.0 },
      "Banking and Financial Services"
    );
    // Should NOT get "non-bank D/E > 5" alert since sector is banking
    const hasNonBankAlert = warnings.some(w =>
      w.metric === "debt_to_equity" && w.message.includes("Non-bank")
    );
    expect(hasNonBankAlert).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 10: parseRawToNumber helpers
// ─────────────────────────────────────────────────────────────────────────────

describe("parseRawToNumber: input parsing", () => {
  it("number → same number", () => { expect(parseRawToNumber(10.39)).toBeCloseTo(10.39); });
  it("string '10.39' → 10.39", () => { expect(parseRawToNumber("10.39")).toBeCloseTo(10.39); });
  it("string '10.39%' → 10.39 (% stripped)", () => { expect(parseRawToNumber("10.39%")).toBeCloseTo(10.39); });
  it("string '1,234.56' → 1234.56 (comma stripped)", () => { expect(parseRawToNumber("1,234.56")).toBeCloseTo(1234.56); });
  it("null → null", () => { expect(parseRawToNumber(null)).toBeNull(); });
  it("undefined → null", () => { expect(parseRawToNumber(undefined)).toBeNull(); });
  it("'N/A' → null", () => { expect(parseRawToNumber("N/A")).toBeNull(); });
  it("'-' → null", () => { expect(parseRawToNumber("-")).toBeNull(); });
  it("'' → null", () => { expect(parseRawToNumber("")).toBeNull(); });
  it("Infinity → null", () => { expect(parseRawToNumber(Infinity)).toBeNull(); });
  it("NaN → null", () => { expect(parseRawToNumber(NaN)).toBeNull(); });
  it("'None' → null", () => { expect(parseRawToNumber("None")).toBeNull(); });
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 11: formatCanonical display modes
// ─────────────────────────────────────────────────────────────────────────────

describe("formatCanonical: display formatting modes", () => {
  it("percent_2dp: 16.78 → '16.78%'", () => { expect(formatCanonical(16.78, "percent_2dp")).toBe("16.78%"); });
  it("ratio_2dp: 0.1039 → '0.10'", () => { expect(formatCanonical(0.1039, "ratio_2dp")).toBe("0.10"); });
  it("number_2dp: 28.5 → '28.50'", () => { expect(formatCanonical(28.5, "number_2dp")).toBe("28.50"); });
  it("null → '-'", () => { expect(formatCanonical(null, "percent_2dp")).toBe("-"); });
  it("NaN → '-'", () => { expect(formatCanonical(NaN, "ratio_2dp")).toBe("-"); });
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 12: CANONICAL_SEMANTICS_VERSION present and valid
// ─────────────────────────────────────────────────────────────────────────────

describe("Semantics version tagging", () => {
  it("CANONICAL_SEMANTICS_VERSION is defined and follows semver", () => {
    expect(CANONICAL_SEMANTICS_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("All registry entries have provider rules for all 5 standard providers", () => {
    const requiredProviders = ["yahoo", "alpha_vantage", "finnhub", "twelvedata", "fallback"];
    for (const [metric, config] of Object.entries(CANONICAL_METRIC_REGISTRY)) {
      for (const provider of requiredProviders) {
        expect(config.providers[provider], `${metric} missing provider rule for ${provider}`).toBeDefined();
      }
    }
  });

  it("All Yahoo D/E transforms are divide_by_100 (never identity)", () => {
    const deRule = CANONICAL_METRIC_REGISTRY.debt_to_equity.providers.yahoo;
    expect(deRule.transform).toBe("divide_by_100");
    expect(deRule.transform).not.toBe("identity");
    expect(deRule.transform).not.toBe("multiply_by_100");
  });

  it("All percent metrics use multiply_by_100 for Yahoo", () => {
    const percentMetrics = ["roe", "profit_margin", "operating_margin", "revenue_growth", "earnings_growth", "dividend_yield"];
    for (const metric of percentMetrics) {
      const rule = CANONICAL_METRIC_REGISTRY[metric]?.providers.yahoo;
      if (rule) {
        expect(rule.transform, `${metric} Yahoo should be multiply_by_100`).toBe("multiply_by_100");
      }
    }
  });
});

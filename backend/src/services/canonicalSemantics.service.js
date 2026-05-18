/**
 * ╔══════════════════════════════════════════════════════════════════════════════╗
 * ║  CANONICAL FINANCIAL SEMANTICS ENGINE                                        ║
 * ║  Institutional-grade provider-aware metric normalization                     ║
 * ║                                                                              ║
 * ║  ARCHITECTURE PRINCIPLES:                                                    ║
 * ║  1. Every metric has a canonical internal unit (the ground-truth form)       ║
 * ║  2. Each provider has a deterministic transform to reach canonical form       ║
 * ║  3. No heuristic guessing — all transforms are documented and intentional    ║
 * ║  4. Validation is fail-closed with full audit trail                          ║
 * ║  5. Cache payloads carry semantic-version tags to prevent stale-data replay  ║
 * ╚══════════════════════════════════════════════════════════════════════════════╝
 *
 * PROVIDER SEMANTIC MAPPING MATRIX
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * METRIC: debt_to_equity
 *   Yahoo Finance (financialData.debtToEquity):
 *     → PERCENTAGE-STYLE RATIO  (value × 100 already applied by Yahoo)
 *     → Raw 10.39 means 10.39% → canonical 0.1039
 *     → Raw 36.65 means 36.65% → canonical 0.3665
 *     → Transform: DIVIDE_BY_100  ✓ always, unconditionally
 *
 *   Alpha Vantage (DebtToEquityRatio):
 *     → ALREADY CANONICAL DECIMAL RATIO (string like "0.36")
 *     → Transform: PARSE_DECIMAL (identity after parse)
 *
 *   Finnhub (totalDebtToEquityQuarterly / totalDebtToEquityAnnual):
 *     → ALREADY CANONICAL DECIMAL RATIO
 *     → Transform: IDENTITY
 *
 * METRIC: roe / profit_margin / revenue_growth / earnings_growth
 *   Yahoo Finance:
 *     → DECIMAL FRACTION (0.128 = 12.8%)
 *     → Transform: MULTIPLY_BY_100 to reach percentage display
 *
 *   Alpha Vantage (ReturnOnEquityTTM, ProfitMargin):
 *     → DECIMAL FRACTION (same as Yahoo)
 *     → Transform: MULTIPLY_BY_100
 *
 *   Finnhub (roeTTM, netMarginTTM, revenueGrowthTTMYoy):
 *     → DECIMAL FRACTION
 *     → Transform: MULTIPLY_BY_100
 *
 * METRIC: pe_ratio / beta / peg / current_ratio
 *   All providers:
 *     → ALREADY CANONICAL RATIO (no transform needed)
 *
 * METRIC: dividend_yield
 *   Yahoo Finance:
 *     → DECIMAL FRACTION (0.015 = 1.5%)
 *     → Transform: MULTIPLY_BY_100
 *
 *   Alpha Vantage (DividendYield):
 *     → ALREADY PERCENTAGE (0.015 returned as-is but interpreted as percent)
 *     → Transform: MULTIPLY_BY_100 (same behavior)
 */

import { logEvent } from "./telemetry.service.js";

/** Semantic version for cache invalidation. Bump this when normalization rules change. */
export const CANONICAL_SEMANTICS_VERSION = "2.0.0";

/**
 * CANONICAL METRIC REGISTRY
 *
 * Each entry defines:
 *   canonical_unit  — the internal ground-truth representation after normalization
 *   display_mode    — how to format for human display
 *   expected_range  — [min, max] of institutionally valid values (canonical units)
 *   suspicious_threshold — values above this warrant a warning even if in range
 *   providers       — deterministic per-provider transform
 */
export const CANONICAL_METRIC_REGISTRY = {

  debt_to_equity: {
    canonical_unit: "decimal_ratio",
    display_mode: "ratio_2dp",
    // In canonical (decimal) form: most companies 0–5, banks can be higher
    expected_range: [0, 20],
    suspicious_threshold: 5,
    description: "Total debt divided by total shareholders equity (decimal ratio, e.g. 0.10 = 10%)",
    providers: {
      yahoo: {
        transform: "divide_by_100",
        rationale: "Yahoo financialData.debtToEquity is percentage-style (already ×100). 10.39 means 10.39% → 0.1039",
        // Yahoo values in canonical space expected to be 0–20 (raw 0–2000 before transform)
        raw_suspicious_above: 1000  // >1000 raw is truly malformed even for Yahoo
      },
      alpha_vantage: {
        transform: "parse_decimal",
        rationale: "Alpha DebtToEquityRatio is already a canonical decimal string like '0.36'",
        raw_suspicious_above: 20
      },
      finnhub: {
        transform: "identity",
        rationale: "Finnhub totalDebtToEquity* is already canonical decimal ratio",
        raw_suspicious_above: 20
      },
      twelvedata: {
        transform: "identity",
        rationale: "TwelveData provides canonical decimal ratio",
        raw_suspicious_above: 20
      },
      fallback: {
        transform: "identity",
        rationale: "Unknown provider — assume canonical; flag for audit",
        raw_suspicious_above: 20
      }
    }
  },

  roe: {
    canonical_unit: "percent",
    display_mode: "percent_2dp",
    expected_range: [-100, 500],
    suspicious_threshold: 100,
    description: "Return on Equity as percentage (e.g. 16.78 = 16.78%)",
    providers: {
      yahoo: {
        transform: "multiply_by_100",
        rationale: "Yahoo financialData.returnOnEquity is decimal fraction (0.1678 = 16.78%)"
      },
      alpha_vantage: {
        transform: "multiply_by_100",
        rationale: "Alpha ReturnOnEquityTTM is decimal fraction"
      },
      finnhub: {
        transform: "multiply_by_100",
        rationale: "Finnhub roeTTM is decimal fraction"
      },
      twelvedata: {
        transform: "multiply_by_100",
        rationale: "TwelveData provides decimal fraction"
      },
      fallback: {
        transform: "multiply_by_100",
        rationale: "Assume decimal fraction"
      }
    }
  },

  profit_margin: {
    canonical_unit: "percent",
    display_mode: "percent_2dp",
    expected_range: [-100, 100],
    suspicious_threshold: 80,
    description: "Net profit margin as percentage",
    providers: {
      yahoo: {
        transform: "multiply_by_100",
        rationale: "Yahoo financialData.profitMargins is decimal fraction (0.093 = 9.3%)"
      },
      alpha_vantage: {
        transform: "multiply_by_100",
        rationale: "Alpha ProfitMargin is decimal fraction"
      },
      finnhub: {
        transform: "multiply_by_100",
        rationale: "Finnhub netMarginTTM is decimal fraction"
      },
      twelvedata: {
        transform: "multiply_by_100",
        rationale: "Decimal fraction"
      },
      fallback: {
        transform: "multiply_by_100",
        rationale: "Assume decimal fraction"
      }
    }
  },

  operating_margin: {
    canonical_unit: "percent",
    display_mode: "percent_2dp",
    expected_range: [-100, 100],
    suspicious_threshold: 80,
    description: "Operating margin as percentage",
    providers: {
      yahoo: { transform: "multiply_by_100", rationale: "Yahoo operatingMargins is decimal fraction" },
      alpha_vantage: { transform: "multiply_by_100", rationale: "Alpha OperatingMarginTTM is decimal fraction" },
      finnhub: { transform: "multiply_by_100", rationale: "Finnhub operatingMarginTTM is decimal fraction" },
      twelvedata: { transform: "multiply_by_100", rationale: "Decimal fraction" },
      fallback: { transform: "multiply_by_100", rationale: "Assume decimal fraction" }
    }
  },

  revenue_growth: {
    canonical_unit: "percent",
    display_mode: "percent_2dp",
    expected_range: [-100, 1000],
    suspicious_threshold: 200,
    description: "Revenue growth YoY as percentage",
    providers: {
      yahoo: {
        transform: "multiply_by_100",
        rationale: "Yahoo financialData.revenueGrowth is decimal fraction"
      },
      alpha_vantage: {
        transform: "multiply_by_100",
        rationale: "Alpha QuarterlyRevenueGrowthYOY is decimal fraction"
      },
      finnhub: {
        transform: "multiply_by_100",
        rationale: "Finnhub revenueGrowthTTMYoy is decimal fraction"
      },
      twelvedata: { transform: "multiply_by_100", rationale: "Decimal fraction" },
      fallback: { transform: "multiply_by_100", rationale: "Assume decimal fraction" }
    }
  },

  earnings_growth: {
    canonical_unit: "percent",
    display_mode: "percent_2dp",
    expected_range: [-100, 1000],
    suspicious_threshold: 200,
    description: "Earnings/EPS growth YoY as percentage",
    providers: {
      yahoo: {
        transform: "multiply_by_100",
        rationale: "Yahoo financialData.earningsGrowth is decimal fraction"
      },
      alpha_vantage: {
        transform: "multiply_by_100",
        rationale: "Alpha QuarterlyEarningsGrowthYOY is decimal fraction"
      },
      finnhub: {
        transform: "multiply_by_100",
        rationale: "Finnhub epsGrowthTTMYoy is decimal fraction"
      },
      twelvedata: { transform: "multiply_by_100", rationale: "Decimal fraction" },
      fallback: { transform: "multiply_by_100", rationale: "Assume decimal fraction" }
    }
  },

  pe_ratio: {
    canonical_unit: "ratio",
    display_mode: "number_2dp",
    expected_range: [0, 500],
    suspicious_threshold: 200,
    description: "Price-to-Earnings ratio (absolute ratio, no transform needed)",
    providers: {
      yahoo: { transform: "identity", rationale: "Yahoo summaryDetail.trailingPE is already canonical ratio" },
      alpha_vantage: { transform: "parse_decimal", rationale: "Alpha PERatio is a decimal string" },
      finnhub: { transform: "identity", rationale: "Finnhub pe* is already canonical" },
      twelvedata: { transform: "identity", rationale: "Already canonical" },
      fallback: { transform: "identity", rationale: "Already canonical" }
    }
  },

  price_to_book: {
    canonical_unit: "ratio",
    display_mode: "number_2dp",
    expected_range: [0, 100],
    suspicious_threshold: 50,
    description: "Price-to-Book ratio",
    providers: {
      yahoo: { transform: "identity", rationale: "Yahoo defaultKeyStatistics.priceToBook is already canonical" },
      alpha_vantage: { transform: "parse_decimal", rationale: "Alpha PriceToBookRatio is decimal string" },
      finnhub: { transform: "identity", rationale: "Finnhub pb* is canonical" },
      twelvedata: { transform: "identity", rationale: "Already canonical" },
      fallback: { transform: "identity", rationale: "Already canonical" }
    }
  },

  beta: {
    canonical_unit: "ratio",
    display_mode: "number_2dp",
    expected_range: [-5, 10],
    suspicious_threshold: 5,
    description: "Market beta coefficient",
    providers: {
      yahoo: { transform: "identity", rationale: "Yahoo defaultKeyStatistics.beta is already canonical" },
      alpha_vantage: { transform: "parse_decimal", rationale: "Alpha Beta is decimal string" },
      finnhub: { transform: "identity", rationale: "Finnhub beta is canonical" },
      twelvedata: { transform: "identity", rationale: "Already canonical" },
      fallback: { transform: "identity", rationale: "Already canonical" }
    }
  },

  peg: {
    canonical_unit: "ratio",
    display_mode: "number_2dp",
    expected_range: [-50, 50],
    suspicious_threshold: 20,
    description: "Price/Earnings-to-Growth ratio",
    providers: {
      yahoo: { transform: "identity", rationale: "Already canonical" },
      alpha_vantage: { transform: "parse_decimal", rationale: "String to decimal" },
      finnhub: { transform: "identity", rationale: "Already canonical" },
      twelvedata: { transform: "identity", rationale: "Already canonical" },
      fallback: { transform: "identity", rationale: "Already canonical" }
    }
  },

  dividend_yield: {
    canonical_unit: "percent",
    display_mode: "percent_2dp",
    expected_range: [0, 30],
    suspicious_threshold: 15,
    description: "Annual dividend yield as percentage",
    providers: {
      yahoo: {
        transform: "multiply_by_100",
        rationale: "Yahoo summaryDetail.dividendYield is decimal fraction (0.015 = 1.5%)"
      },
      alpha_vantage: {
        transform: "multiply_by_100",
        rationale: "Alpha DividendYield is decimal fraction"
      },
      finnhub: {
        transform: "multiply_by_100",
        rationale: "Finnhub dividendYield is decimal fraction"
      },
      twelvedata: { transform: "multiply_by_100", rationale: "Decimal fraction" },
      fallback: { transform: "multiply_by_100", rationale: "Assume decimal fraction" }
    }
  },

  current_ratio: {
    canonical_unit: "ratio",
    display_mode: "number_2dp",
    expected_range: [0, 50],
    suspicious_threshold: 20,
    description: "Current assets divided by current liabilities",
    providers: {
      yahoo: { transform: "identity", rationale: "Already canonical ratio" },
      alpha_vantage: { transform: "parse_decimal", rationale: "Parse string decimal" },
      finnhub: { transform: "identity", rationale: "Already canonical" },
      twelvedata: { transform: "identity", rationale: "Already canonical" },
      fallback: { transform: "identity", rationale: "Already canonical" }
    }
  },

  quick_ratio: {
    canonical_unit: "ratio",
    display_mode: "number_2dp",
    expected_range: [0, 50],
    suspicious_threshold: 20,
    description: "Quick ratio (liquid assets / current liabilities)",
    providers: {
      yahoo: { transform: "identity", rationale: "Already canonical" },
      alpha_vantage: { transform: "parse_decimal", rationale: "Parse string decimal" },
      finnhub: { transform: "identity", rationale: "Already canonical" },
      twelvedata: { transform: "identity", rationale: "Already canonical" },
      fallback: { transform: "identity", rationale: "Already canonical" }
    }
  },

  eps: {
    canonical_unit: "absolute_currency",
    display_mode: "number_2dp",
    expected_range: [-10000, 100000],
    suspicious_threshold: 50000,
    description: "Earnings Per Share in local currency",
    providers: {
      yahoo: { transform: "identity", rationale: "Yahoo defaultKeyStatistics.trailingEps is already absolute" },
      alpha_vantage: { transform: "parse_decimal", rationale: "Parse string" },
      finnhub: { transform: "identity", rationale: "Already canonical" },
      twelvedata: { transform: "identity", rationale: "Already canonical" },
      fallback: { transform: "identity", rationale: "Already canonical" }
    }
  },

  interest_coverage: {
    canonical_unit: "ratio",
    display_mode: "number_2dp",
    expected_range: [-100, 1000],
    suspicious_threshold: 500,
    description: "EBIT / Interest Expense",
    providers: {
      yahoo: { transform: "identity", rationale: "Computed ratio, already canonical" },
      alpha_vantage: { transform: "parse_decimal", rationale: "Parse string" },
      finnhub: { transform: "identity", rationale: "Already canonical" },
      twelvedata: { transform: "identity", rationale: "Already canonical" },
      fallback: { transform: "identity", rationale: "Already canonical" }
    }
  },

  free_cash_flow_margin: {
    canonical_unit: "percent",
    display_mode: "percent_2dp",
    expected_range: [-100, 100],
    suspicious_threshold: 80,
    description: "Free cash flow as percentage of revenue",
    providers: {
      yahoo: { transform: "multiply_by_100", rationale: "If provided as decimal fraction" },
      alpha_vantage: { transform: "multiply_by_100", rationale: "Decimal fraction" },
      finnhub: { transform: "multiply_by_100", rationale: "Decimal fraction" },
      twelvedata: { transform: "multiply_by_100", rationale: "Decimal fraction" },
      fallback: { transform: "multiply_by_100", rationale: "Assume decimal fraction" }
    }
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// TRANSFORM ENGINE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse a raw value to a finite number, or return null if unparseable.
 * Handles: number, string (with commas, % signs), "N/A", "-", null, undefined
 */
export function parseRawToNumber(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string") {
    const cleaned = raw.trim().replace(/,/g, "").replace(/%$/, "");
    if (!cleaned || cleaned === "-" || cleaned.toUpperCase() === "N/A" || cleaned === "None") return null;
    const num = Number(cleaned);
    return Number.isFinite(num) ? num : null;
  }
  return null;
}

/**
 * Apply a named transform to a parsed numeric value.
 */
function applyTransform(transformName, value) {
  if (value === null) return null;
  switch (transformName) {
    case "identity":       return value;
    case "parse_decimal":  return value;          // already parsed by parseRawToNumber
    case "divide_by_100":  return value / 100;
    case "multiply_by_100": return value * 100;
    default:
      console.warn(`[CANONICAL] Unknown transform "${transformName}" — applying identity`);
      return value;
  }
}

/**
 * Format a canonical value for display output.
 */
export function formatCanonical(value, displayMode) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  switch (displayMode) {
    case "percent_2dp":  return `${value.toFixed(2)}%`;
    case "ratio_2dp":    return value.toFixed(2);
    case "number_2dp":   return value.toFixed(2);
    case "number_0dp":   return `${Math.round(value)}`;
    default:             return value.toFixed(2);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CORE NORMALIZATION FUNCTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * normalizeMetric — Deterministic, provider-aware metric normalization.
 *
 * @param {string} metricKey — key from CANONICAL_METRIC_REGISTRY
 * @param {*} rawValue — raw value from provider
 * @param {string} provider — "yahoo" | "alpha_vantage" | "finnhub" | "twelvedata" | "fallback"
 * @param {string} symbol — for telemetry only
 * @returns {{ canonical: number|null, display: string, providerRule: object, rejected: boolean }}
 */
export function normalizeMetric(metricKey, rawValue, provider, symbol) {
  const registry = CANONICAL_METRIC_REGISTRY[metricKey];

  if (!registry) {
    // Unknown metric — pass through without normalization
    const parsed = parseRawToNumber(rawValue);
    return { canonical: parsed, display: parsed !== null ? String(parsed) : "-", providerRule: null, rejected: false };
  }

  const parsed = parseRawToNumber(rawValue);

  if (parsed === null) {
    logEvent("fundamentals.metric.null", { symbol, metric: metricKey, provider, raw_value: rawValue });
    return { canonical: null, display: "-", providerRule: null, rejected: false };
  }

  const providerRule = registry.providers[provider] || registry.providers["fallback"];
  const canonical = applyTransform(providerRule.transform, parsed);

  // Validate against expected institutional range
  const [min, max] = registry.expected_range;
  const outOfRange = canonical < min || canonical > max;
  const suspicious = !outOfRange && registry.suspicious_threshold !== undefined && Math.abs(canonical) > registry.suspicious_threshold;

  if (outOfRange) {
    logEvent("fundamentals.metric.rejected", {
      symbol,
      metric: metricKey,
      provider,
      raw_value: rawValue,
      parsed_value: parsed,
      normalized_value: canonical,
      canonical_unit: registry.canonical_unit,
      transform: providerRule.transform,
      reason: `out_of_range_[${min},${max}]`,
      semantics_version: CANONICAL_SEMANTICS_VERSION
    });
    return { canonical: null, display: "-", providerRule, rejected: true };
  }

  if (suspicious) {
    logEvent("fundamentals.validation.warning", {
      symbol,
      metric: metricKey,
      provider,
      raw_value: rawValue,
      normalized_value: canonical,
      canonical_unit: registry.canonical_unit,
      reason: `above_suspicious_threshold_${registry.suspicious_threshold}`,
      semantics_version: CANONICAL_SEMANTICS_VERSION
    });
  }

  logEvent("fundamentals.semantic.normalized", {
    symbol,
    metric: metricKey,
    provider,
    raw_value: rawValue,
    parsed_value: parsed,
    normalized_value: canonical,
    canonical_unit: registry.canonical_unit,
    transform: providerRule.transform,
    rationale: providerRule.rationale,
    semantics_version: CANONICAL_SEMANTICS_VERSION
  });

  const display = formatCanonical(canonical, registry.display_mode);
  return { canonical, display, providerRule, rejected: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// CROSS-PROVIDER CONSENSUS LAYER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cross-provider consensus for a single metric.
 * Compares normalized values from multiple providers and returns the
 * highest-confidence agreed value, or a mismatch signal.
 *
 * @param {string} metricKey
 * @param {Array<{provider: string, rawValue: *}>} providerReadings
 * @param {string} symbol
 * @returns {{ value: number|null, display: string, confidence: "HIGH"|"MEDIUM"|"LOW"|"INSUFFICIENT", providers: string[], mismatch: boolean }}
 */
export function crossProviderConsensus(metricKey, providerReadings, symbol) {
  const registry = CANONICAL_METRIC_REGISTRY[metricKey];
  const results = [];

  for (const { provider, rawValue } of providerReadings) {
    if (rawValue === null || rawValue === undefined) continue;
    const norm = normalizeMetric(metricKey, rawValue, provider, symbol);
    if (!norm.rejected && norm.canonical !== null) {
      results.push({ provider, canonical: norm.canonical, display: norm.display });
    }
  }

  if (results.length === 0) {
    logEvent("fundamentals.consensus.failed", {
      symbol, metric: metricKey,
      reason: "all_providers_null_or_rejected",
      semantics_version: CANONICAL_SEMANTICS_VERSION
    });
    return { value: null, display: "-", confidence: "INSUFFICIENT", providers: [], mismatch: false };
  }

  if (results.length === 1) {
    return {
      value: results[0].canonical,
      display: results[0].display,
      confidence: "LOW",
      providers: [results[0].provider],
      mismatch: false
    };
  }

  // Check agreement: are all values within ±15% of the median?
  const values = results.map(r => r.canonical);
  const median = values.slice().sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const agreementThreshold = Math.max(Math.abs(median) * 0.15, 0.05); // min 5% absolute or 15% relative

  const agreeingResults = results.filter(r => Math.abs(r.canonical - median) <= agreementThreshold);
  const hasMismatch = agreeingResults.length < results.length;

  if (hasMismatch) {
    logEvent("fundamentals.provider.disagreement", {
      symbol,
      metric: metricKey,
      providers: results.map(r => ({ provider: r.provider, canonical: r.canonical })),
      median,
      agreeing_count: agreeingResults.length,
      total_count: results.length,
      semantics_version: CANONICAL_SEMANTICS_VERSION
    });
  }

  if (agreeingResults.length === 0) {
    logEvent("fundamentals.consensus.failed", {
      symbol, metric: metricKey,
      reason: "no_agreement_across_providers",
      values: results.map(r => ({ provider: r.provider, canonical: r.canonical })),
      semantics_version: CANONICAL_SEMANTICS_VERSION
    });
    return { value: null, display: "Metric reliability insufficient for institutional display", confidence: "INSUFFICIENT", providers: [], mismatch: true };
  }

  // Use median of agreeing results
  const consensusValue = agreeingResults.reduce((s, r) => s + r.canonical, 0) / agreeingResults.length;
  const registry_display = registry ? formatCanonical(consensusValue, registry.display_mode) : consensusValue.toFixed(2);

  const confidence = agreeingResults.length >= 2 ? "HIGH" : "MEDIUM";

  return {
    value: consensusValue,
    display: registry_display,
    confidence,
    providers: agreeingResults.map(r => r.provider),
    mismatch: hasMismatch
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SEMANTIC VALIDATION LAYER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sector-aware suspicious value checks.
 * Returns array of validation warnings.
 */
export function validateFundamentalsSemantics(metrics, sector = "") {
  const warnings = [];
  const sectorLower = (sector || "").toLowerCase();
  const isITServices = sectorLower.includes("technology") || sectorLower.includes("software") || sectorLower.includes("information");
  const isBanking = sectorLower.includes("bank") || sectorLower.includes("financ") || sectorLower.includes("nbfc");

  if (metrics.debt_to_equity !== null && metrics.debt_to_equity !== undefined) {
    const de = metrics.debt_to_equity;
    if (isITServices && de > 0.5) {
      warnings.push({ metric: "debt_to_equity", severity: "WARNING", message: `IT sector D/E ${de.toFixed(2)} is suspicious (expected <0.5 for IT)` });
    }
    if (!isBanking && de > 5) {
      warnings.push({ metric: "debt_to_equity", severity: "ALERT", message: `Non-bank D/E ${de.toFixed(2)} exceeds institutional suspicion threshold (5.0)` });
    }
  }

  if (metrics.roe !== null && metrics.roe !== undefined && Math.abs(metrics.roe) > 100) {
    warnings.push({ metric: "roe", severity: "WARNING", message: `ROE ${metrics.roe.toFixed(1)}% exceeds 100% — verify data integrity` });
  }

  if (metrics.profit_margin !== null && metrics.profit_margin !== undefined) {
    if (metrics.profit_margin < -100 || metrics.profit_margin > 100) {
      warnings.push({ metric: "profit_margin", severity: "INVALID", message: `Profit margin ${metrics.profit_margin.toFixed(1)}% outside [-100%, +100%]` });
    }
  }

  return warnings;
}

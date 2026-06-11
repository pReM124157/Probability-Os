import { normalizeTickerAlias } from "./tickerAliases.js";

/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║              TICKER SEMANTIC CONTRACT BOUNDARIES                     ║
 * ║                                                                      ║
 * ║  Four STRICT, ISOLATED, IMMUTABLE validation layers.                ║
 * ║  Each layer has ONE responsibility. NEVER mix them.                  ║
 * ║                                                                      ║
 * ║  Layer 1: validateTickerSyntax()   — regex/shape ONLY               ║
 * ║  Layer 2: checkSymbolExistence()   — registry/overview lookup ONLY  ║
 * ║  Layer 3: checkMarketAvailability() — live data health ONLY         ║
 * ║  Layer 4: validateAnalysisReadiness() — data completeness ONLY      ║
 * ║                                                                      ║
 * ║  CONTRACT: ticker validity NEVER depends on provider availability.  ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

// ─────────────────────────────────────────────────────────────────────────────
// LAYER 1: SYNTAX VALIDATION
// ─────────────────────────────────────────────────────────────────────────────
// RESPONSIBILITY: regex/shape ONLY.
// MUST NEVER: call providers, fetch live data, depend on runtime availability.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates ticker syntax. Pure synchronous. No I/O. No provider calls.
 * Accepts tickers like TCS, RELIANCE, HDFCBANK (NSE style, 2–15 alpha chars).
 *
 * @param {string} input - Raw user-provided ticker string
 * @returns {{ valid: boolean, cleanTicker: string, reason?: string }}
 */
export function validateTickerSyntax(input) {
  if (!input || typeof input !== "string") {
    return { valid: false, cleanTicker: "", reason: "MISSING_INPUT" };
  }

  const clean = input.trim().toUpperCase().replace(/\s+/g, "");

  if (clean.length < 2) {
    return { valid: false, cleanTicker: clean, reason: "TOO_SHORT" };
  }

  if (clean.length > 15) {
    return { valid: false, cleanTicker: clean, reason: "TOO_LONG" };
  }

  // Allow pure alpha (TCS, RELIANCE) or alpha-with-dot variants (TCS.NS, TCS.BO)
  if (!/^[A-Z]+([.][A-Z]{1,4})?$/.test(clean)) {
    return { valid: false, cleanTicker: clean, reason: "INVALID_CHARACTERS" };
  }

  // Reject common English words that are never valid NSE tickers
  const BLOCKED_WORDS = new Set([
    "HI", "HEY", "OK", "YES", "NO", "THE", "AND", "FOR", "ARE", "BUT",
    "NOT", "YOU", "ALL", "CAN", "WHO", "WHY", "HOW", "DID", "BUY", "GET",
    "HIM", "HIS", "HER", "ITS", "WAS", "HAD", "LET", "SAY", "SHE", "HE",
    "HELP", "GOOD", "NICE", "COOL", "OKAY", "THANKS", "HELLO", "BYE",
    "MY", "BRO", "SUP", "YO"
  ]);

  const base = clean.split(".")[0];
  if (BLOCKED_WORDS.has(base)) {
    return { valid: false, cleanTicker: clean, reason: "BLOCKED_WORD" };
  }

  return { valid: true, cleanTicker: base };
}


// ─────────────────────────────────────────────────────────────────────────────
// LAYER 2: SYMBOL EXISTENCE CHECK
// ─────────────────────────────────────────────────────────────────────────────
// RESPONSIBILITY: determine whether the symbol exists as a real entity.
// MAY USE: lightweight registry lookup, company overview, cached data.
// MUST NEVER: require live market data success, depend on current price.
// MUST NEVER: fail just because a live quote is unavailable.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Existence states returned by checkSymbolExistence().
 */
export const EXISTENCE_STATE = Object.freeze({
  EXISTS:          "EXISTS",           // Symbol is a real, known NSE entity
  UNKNOWN:         "UNKNOWN",          // Not found in any registry/overview
  REGISTRY_ERROR:  "REGISTRY_ERROR"    // Lookup machinery itself failed
});

/**
 * Checks whether a ticker symbol exists as a real NSE entity.
 * Uses company overview / profile data — NOT live price quotes.
 * A symbol EXISTS even if its live price is currently unavailable.
 *
 * @param {string} ticker - Clean ticker (e.g. "TCS")
 * @param {{ getCompanyOverview: Function }} deps - Injected data functions
 * @returns {Promise<{ state: string, source?: string, name?: string }>}
 */
export async function checkSymbolExistence(ticker, { getCompanyOverview }) {
  try {
    const overview = await getCompanyOverview(ticker);

    // A valid overview has at minimum a non-fallback name or sector.
    // It does NOT require a live price.
    const isRealEntity = (
      overview &&
      typeof overview === "object" &&
      overview.status !== "FALLBACK_SAFE" &&
      overview.source !== "fallback" &&
      !String(overview.Name || "").toLowerCase().includes("(fallback)") &&
      (
        // Has company name
        (overview.Name && overview.Name !== ticker) ||
        // Has sector
        (overview.Sector && overview.Sector.toLowerCase() !== "fallback") ||
        // Has any fundamental data
        overview.PERatio !== undefined ||
        overview.MarketCapitalization !== undefined ||
        overview.BusinessSummary !== undefined
      )
    );

    if (isRealEntity) {
      return {
        state: EXISTENCE_STATE.EXISTS,
        source: overview.source || "OVERVIEW",
        name: overview.Name || ticker
      };
    }

    return { state: EXISTENCE_STATE.UNKNOWN };
  } catch (err) {
    console.warn(`[checkSymbolExistence] Registry error for ${ticker}:`, err.message);
    return {
      state: EXISTENCE_STATE.REGISTRY_ERROR,
      error: err.message
    };
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// LAYER 3: MARKET AVAILABILITY CHECK
// ─────────────────────────────────────────────────────────────────────────────
// RESPONSIBILITY: determine whether live market data is currently available.
// MUST RETURN: explicit health states — never redefine symbol validity.
// MUST NEVER: classify a symbol as "invalid" due to provider failure.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Market availability states returned by checkMarketAvailability().
 */
export const MARKET_AVAILABILITY = Object.freeze({
  LIVE_AVAILABLE:      "LIVE_AVAILABLE",       // Full live data from primary source
  DEGRADED:            "DEGRADED",             // Data available but from fallback source
  PROVIDER_UNAVAILABLE: "PROVIDER_UNAVAILABLE" // All providers failed; no price data
});

/**
 * Checks the current health/availability of market data for a given ticker.
 * Returns an explicit availability state — NEVER maps to "invalid ticker".
 *
 * @param {string} ticker - Clean ticker (e.g. "TCS")
 * @param {{ getLiveMarketData: Function }} deps - Injected data functions
 * @returns {Promise<{ availability: string, priceSource?: string, currentPrice?: number, liveData?: object }>}
 */
export async function checkMarketAvailability(ticker, { getLiveMarketData }) {
  try {
    const liveData = await getLiveMarketData(normalizeTickerAlias(ticker));

    const price = Number(liveData?.currentPrice || liveData?.price || 0);
    const source = String(liveData?.priceSource || "").toUpperCase();
    const isFallback = (
      liveData?.status === "FALLBACK_SAFE" ||
      liveData?.source === "fallback" ||
      source === "FAILED" ||
      source === "" ||
      price === 0
    );

    if (isFallback || price === 0) {
      return {
        availability: MARKET_AVAILABILITY.PROVIDER_UNAVAILABLE,
        priceSource: source || "NONE",
        currentPrice: 0,
        liveData
      };
    }

    const PRIMARY_SOURCES = new Set(["YAHOO"]);
    const isDegraded = !PRIMARY_SOURCES.has(source);

    return {
      availability: isDegraded
        ? MARKET_AVAILABILITY.DEGRADED
        : MARKET_AVAILABILITY.LIVE_AVAILABLE,
      priceSource: source,
      currentPrice: price,
      liveData
    };
  } catch (err) {
    console.warn(`[checkMarketAvailability] Provider error for ${ticker}:`, err.message);
    return {
      availability: MARKET_AVAILABILITY.PROVIDER_UNAVAILABLE,
      priceSource: "ERROR",
      currentPrice: 0,
      error: err.message
    };
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// LAYER 4: ANALYSIS READINESS CHECK
// ─────────────────────────────────────────────────────────────────────────────
// RESPONSIBILITY: determine whether enough data exists for analysis.
// MUST BE: entirely separate from symbol validity AND provider availability.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Analysis readiness states returned by validateAnalysisReadiness().
 */
export const ANALYSIS_READINESS = Object.freeze({
  FULL:    "FULL",    // All data present for complete institutional analysis
  PARTIAL: "PARTIAL", // Some data missing; degraded analysis possible
  BLOCKED: "BLOCKED"  // Insufficient data; cannot generate any meaningful analysis
});

/**
 * Determines whether there is sufficient data to run analysis on a ticker.
 * Separates analysis quality from symbol existence and provider health.
 *
 * @param {{ liveData: object, overview: object }} dataPayload
 * @returns {{ readiness: string, missingFields: string[], canProceed: boolean }}
 */
export function validateAnalysisReadiness({ liveData, overview }) {
  const missingFields = [];

  // Price check — required for any analysis
  const price = Number(liveData?.currentPrice || liveData?.price || 0);
  if (price === 0) {
    missingFields.push("currentPrice");
  }

  // Fundamental checks — missing degrades but does not block
  if (!overview?.PERatio && overview?.PERatio !== 0) {
    missingFields.push("peRatio");
  }
  if (!overview?.ReturnOnEquityTTM) {
    missingFields.push("roe");
  }
  if (!overview?.Sector || overview.Sector.toLowerCase() === "fallback") {
    missingFields.push("sector");
  }
  if (!overview?.QuarterlyRevenueGrowthYOY) {
    missingFields.push("revenueGrowth");
  }

  // BLOCKED: no price at all
  if (missingFields.includes("currentPrice")) {
    return {
      readiness: ANALYSIS_READINESS.BLOCKED,
      missingFields,
      canProceed: false
    };
  }

  // FULL: all critical data present
  if (missingFields.length === 0) {
    return {
      readiness: ANALYSIS_READINESS.FULL,
      missingFields,
      canProceed: true
    };
  }

  // PARTIAL: price exists but some fundamentals missing — degraded analysis allowed
  return {
    readiness: ANALYSIS_READINESS.PARTIAL,
    missingFields,
    canProceed: true
  };
}

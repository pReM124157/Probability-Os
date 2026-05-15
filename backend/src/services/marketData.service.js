import YahooFinance from "yahoo-finance2";
import { fetchIndianHolidays } from "./holiday.service.js";
import { safeString, safeSubstring } from "../core/safety.js";
import { getOrPopulateSharedCache, getSharedCache, setSharedCache } from "./sharedCache.service.js";
import { withProviderGuard } from "./providerHealth.service.js";
import { logError, logMetric } from "./telemetry.service.js";

const yahooFinance = new YahooFinance();
// Global config removed to prevent startup crash

// --- Institutional Data Layer (Observability & Safety) ---
export const dataMetrics = {
  yahooSuccess: 0,
  yahooFail: 0,
  alphaSuccess: 0,
  cacheHit: 0,
  lastGlobalCall: 0
};

const dataCache = new Map();
const inflightRequests = new Map();
const CACHE_TTL_HIGH = 5 * 60 * 1000; // 5 mins (Yahoo/Live)
const CACHE_TTL_LOW = 60 * 1000;      // 1 min (Fallback/Degraded)
const CACHE_GROUP_OVERVIEW = "company_overview";
const CACHE_GROUP_LIVE = "live_market_data";
const CACHE_GROUP_HISTORICAL = "historical_candles";
const CACHE_GROUP_MARKET = "market_snapshots";

// --- Circuit Breaker State ---
let yahooFailureCount = 0;
let yahooCooldownUntil = 0;
const MAX_YAHOO_FAILURES = 5;
const YAHOO_COOLDOWN_MS = 60000;
const HTTP_PROVIDER_TIMEOUT_MS = 5000;
const YAHOO_TIMEOUT_MS = 3500;

function getCached(key) {
  const entry = dataCache.get(key);
  if (!entry) return null;
  
  const ttl = entry.quality === "HIGH" ? CACHE_TTL_HIGH : CACHE_TTL_LOW;
  if (Date.now() - entry.timestamp > ttl) {
    dataCache.delete(key);
    return null;
  }
  dataMetrics.cacheHit++;
  return entry.data;
}

function setCached(key, data, quality = "HIGH") {
  dataCache.set(key, { data, timestamp: Date.now(), quality });
}

function ttlSecondsForQuality(quality = "HIGH") {
  return quality === "HIGH"
    ? Math.floor(CACHE_TTL_HIGH / 1000)
    : Math.floor(CACHE_TTL_LOW / 1000);
}

async function getHybridCache(cacheKey, quality = "HIGH") {
  const local = getCached(cacheKey);
  if (local) return local;

  try {
    const shared = await getSharedCache(cacheKey);
    if (shared) {
      setCached(cacheKey, shared, quality);
      return shared;
    }
  } catch (error) {
    logError("cache.shared.read_error", error, { cacheKey });
  }

  return null;
}

async function setHybridCache(cacheKey, cacheGroup, payload, quality = "HIGH") {
  setCached(cacheKey, payload, quality);
  try {
    await setSharedCache(cacheKey, cacheGroup, payload, ttlSecondsForQuality(quality));
  } catch (error) {
    logError("cache.shared.write_error", error, { cacheKey, cacheGroup });
  }
}

async function withRequestCoalescing(key, factory) {
  const active = inflightRequests.get(key);
  if (active) return active;

  const promise = (async () => {
    try {
      return await factory();
    } finally {
      inflightRequests.delete(key);
    }
  })();

  inflightRequests.set(key, promise);
  return promise;
}

function reportYahooStatus(success) {
  if (success) {
    yahooFailureCount = 0;
    dataMetrics.yahooSuccess++;
  } else {
    yahooFailureCount++;
    dataMetrics.yahooFail++;
    if (yahooFailureCount >= MAX_YAHOO_FAILURES) {
      console.warn(`[CIRCUIT BREAKER] Yahoo tripped. Cooldown active.`);
      yahooCooldownUntil = Date.now() + YAHOO_COOLDOWN_MS;
    }
  }
}

async function withTimeout(promise, ms = 5000) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error("Institutional Timeout")), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = HTTP_PROVIDER_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`HTTP ${response.status}${body ? `: ${safeSubstring(body, 180)}` : ""}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

function safeErrorCause(error) {
  if (!error?.cause) return null;
  if (typeof error.cause === "string") return error.cause;
  return {
    message: error.cause.message || null,
    code: error.cause.code || null,
    name: error.cause.name || null
  };
}

function logProviderError(provider, context = {}, error) {
  console.error(`${provider.toUpperCase()} FETCH ERROR`, {
    ...context,
    message: error?.message || "Unknown error",
    name: error?.name || null,
    code: error?.code || null,
    stack: error?.stack || null,
    cause: safeErrorCause(error),
    responseStatus: error?.response?.status || null,
    responseData: error?.response?.data ? safeSubstring(JSON.stringify(error.response.data), 300) : null
  });
}

function toPositiveNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : 0;
}

function resolveBestPrice(quote = {}) {
  const priceCandidates = [
    ["postMarketPrice", quote?.postMarketPrice],
    ["preMarketPrice", quote?.preMarketPrice],
    ["regularMarketPrice", quote?.regularMarketPrice],
    ["currentPrice", quote?.currentPrice],
    ["regularMarketPreviousClose", quote?.regularMarketPreviousClose],
    ["previousClose", quote?.previousClose]
  ];

  for (const [field, rawValue] of priceCandidates) {
    const value = toPositiveNumber(rawValue);
    if (value > 0) {
      return { field, value };
    }
  }

  return { field: null, value: 0 };
}

function normalizeSymbol(symbol) {
  if (!symbol || typeof symbol !== "string") return "";
  return symbol
    .replace(/\//g, "") // Remove ALL slashes to prevent double-slash API errors
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ""); // Remove spaces
}

function buildSymbolVariants(symbol) {
  const upperSymbol = normalizeSymbol(symbol);
  if (!upperSymbol) return [];
  return upperSymbol.includes(".")
    ? [upperSymbol]
    : [`${upperSymbol}.NS`, `${upperSymbol}.BO`, upperSymbol];
}

function toBaseTicker(symbol) {
  return normalizeSymbol(symbol).replace(/\.NS$|\.BO$/i, "");
}

function toAlphaSymbol(symbol) {
  return normalizeSymbol(symbol).replace(/\.NS$/i, ".NSE").replace(/\.BO$/i, ".BSE");
}

function createFallbackOverview(symbol, extra = {}) {
  const upperSymbol = normalizeSymbol(symbol);
  return {
    Symbol: upperSymbol.includes(".") ? upperSymbol : `${upperSymbol}.NS`,
    symbol: upperSymbol,
    Name: upperSymbol + " (Fallback)",
    price: 0,
    change: 0,
    changePercent: 0,
    volume: 0,
    marketCap: 0,
    peRatio: 0,
    PERatio: 0,
    Sector: "Fallback",
    source: "fallback",
    status: "FALLBACK_SAFE",
    ...extra
  };
}

function createFallbackLiveData(symbol, extra = {}) {
  const upperSymbol = normalizeSymbol(symbol);
  return {
    symbol: upperSymbol,
    price: 0,
    currentPrice: 0,
    change: 0,
    changePercent: 0,
    volume: 0,
    marketCap: 0,
    peRatio: 0,
    source: "fallback",
    status: "FALLBACK_SAFE",
    ...extra
  };
}

function normalizeAlphaOverviewPayload(payload = {}, symbol) {
  if (!payload || !payload.Symbol) return null;

  return {
    Symbol: payload.Symbol,
    symbol: toBaseTicker(payload.Symbol),
    Name: payload.Name || payload.Symbol,
    "P/E Ratio": payload.PERatio || "-",
    "ROE": payload.ReturnOnEquityTTM || "-",
    "Profit Margin": payload.ProfitMargin || "-",
    "Debt/Equity": payload.DebtToEquityRatio || payload.DebtToEquity || "-",
    "Revenue Growth (YoY)": payload.QuarterlyRevenueGrowthYOY || "-",
    "Earnings Growth (YoY)": payload.QuarterlyEarningsGrowthYOY || "-",
    PERatio: payload.PERatio || 0,
    ReturnOnEquityTTM: payload.ReturnOnEquityTTM || "-",
    ProfitMargin: payload.ProfitMargin || "-",
    DebtToEquityRatio: payload.DebtToEquityRatio || payload.DebtToEquity || "-",
    QuarterlyRevenueGrowthYOY: payload.QuarterlyRevenueGrowthYOY || "-",
    QuarterlyEarningsGrowthYOY: payload.QuarterlyEarningsGrowthYOY || "-",
    MarketCapitalization: payload.MarketCapitalization || null,
    PriceToBookRatio: payload.PriceToBookRatio || null,
    Beta: payload.Beta || null,
    Sector: payload.Sector || null,
    Industry: payload.Industry || null,
    BusinessSummary: payload.Description || null,
    EarningsDate: payload.LatestQuarter || null,
    source: "alpha_vantage",
    status: "success",
    originalSymbol: symbol
  };
}

function normalizeFinnhubOverviewPayload({ profile = {}, metrics = {} } = {}, symbol) {
  const name = profile.name || profile.ticker;
  const sector = profile.finnhubIndustry || null;

  if (!name && !sector && Object.keys(metrics || {}).length === 0) return null;

  return {
    Symbol: profile.ticker || normalizeSymbol(symbol),
    symbol: toBaseTicker(profile.ticker || symbol),
    Name: name || normalizeSymbol(symbol),
    "P/E Ratio": metrics.peNormalizedAnnual || metrics.peTTM || "-",
    "ROE": metrics.roeTTM != null ? `${Number(metrics.roeTTM).toFixed(2)}%` : "-",
    "Profit Margin": metrics.netMarginTTM != null ? `${Number(metrics.netMarginTTM).toFixed(2)}%` : "-",
    "Debt/Equity": metrics.totalDebtToEquityQuarterly || metrics.totalDebtToEquityAnnual || "-",
    "Revenue Growth (YoY)": metrics.revenueGrowthTTMYoy || metrics.revenueGrowth3Y || "-",
    "Earnings Growth (YoY)": metrics.epsGrowthTTMYoy || metrics.epsGrowth3Y || "-",
    PERatio: metrics.peNormalizedAnnual || metrics.peTTM || 0,
    ReturnOnEquityTTM: metrics.roeTTM != null ? `${Number(metrics.roeTTM).toFixed(2)}%` : "-",
    ProfitMargin: metrics.netMarginTTM != null ? `${Number(metrics.netMarginTTM).toFixed(2)}%` : "-",
    DebtToEquityRatio: metrics.totalDebtToEquityQuarterly || metrics.totalDebtToEquityAnnual || "-",
    QuarterlyRevenueGrowthYOY: metrics.revenueGrowthTTMYoy || metrics.revenueGrowth3Y || "-",
    QuarterlyEarningsGrowthYOY: metrics.epsGrowthTTMYoy || metrics.epsGrowth3Y || "-",
    MarketCapitalization: profile.marketCapitalization || null,
    PriceToBookRatio: metrics.pbAnnual || metrics.pbQuarterly || null,
    Beta: metrics.beta || null,
    Sector: sector,
    Industry: sector,
    BusinessSummary: null,
    EarningsDate: null,
    source: "finnhub",
    status: "success",
    originalSymbol: symbol
  };
}

/**
 * checkSymbolExists — Layer 2: Existence-only check.
 *
 * Determines whether a symbol exists as a real NSE entity by examining
 * company overview/profile data ONLY.
 *
 * CONTRACT:
 *  - NEVER requires a successful live price fetch.
 *  - Returns true even when all price providers are down.
 *  - A symbol is "non-existent" only when overview data is unavailable
 *    from ALL providers AND returns FALLBACK_SAFE — i.e. totally unknown.
 *
 * @param {string} symbol
 * @returns {Promise<boolean>}
 */
export async function checkSymbolExists(symbol) {
  try {
    const overview = await getCompanyOverview(symbol);
    if (!overview || typeof overview !== "object") return false;

    // A symbol EXISTS if ANY real data is returned — not just fallback shells.
    // Provider outage returns createFallbackOverview() with status=FALLBACK_SAFE.
    // Real symbols return overview with Name, Sector, fundamentals, etc.
    if (overview.status === "FALLBACK_SAFE") return false;
    if (overview.source === "fallback") return false;
    if (String(overview.Name || "").toLowerCase().includes("(fallback)")) return false;

    return (
      // Has a real company name
      (overview.Name && overview.Name !== symbol) ||
      // Has a real sector
      (overview.Sector && overview.Sector.toLowerCase() !== "fallback") ||
      // Has any fundamental data from a real provider
      overview.BusinessSummary !== undefined ||
      overview.MarketCapitalization !== undefined ||
      overview.PERatio !== undefined
    );
  } catch (err) {
    console.warn(`[checkSymbolExists] Overview lookup error for ${symbol}:`, err.message);
    // Error in the lookup machinery — we do NOT know if it's invalid.
    // Treat as unknown rather than invalid to avoid false negatives.
    return null; // null = UNKNOWN (not false = INVALID)
  }
}

// DELETED: validateTickerAvailability() — was the root cause of the regression.
// It coupled live-price success with symbol existence, causing valid tickers
// (TCS, RELIANCE) to appear as "UNAVAILABLE" during provider outages.
// Use the strict layered contracts in core/tickerContracts.js instead:
//   validateTickerSyntax()     — Layer 1: syntax/shape
//   checkSymbolExistence()     — Layer 2: existence (no live price needed)
//   checkMarketAvailability()  — Layer 3: provider health (separate concern)
//   validateAnalysisReadiness() — Layer 4: data completeness

/**
 * Fetches Nifty 50 and Sensex current quotes.
 */
export async function getIndianIndices() {
  try {
    const cacheKey = "MARKET_INDICES_IN";
    const cached = await getHybridCache(cacheKey, "LOW");
    if (cached) return cached;

    const symbols = ["^NSEI", "^BSESN"]; // Nifty 50 and Sensex
    const results = await getOrPopulateSharedCache(cacheKey, CACHE_GROUP_MARKET, ttlSecondsForQuality("LOW"), async () =>
      withProviderGuard("yahoo", async () => yahooFinance.quote(symbols))
    );
    
    const nifty = results.find(r => r.symbol === "^NSEI") || {};
    const sensex = results.find(r => r.symbol === "^BSESN") || {};

    const payload = {
      nifty: {
        price: nifty.regularMarketPrice,
        change: nifty.regularMarketChangePercent,
        changeRaw: nifty.regularMarketChange
      },
      sensex: {
        price: sensex.regularMarketPrice,
        change: sensex.regularMarketChangePercent,
        changeRaw: sensex.regularMarketChange
      }
    };
    await setHybridCache(cacheKey, CACHE_GROUP_MARKET, payload, "LOW");
    return payload;
  } catch (error) {
    console.warn("Failed to fetch indices:", error.message);
    return {
      nifty: { price: 0, change: 0 },
      sensex: { price: 0, change: 0 }
    };
  }
}

/**
 * Fetches recent news for Indian market.
 */
export async function getIndianMarketNews() {
  try {
    const cacheKey = "MARKET_NEWS_IN";
    const cached = await getHybridCache(cacheKey, "LOW");
    if (cached) return cached;

    const result = await getOrPopulateSharedCache(cacheKey, CACHE_GROUP_MARKET, ttlSecondsForQuality("LOW"), async () =>
      withProviderGuard("yahoo", async () => yahooFinance.search("India stock market", { newsCount: 5 }))
    );
    const payload = result.news.map(n => n.title);
    await setHybridCache(cacheKey, CACHE_GROUP_MARKET, payload, "LOW");
    return payload;
  } catch (error) {
    console.warn("Failed to fetch news:", error.message);
    return ["No recent news available."];
  }
}
/**
 * Fetches performance for key Indian sectors.
 */
export async function getIndianSectors() {
  try {
    const cacheKey = "MARKET_SECTORS_IN";
    const cached = await getHybridCache(cacheKey, "LOW");
    if (cached) return cached;

    const symbols = ["^NSEBANK", "^CNXIT"]; // Nifty Bank and Nifty IT
    const results = await getOrPopulateSharedCache(cacheKey, CACHE_GROUP_MARKET, ttlSecondsForQuality("LOW"), async () =>
      withProviderGuard("yahoo", async () => yahooFinance.quote(symbols))
    );
    
    const bank = results.find(r => r.symbol === "^NSEBANK") || {};
    const it = results.find(r => r.symbol === "^CNXIT") || {};

    const payload = {
      bank: bank.regularMarketChangePercent || 0,
      it: it.regularMarketChangePercent || 0
    };
    await setHybridCache(cacheKey, CACHE_GROUP_MARKET, payload, "LOW");
    return payload;
  } catch (error) {
    console.warn("Failed to fetch sectors:", error.message);
    return { bank: 0, it: 0 };
  }
}
export async function getCompanyOverview(symbol) {
  const upperSymbol = normalizeSymbol(symbol);
  if (!upperSymbol) return createFallbackOverview(symbol);

  return withRequestCoalescing(`OVERVIEW_${upperSymbol}`, async () => {
    const cacheKey = `OVERVIEW_${upperSymbol}`;
    const cached = await getHybridCache(cacheKey, "HIGH");
    if (cached) return cached;

    try {
      const overview = await getOrPopulateSharedCache(
        cacheKey,
        CACHE_GROUP_OVERVIEW,
        ttlSecondsForQuality("HIGH"),
        async () => {
          const symbolsToTry = buildSymbolVariants(upperSymbol);

          let result = null;
          let fetchSymbol = "";

          for (const sym of symbolsToTry) {
              try {
                  console.log(`FETCH ATTEMPT (Overview): ${sym}`);
                  const tempResult = await withProviderGuard("yahoo", async () =>
                    withTimeout(retry(() => yahooFinance.quoteSummary(sym, {
                      modules: ["price", "summaryDetail", "financialData", "defaultKeyStatistics", "assetProfile", "calendarEvents"]
                    }), 2, 500), YAHOO_TIMEOUT_MS)
                  );
                  const responseKeys = tempResult ? Object.keys(tempResult) : [];
                  console.log(`[OVERVIEW DEBUG] symbol=${sym} keys=${responseKeys.join(",") || "none"}`);
                  console.log(
                    `[OVERVIEW DEBUG] symbol=${sym} modules=${JSON.stringify({
                      hasPrice: !!tempResult?.price,
                      hasSummaryDetail: !!tempResult?.summaryDetail,
                      hasFinancialData: !!tempResult?.financialData,
                      hasDefaultKeyStatistics: !!tempResult?.defaultKeyStatistics,
                      hasAssetProfile: !!tempResult?.assetProfile,
                      hasCalendarEvents: !!tempResult?.calendarEvents
                    })}`
                  );
                  console.log("OVERVIEW RESPONSE:", safeString(JSON.stringify(tempResult, null, 2)));
                  if (tempResult && tempResult.assetProfile) {
                      result = tempResult;
                      fetchSymbol = sym;
                      break;
                  }
              } catch (e) {
                  console.warn(`[RETRY FAIL] Overview fetch failed for ${sym}:`, e.message);
                  logProviderError("yahoo", { stage: "overview", symbol: sym }, e);
                  if (e?.result) {
                    console.warn("OVERVIEW ERROR RESULT:", safeString(JSON.stringify(e.result, null, 2)));
                  }
              }
          }

          if (!result) {
              console.warn(`[FALLBACK] Yahoo overview unavailable for ${upperSymbol}. Trying provider chain.`);

              const alphaOverview = await alphaOverviewFetch(upperSymbol);
              if (alphaOverview) {
                console.log(`[OVERVIEW] source=alpha symbol=${upperSymbol} status=success`);
                return alphaOverview;
              }

              const finnhubOverview = await finnhubOverviewFetch(upperSymbol);
              if (finnhubOverview) {
                console.log(`[OVERVIEW] source=finnhub symbol=${upperSymbol} status=success`);
                return finnhubOverview;
              }

              console.warn(`[FALLBACK] Data unavailable for ${upperSymbol}`);
              return createFallbackOverview(upperSymbol);
          }

          console.log("FETCH SUCCESS (Overview):", fetchSymbol);
          const safeRaw = safeString(JSON.stringify(result));
          console.log("RAW YAHOO SUMMARY RESULT:", safeSubstring(safeRaw, 500));

          const {
            assetProfile = {},
            calendarEvents = {}
          } = result;

          const summary = result.summaryDetail || {};
          const financials = result.financialData || {};
          const stats = result.defaultKeyStatistics || {};
          console.log(
            `[OVERVIEW EXTRACT] symbol=${fetchSymbol} values=${JSON.stringify({
              trailingPE: summary.trailingPE ?? null,
              returnOnEquity: financials.returnOnEquity ?? null,
              profitMargins: financials.profitMargins ?? null,
              debtToEquity: financials.debtToEquity ?? null,
              revenueGrowth: financials.revenueGrowth ?? null,
              earningsGrowth: financials.earningsGrowth ?? null,
              priceToBook: stats.priceToBook ?? null,
              beta: stats.beta ?? null
            })}`
          );
          
          const fundamentals = {
            pe: summary.trailingPE ?? null,
            roe: financials.returnOnEquity ?? null,
            profitMargin: financials.profitMargins ?? null,
            debtToEquity: financials.debtToEquity ?? null,
            revenueGrowth: financials.revenueGrowth ?? null,
            earningsGrowth: financials.earningsGrowth ?? null
          };

          const format = (val, isPercent = false) => {
            if (val === null || val === undefined) return "-";
            return isPercent ? `${(val * 100).toFixed(2)}%` : val.toFixed(2);
          };

          const companyOverview = {
            Symbol: fetchSymbol,
            Name: assetProfile.longName || fetchSymbol,
            
            "P/E Ratio": format(fundamentals.pe),
            "ROE": format(fundamentals.roe, true),
            "Profit Margin": format(fundamentals.profitMargin, true),
            "Debt/Equity": format(fundamentals.debtToEquity),
            "Revenue Growth (YoY)": format(fundamentals.revenueGrowth, true),
            "Earnings Growth (YoY)": format(fundamentals.earningsGrowth, true),

            // Retain old keys for compatibility with telegram.service.js
            PERatio: format(fundamentals.pe),
            ReturnOnEquityTTM: format(fundamentals.roe, true),
            ProfitMargin: format(fundamentals.profitMargin, true),
            DebtToEquityRatio: format(fundamentals.debtToEquity),
            QuarterlyRevenueGrowthYOY: format(fundamentals.revenueGrowth, true),
            QuarterlyEarningsGrowthYOY: format(fundamentals.earningsGrowth, true),

            MarketCapitalization: summary.marketCap ?? null,
            PriceToBookRatio: stats.priceToBook ?? null,
            Beta: stats.beta ?? null,
            Sector: assetProfile.sector ?? null,
            Industry: assetProfile.industry ?? null,
            BusinessSummary: assetProfile.longBusinessSummary ?? null,
            EarningsDate: calendarEvents?.earnings?.earningsDate?.[0] ?? null
          };

          console.log("FINAL OVERVIEW:", companyOverview);
          console.log("DEBUG OVERVIEW FIELDS:", {
              Symbol: companyOverview.Symbol,
              PERatio: companyOverview.PERatio,
              ROE: companyOverview.ReturnOnEquityTTM,
              RevenueGrowth: companyOverview.QuarterlyRevenueGrowthYOY,
              EarningsGrowth: companyOverview.QuarterlyEarningsGrowthYOY,
              Sector: companyOverview.Sector
          });

          return companyOverview;
        },
        {
          lockOwner: `overview:${upperSymbol}`
        }
      );

      const overviewQuality =
        overview?.source === "alpha_vantage" ||
        overview?.source === "finnhub" ||
        overview?.status === "FALLBACK_SAFE"
          ? "LOW"
          : "HIGH";
      await setHybridCache(cacheKey, CACHE_GROUP_OVERVIEW, overview, overviewQuality);
      return overview;
    } catch (error) {
      console.error("--- YAHOO OVERVIEW FAILURE ---");
      console.error(`SYMBOL: ${symbol}`);
      console.error(`ERROR: ${error.message}`);
      console.error(`STACK: ${error.stack}`);
      logProviderError("yahoo", { stage: "overview-critical", symbol }, error);

      const alphaOverview = await alphaOverviewFetch(upperSymbol);
      if (alphaOverview) return alphaOverview;

      const finnhubOverview = await finnhubOverviewFetch(upperSymbol);
      if (finnhubOverview) return finnhubOverview;

      const fallbackOverview = createFallbackOverview(upperSymbol);
      await setHybridCache(cacheKey, CACHE_GROUP_OVERVIEW, fallbackOverview, "LOW");
      return fallbackOverview;
    }
  });
}

async function getMarketStatusIST() {
    const now = new Date();
    const ist = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    const year = ist.getFullYear();
    
    // Fix: Safe IST date string conversion
    const dateStr = ist.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    
    const holidays = await fetchIndianHolidays(year);
    const safeHolidays = holidays && holidays.size > 0 ? holidays : new Set();
    
    const day = ist.getDay(); 
    const hours = ist.getHours();
    const minutes = ist.getMinutes();
    
    const time = hours * 60 + minutes;
    const open = 9 * 60 + 15;   // 9:15 AM
    const close = 15 * 60 + 30; // 3:30 PM
    
    const isWeekend = day === 0 || day === 6;
    const isHoliday = safeHolidays.has(dateStr);
    
    // Explicit Phase Classification
    const isPreMarket = !isWeekend && !isHoliday && time < open;
    const isLive = !isWeekend && !isHoliday && time >= open && time <= close;
    const isPostMarket = !isWeekend && !isHoliday && time > close;

    // Fix: Consecutive holiday / weekend aware next session logic
    function getNextTradingDay(currentIst, holidaySet) {
        const next = new Date(currentIst);
        while (true) {
            next.setDate(next.getDate() + 1);
            const d = next.getDay();
            const dStr = next.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
            const isWknd = d === 0 || d === 6;
            const isHolid = holidaySet.has(dStr);
            if (!isWknd && !isHolid) break;
        }
        // Force 9:15 AM
        next.setHours(9, 15, 0, 0);
        return next;
    }
    // Fix: Accurate last trading day logic
    function getLastTradingDay(currentIst, holidaySet) {
        const prev = new Date(currentIst);
        while (true) {
            prev.setDate(prev.getDate() - 1);
            const d = prev.getDay();
            const dStr = prev.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
            const isWknd = d === 0 || d === 6;
            const isHolid = holidaySet.has(dStr);
            if (!isWknd && !isHolid) break;
        }
        return prev;
    }

    const nextTradingDay = getNextTradingDay(ist, safeHolidays);
    const lastTradingDay = getLastTradingDay(ist, safeHolidays);
    
    return {
        isMarketOpen: isLive,
        isPreMarket,
        isLive,
        isPostMarket,
        isWeekend,
        isHoliday,
        nextTradingDay,
        lastTradingDay,
        istTime: ist
    };
}

async function retry(fn, retries = 3, initialDelay = 500) {
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (error) {
            if (i === retries - 1) throw error;
            const delay = initialDelay * Math.pow(2, i);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

async function alphaQuoteFetch(symbol) {
  try {
    const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
    if (!apiKey) return null;
    
    const avSymbol = toAlphaSymbol(symbol);
    const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${avSymbol}&apikey=${apiKey}`;

    const payload = await withProviderGuard("alpha_vantage", async () =>
      fetchJsonWithTimeout(url, {}, HTTP_PROVIDER_TIMEOUT_MS)
    );
    const quote = payload["Global Quote"];
    
    if (!quote || !quote["05. price"]) return null;
    
    return {
      symbol: symbol,
      regularMarketPrice: parseFloat(quote["05. price"]),
      regularMarketChangePercent: parseFloat(String(quote["10. change percent"] || "0").replace("%", "")),
      regularMarketPreviousClose: parseFloat(quote["08. previous close"]),
      source: "FALLBACK"
    };
  } catch (err) {
    logProviderError("alpha", { stage: "quote", symbol }, err);
    return null;
  }
}

async function alphaOverviewFetch(symbol) {
  try {
    const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
    if (!apiKey) return null;

    const baseSymbol = toBaseTicker(symbol);
    const url = `https://www.alphavantage.co/query?function=OVERVIEW&symbol=${baseSymbol}&apikey=${apiKey}`;
    const payload = await withProviderGuard("alpha_vantage", async () =>
      fetchJsonWithTimeout(url, {}, HTTP_PROVIDER_TIMEOUT_MS)
    );
    if (!payload || !payload.Symbol) return null;
    return normalizeAlphaOverviewPayload(payload, symbol);
  } catch (err) {
    logProviderError("alpha", { stage: "overview", symbol }, err);
    return null;
  }
}

async function twelveDataQuoteFetch(symbol) {
  try {
    const apiKey = process.env.TWELVEDATA_API_KEY;
    if (!apiKey) return null;

    const baseSymbol = toBaseTicker(symbol);
    const attempts = [
      `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(baseSymbol)}&exchange=NSE&interval=1day&apikey=${apiKey}`,
      `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(baseSymbol)}&exchange=BSE&interval=1day&apikey=${apiKey}`,
      `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(baseSymbol)}&interval=1day&apikey=${apiKey}`
    ];

    for (const url of attempts) {
      try {
        const payload = await withProviderGuard("twelvedata", async () =>
          fetchJsonWithTimeout(url, {}, HTTP_PROVIDER_TIMEOUT_MS)
        );
        if (payload?.status === "error") continue;
        const close = Number(payload?.close);
        if (Number.isFinite(close) && close > 0) {
          return {
            symbol,
            regularMarketPrice: close,
            regularMarketChangePercent: Number(payload?.percent_change || 0),
            regularMarketChange: Number(payload?.change || 0),
            regularMarketPreviousClose: Number(payload?.previous_close || 0),
            source: "FALLBACK"
          };
        }
      } catch (err) {
        logProviderError("twelvedata", { stage: "quote-attempt", symbol, url }, err);
      }
    }
  } catch (err) {
    logProviderError("twelvedata", { stage: "quote", symbol }, err);
  }
  return null;
}

async function finnhubQuoteFetch(symbol) {
  try {
    const apiKey = process.env.FINNHUB_API_KEY;
    if (!apiKey) return null;

    const baseSymbol = toBaseTicker(symbol);
    const attempts = [`NSE:${baseSymbol}`, `BSE:${baseSymbol}`, baseSymbol];

    for (const candidate of attempts) {
      try {
        const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(candidate)}&token=${apiKey}`;
        const payload = await withProviderGuard("finnhub", async () =>
          fetchJsonWithTimeout(url, {}, HTTP_PROVIDER_TIMEOUT_MS)
        );
        const price = Number(payload?.c || 0);
        if (Number.isFinite(price) && price > 0) {
          return {
            symbol: candidate,
            regularMarketPrice: price,
            regularMarketChangePercent: Number(payload?.dp || 0),
            regularMarketChange: Number(payload?.d || 0),
            regularMarketPreviousClose: Number(payload?.pc || 0),
            source: "FALLBACK"
          };
        }
      } catch (err) {
        logProviderError("finnhub", { stage: "quote-attempt", symbol: candidate }, err);
      }
    }
  } catch (err) {
    logProviderError("finnhub", { stage: "quote", symbol }, err);
  }
  return null;
}

async function finnhubOverviewFetch(symbol) {
  try {
    const apiKey = process.env.FINNHUB_API_KEY;
    if (!apiKey) return null;

    const baseSymbol = toBaseTicker(symbol);
    const attempts = [`NSE:${baseSymbol}`, `BSE:${baseSymbol}`, baseSymbol];

    for (const candidate of attempts) {
      try {
        const [profile, basics] = await Promise.all([
          withProviderGuard("finnhub", async () =>
            fetchJsonWithTimeout(`https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(candidate)}&token=${apiKey}`, {}, HTTP_PROVIDER_TIMEOUT_MS)
          ),
          withProviderGuard("finnhub", async () =>
            fetchJsonWithTimeout(`https://finnhub.io/api/v1/stock/metric?symbol=${encodeURIComponent(candidate)}&metric=all&token=${apiKey}`, {}, HTTP_PROVIDER_TIMEOUT_MS)
          )
        ]);

        const normalized = normalizeFinnhubOverviewPayload({
          profile,
          metrics: basics?.metric || {}
        }, candidate);

        if (normalized) return normalized;
      } catch (err) {
        logProviderError("finnhub", { stage: "overview-attempt", symbol: candidate }, err);
      }
    }
  } catch (err) {
    logProviderError("finnhub", { stage: "overview", symbol }, err);
  }
  return null;
}

export async function getLiveMarketData(symbol) {
  const upperSymbol = normalizeSymbol(symbol);
  if (!upperSymbol) return createFallbackLiveData(symbol);

  return withRequestCoalescing(`LIVE_${upperSymbol}`, async () => {
    const startTime = Date.now();
    const cacheKey = `LIVE_${upperSymbol}`;

    try {
      const marketStatus = await getMarketStatusIST();

      // 1. CHECK CACHE (Institutional Guard)
      const cached = await getHybridCache(cacheKey, "HIGH");
      if (cached) {
        const age = Math.floor((Date.now() - cached.timestamp) / 1000);
        const shouldBypassCache = marketStatus.isPreMarket || marketStatus.isPostMarket;
        if (!shouldBypassCache) {
          console.log(`[CACHE] hit symbol=${upperSymbol} age=${age}s`);
          return { ...cached, dataAge: age, dataConfidence: "CACHED" };
        }
        console.log(
          `[CACHE] bypass symbol=${upperSymbol} age=${age}s reason=${marketStatus.isPostMarket ? "post-market" : "pre-market"}`
        );
      }

      const finalData = await getOrPopulateSharedCache(
        cacheKey,
        CACHE_GROUP_LIVE,
        ttlSecondsForQuality("LOW"),
        async () => {
          const symbolsToTry = buildSymbolVariants(upperSymbol);

          let result = null;
          let fetchSymbol = "";
          let priceSource = "FAILED";
          let priceField = "UNKNOWN";
          let dataConfidence = "LIVE_VERIFIED";
          let completeness = "FULL";

          // 2. PRIMARY FETCH (Yahoo) with Circuit Breaker
          const yahooAvailable = Date.now() >= yahooCooldownUntil;
          if (yahooAvailable) {
            for (const sym of symbolsToTry) {
                try {
                    console.log(`[DATA] attempt=yahoo symbol=${sym}`);
                    const tempResult = await withProviderGuard("yahoo", async () =>
                      withTimeout(retry(() => yahooFinance.quote(sym), 1, 500), YAHOO_TIMEOUT_MS)
                    );
                    const resolvedYahooPrice = resolveBestPrice(tempResult);
                    if (tempResult && resolvedYahooPrice.value > 0) {
                        result = tempResult;
                        fetchSymbol = sym;
                        priceSource = "YAHOO";
                        priceField = resolvedYahooPrice.field || "UNKNOWN";
                        reportYahooStatus(true);
                        break;
                    }
                } catch (e) {
                    console.warn(`[DATA] source=yahoo symbol=${sym} status=fail error="${e.message}"`);
                    logProviderError("yahoo", { stage: "quote", symbol: sym }, e);
                }
                await new Promise(r => setTimeout(r, 300));
            }
          } else {
            console.warn(`[CIRCUIT BREAKER] Skipping Yahoo for ${upperSymbol} (cooling down)`);
          }

          if (!result) reportYahooStatus(false);

          // 3. FALLBACK FETCH (Alpha Vantage -> Twelve Data -> Finnhub)
          if (!result) {
            console.log(`[DATA] attempt=alpha symbol=${upperSymbol}`);
            result = await alphaQuoteFetch(upperSymbol.includes(".") ? upperSymbol : `${upperSymbol}.NS`);
            if (result) {
              priceSource = "ALPHA_VANTAGE";
              dataConfidence = "DEGRADED_SOURCE";
              completeness = "PARTIAL";
              fetchSymbol = result.symbol;
              dataMetrics.alphaSuccess++;
              console.log(`[DATA] source=alpha symbol=${upperSymbol} status=fallback`);
            }
          }

          if (!result) {
            console.log(`[DATA] attempt=twelvedata symbol=${upperSymbol}`);
            result = await twelveDataQuoteFetch(upperSymbol);
            if (result) {
              priceSource = "TWELVEDATA";
              dataConfidence = "DEGRADED_SOURCE";
              completeness = "PARTIAL";
              fetchSymbol = result.symbol;
              console.log(`[DATA] source=twelvedata symbol=${upperSymbol} status=fallback`);
            }
          }

          if (!result) {
            console.log(`[DATA] attempt=finnhub symbol=${upperSymbol}`);
            result = await finnhubQuoteFetch(upperSymbol);
            if (result) {
              priceSource = "FINNHUB";
              dataConfidence = "DEGRADED_SOURCE";
              completeness = "PARTIAL";
              fetchSymbol = result.symbol;
              console.log(`[DATA] source=finnhub symbol=${upperSymbol} status=fallback`);
            }
          }

          const fetchDuration = Date.now() - startTime;
          const resolvedPrice = resolveBestPrice(result);
          let currentPrice = resolvedPrice.value;
          let previousClose = toPositiveNumber(result?.regularMarketPreviousClose) || toPositiveNumber(result?.previousClose) || 0;
          const latencyBlocked = fetchDuration > 2500;

          console.log("PRICE FIELDS:", {
            symbol: fetchSymbol || upperSymbol,
            regularMarketPrice: result?.regularMarketPrice,
            regularMarketPreviousClose: result?.regularMarketPreviousClose,
            postMarketPrice: result?.postMarketPrice,
            preMarketPrice: result?.preMarketPrice,
            currentPrice: result?.currentPrice,
            previousClose: result?.previousClose,
            chosenPriceField: resolvedPrice.field,
            chosenPrice: resolvedPrice.value
          });

          if (!currentPrice && previousClose) {
              currentPrice = previousClose;
              priceField = "regularMarketPreviousClose";
              if (priceSource === "FAILED") priceSource = "PREVIOUS_CLOSE";
          }

          if (resolvedPrice.field) priceField = resolvedPrice.field;

          if (!currentPrice || currentPrice === 0) {
              console.warn(`[FALLBACK] Data extraction failed for ${upperSymbol}`);
              return createFallbackLiveData(upperSymbol);
          }

          const finalData = {
              symbol: fetchSymbol || upperSymbol,
              price: currentPrice,
              currentPrice: currentPrice,
              previousClose: previousClose,
              change: result?.regularMarketChangePercent || 0,
              changeRaw: result?.regularMarketChange || 0,
              isMarketOpen: marketStatus.isMarketOpen,
              marketStatus,
              priceSource,
              priceField,
              dataConfidence,
              completeness,
              latencyBlocked,
              fetchDuration,
              dataAge: 0,
              timestamp: Date.now(),
              status: "success"
          };

          logMetric("provider.market_data.latency_ms", fetchDuration, {
            provider: priceSource,
            symbol: upperSymbol
          });
          console.log(`[DATA] source=${priceSource.toLowerCase()} symbol=${upperSymbol} status=success latency=${fetchDuration}ms`);
          return finalData;
        },
        {
          lockOwner: `live:${upperSymbol}`,
          fillLockTtlSeconds: 10
        }
      );

      await setHybridCache(cacheKey, CACHE_GROUP_LIVE, finalData, finalData.priceSource === "YAHOO" ? "HIGH" : "LOW");
      return finalData;

    } catch (error) {
      console.error(`[ERROR] layer=data symbol=${symbol} type=critical error="${error.message}"`);
      logProviderError("market-data", { stage: "critical", symbol }, error);
      const fallback = createFallbackLiveData(upperSymbol);
      await setHybridCache(cacheKey, CACHE_GROUP_LIVE, fallback, "LOW");
      return fallback;
    }
  });
}

export async function getHistoricalCandles(symbol, options = {}) {
  const upperSymbol = normalizeSymbol(symbol);
  if (!upperSymbol) return [];

  const days = Number(options.days || 320);
  const interval = options.interval || "1d";
  const cacheKey = `HISTORICAL_${upperSymbol}_${days}_${interval}`;

  return withRequestCoalescing(cacheKey, async () => {
    const cached = await getHybridCache(cacheKey, "HIGH");
    if (cached) return Array.isArray(cached) ? cached : [];

    const period2 = new Date();
    const period1 = new Date();
    period1.setDate(period2.getDate() - days);

    const queryOptions = {
      period1: period1.toISOString().split("T")[0],
      period2: period2.toISOString().split("T")[0],
      interval
    };

    const candles = await getOrPopulateSharedCache(
      cacheKey,
      CACHE_GROUP_HISTORICAL,
      ttlSecondsForQuality("HIGH"),
      async () => {
        const symbolsToTry = buildSymbolVariants(upperSymbol);
        for (const sym of symbolsToTry) {
          try {
            const tempHistory = await withProviderGuard("yahoo", async () =>
              withTimeout(retry(() => yahooFinance.historical(sym, queryOptions), 1, 500), YAHOO_TIMEOUT_MS)
            );
            if (Array.isArray(tempHistory) && tempHistory.length >= 20) {
              return tempHistory;
            }
          } catch (error) {
            logProviderError("yahoo", { stage: "historical", symbol: sym }, error);
          }
        }
        return [];
      },
      {
        lockOwner: `historical:${upperSymbol}:${days}:${interval}`,
        fillLockTtlSeconds: 15
      }
    );

    await setHybridCache(cacheKey, CACHE_GROUP_HISTORICAL, candles, "HIGH");
    return Array.isArray(candles) ? candles : [];
  });
}

// --- Warm Cache Strategy (Institutional Boot) ---
const POPULAR_SYMBOLS = ["TCS", "RELIANCE", "INFY", "HDFCBANK", "ICICIBANK"];
setTimeout(() => {
  console.log(`[BOOT] Warming up data cache for ${POPULAR_SYMBOLS.length} symbols...`);
  POPULAR_SYMBOLS.forEach(async (symbol) => {
    try {
      await getLiveMarketData(symbol);
    } catch (err) {
      // Silent fail for warm boot
    }
  });
}, 5000);

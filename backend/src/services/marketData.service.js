import axios from 'axios';
import YahooFinance from "yahoo-finance2";
import { fetchIndianHolidays } from "./holiday.service.js";

const yahooFinance = new YahooFinance();

/**
 * Fetches Nifty 50 and Sensex current quotes.
 */
export async function getIndianIndices() {
  try {
    const symbols = ["^NSEI", "^BSESN"]; // Nifty 50 and Sensex
    const results = await yahooFinance.quote(symbols);
    
    const nifty = results.find(r => r.symbol === "^NSEI") || {};
    const sensex = results.find(r => r.symbol === "^BSESN") || {};

    return {
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
    const result = await yahooFinance.search("India stock market", { newsCount: 5 });
    return result.news.map(n => n.title);
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
    const symbols = ["^NSEBANK", "^CNXIT"]; // Nifty Bank and Nifty IT
    const results = await yahooFinance.quote(symbols);
    
    const bank = results.find(r => r.symbol === "^NSEBANK") || {};
    const it = results.find(r => r.symbol === "^CNXIT") || {};

    return {
      bank: bank.regularMarketChangePercent || 0,
      it: it.regularMarketChangePercent || 0
    };
  } catch (error) {
    console.warn("Failed to fetch sectors:", error.message);
    return { bank: 0, it: 0 };
  }
}


const indianStocks = [
  "TCS",
  "INFY",
  "RELIANCE",
  "HDFCBANK",
  "ICICIBANK",
  "SBIN",
  "ITC",
  "LT",
  "ASIANPAINT",
  "SUNPHARMA",
  "WIPRO",
  "HCLTECH",
  "TECHM",
  "TATAMOTORS",
  "BAJFINANCE"
];

export async function getCompanyOverview(symbol) {
  try {
    const upperSymbol = symbol.toUpperCase().replace(/\s+/g, "");

    const symbolsToTry = upperSymbol.includes(".")
      ? [upperSymbol]
      : [`${upperSymbol}.NS`, `${upperSymbol}.BO`, upperSymbol];

    let result = null;
    let fetchSymbol = "";

    for (const sym of symbolsToTry) {
        try {
            console.log(`FETCH ATTEMPT (Overview): ${sym}`);
            const tempResult = await yahooFinance.quoteSummary(sym, {
                modules: ["financialData", "defaultKeyStatistics", "assetProfile", "summaryDetail", "calendarEvents"]
            });
            if (tempResult && tempResult.assetProfile) {
                result = tempResult;
                fetchSymbol = sym;
                break;
            }
        } catch (e) {
            console.warn(`[FAIL] quoteSummary for ${sym}: ${e.message}`);
        }
    }

    if (!result) {
        throw new Error(`Failed to fetch data for ${upperSymbol} after trying: ${symbolsToTry.join(", ")}`);
    }

    console.log("FETCH SUCCESS (Overview):", fetchSymbol);

    console.log("RAW YAHOO SUMMARY RESULT:", JSON.stringify(result).substring(0, 500));

    const {
      financialData = {},
      defaultKeyStatistics = {},
      assetProfile = {},
      summaryDetail = {},
      calendarEvents = {}
    } = result;

    const companyOverview = {
      Symbol: fetchSymbol,
      Name: assetProfile.longName || fetchSymbol,
      
      MarketCapitalization: summaryDetail.marketCap ?? null,
      PERatio: summaryDetail.trailingPE ?? null,
      ProfitMargin: financialData.profitMargins ?? null,
      ReturnOnEquityTTM: financialData.returnOnEquity ?? null,
      DebtToEquityRatio: financialData.debtToEquity ?? null,
      QuarterlyEarningsGrowthYOY: financialData.earningsGrowth ?? null,
      QuarterlyRevenueGrowthYOY: financialData.revenueGrowth ?? null,
      PriceToBookRatio: defaultKeyStatistics.priceToBook ?? null,
      Beta: defaultKeyStatistics.beta ?? null,
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

  } catch (error) {
    console.error("--- YAHOO OVERVIEW FAILURE ---");
    console.error(`SYMBOL: ${symbol}`);
    console.error(`ERROR: ${error.message}`);
    console.error(`STACK: ${error.stack}`);
    
    // Return at least the symbol to prevent downstream "UNKNOWN" errors
    const upperSymbol = symbol.toUpperCase().replace(/\s+/g, "");
    return {
      Symbol: upperSymbol.includes(".") ? upperSymbol : `${upperSymbol}.NS`
    };
  }
}

const priceCache = new Map();

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

export async function getLiveMarketData(symbol) {
  const startTime = Date.now();
  try {
    const upperSymbol = symbol.toUpperCase().replace(/\s+/g, "");
    const symbolsToTry = upperSymbol.includes(".")
        ? [upperSymbol]
        : [`${upperSymbol}.NS`, `${upperSymbol}.BO`, upperSymbol];

    let result = null;
    let fetchSymbol = "";
    let priceSource = "FAILED";
    const marketStatus = await getMarketStatusIST();
    const isMarketOpen = marketStatus.isMarketOpen;

    // 1. ATTEMPT LIVE FETCH
    for (const sym of symbolsToTry) {
        try {
            console.log(`FETCH ATTEMPT (Live): ${sym}`);
            const tempResult = await retry(() => yahooFinance.quote(sym), 3, 500);
            if (tempResult && (tempResult.regularMarketPrice || tempResult.currentPrice)) {
                result = tempResult;
                fetchSymbol = sym;
                priceSource = "LIVE";
                break;
            }
        } catch (e) {
            console.warn(`[FAIL] quote for ${sym}: ${e.message}`);
        }
    }

    const fetchDuration = Date.now() - startTime;
    let currentPrice = 0;
    let previousClose = result?.regularMarketPreviousClose || result?.previousClose || 0;
    let isStale = false;
    
    // Fix 1: Strict Latency Threshold (Execution Risk > 2s)
    const latencyBlocked = fetchDuration > 2000;

    // 2. EXTRACTION & LIQUIDITY-BASED CACHING
    if (result) {
        currentPrice = result.regularMarketPrice || result.currentPrice || previousClose || 0;
        if (currentPrice > 0) {
            priceCache.set(upperSymbol, {
                price: currentPrice,
                timestamp: Date.now(),
                volume: result.regularMarketVolume || 0,
                avgVolume: result.averageDailyVolume3Month || 1 // Avoid div by zero
            });
        }
    }

    // 3. MULTI-LAYER FALLBACK & TTL
    if (currentPrice === 0 || !isMarketOpen) {
        if (!isMarketOpen && priceSource === "LIVE") {
            console.log(`[MARKET CLOSED] Live data received outside hours for ${upperSymbol}. Semantically PREVIOUS_CLOSE.`);
            priceSource = "PREVIOUS_CLOSE";
        }
        
        if (currentPrice === 0) {
            if (previousClose > 0) {
                currentPrice = previousClose;
                priceSource = "PREVIOUS_CLOSE";
            } else if (priceCache.has(upperSymbol)) {
                const cached = priceCache.get(upperSymbol);
                currentPrice = cached.price;
                const ageSeconds = Math.floor((Date.now() - cached.timestamp) / 1000);
                
                // Liquidity-based TTL
                const liquidity = cached.volume / (cached.avgVolume || 1);
                const ttl = liquidity > 1 ? 5 * 60 : 10 * 60;
                
                if (ageSeconds > ttl) isStale = true;
                priceSource = isStale ? "CACHE_STALE" : "CACHE_FRESH";
            }
        }
    }

    if (!currentPrice || currentPrice === 0 || priceSource === "NONE" || priceSource === "FAILED") {
        throw new Error(`Critical data failure: Valid price or source could not be established for ${upperSymbol}`);
    }

    return {
      symbol: fetchSymbol || upperSymbol,
      currentPrice: currentPrice,
      priceSource: priceSource,
      dataAge: result ? 0 : Math.floor((Date.now() - (priceCache.get(upperSymbol)?.timestamp || Date.now())) / 1000),
      isStale: isStale || !isMarketOpen || latencyBlocked,
      latencyBlocked: latencyBlocked,
      fetchDuration: fetchDuration,
      isMarketOpen: isMarketOpen,
      marketStatus: marketStatus,
      previousClose: previousClose || (priceCache.get(upperSymbol)?.price) || 0,
      volume: result?.regularMarketVolume || 0,
      averageVolume: result?.averageDailyVolume3Month || 0,
      marketCap: result?.marketCap || 0,
      currency: result?.currency || "INR"
    };

  } catch (error) {
    return {
      error: true,
      message: error.message,
      currentPrice: 0,
      priceSource: "FAILED",
      isStale: true
    };
  }
}
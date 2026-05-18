/**
 * Institutional Intelligence Service
 * Handles: Signals, Sector Strength, and Relative Strength
 */
import { getHistoricalCandles } from "./marketData.service.js";
import { getOrPopulateSharedCache, getSharedCache } from "./sharedCache.service.js";
import { logEvent, logMetric } from "./telemetry.service.js";

export function calculateRelativeStrength(stockChange, indexChange) {
  const diff = stockChange - indexChange;
  if (diff > 2) return { status: "Outperforming Index", strength: "STRONG" };
  if (diff > 0) return { status: "Leading Index", strength: "MODERATE" };
  if (diff < -2) return { status: "Underperforming Index", strength: "WEAK" };
  return { status: "Neutral vs Index", strength: "NEUTRAL" };
}

export function generateSignals(data) {
  const signals = [];
  
  // 1. Fundamental Quality (Compounder)
  if (data.roe > 18 && data.revenueGrowth > 12 && data.pe < 40) {
    signals.push({ type: "QUALITY_COMPOUNDER", confidence: 9, note: "Top-tier capital efficiency and growth." });
  }

  // 2. Value Opportunity
  if (data.pe < 15 && data.dividendYield > 2) {
    signals.push({ type: "VALUE_PICK", confidence: 7, note: "Undervalued with strong dividend support." });
  }

  // 3. Momentum / Accumulation
  if (data.priceAboveMA200 && data.volumeSpike) {
    signals.push({ type: "ACCUMULATION_ZONE", confidence: 8, note: "Institutional accumulation detected near support." });
  }

  return signals;
}

const SECTOR_CACHE_KEY = "SECTOR_MOMENTUM_V2";
const SECTOR_CACHE_GROUP = "sector_momentum";
const SECTOR_TTL_SECONDS = 4 * 60 * 60;
const SECTOR_CONSTITUENTS = {
  IT: ["TCS", "INFY", "HCLTECH", "WIPRO", "TECHM"],
  BANK: ["HDFCBANK", "ICICIBANK", "SBIN", "KOTAKBANK", "AXISBANK"],
  AUTO: ["MARUTI", "TATAMOTORS", "M&M", "BAJAJ-AUTO", "EICHERMOT"],
  FMCG: ["HINDUNILVR", "ITC", "NESTLEIND", "BRITANNIA", "TATACONSUM"],
  PHARMA: ["SUNPHARMA", "DRREDDY", "CIPLA", "DIVISLAB", "LUPIN"],
  ENERGY: ["RELIANCE", "ONGC", "BPCL", "IOC", "GAIL"],
  METAL: ["TATASTEEL", "JSWSTEEL", "HINDALCO", "VEDL", "SAIL"],
  REALTY: ["DLF", "GODREJPROP", "OBEROIRLTY", "LODHA", "PRESTIGE"]
};

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function computeRsi(closes = [], period = 14) {
  if (closes.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const delta = closes[i] - closes[i - 1];
    if (delta >= 0) gains += delta;
    else losses -= delta;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

async function computeSectorMetrics(sector, symbols) {
  const startedAt = Date.now();
  const rows = [];
  let failures = 0;
  for (const symbol of symbols) {
    try {
      const candles = await getHistoricalCandles(symbol, { days: 60, interval: "1d" });
      if (!Array.isArray(candles) || candles.length < 25) continue;
      const closes = candles.map((c) => toNum(c?.close)).filter((v) => v > 0);
      if (closes.length < 25) continue;
      const last = closes[closes.length - 1];
      const d5 = closes[closes.length - 6];
      const d20 = closes[closes.length - 21];
      const sma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
      const vol = closes.slice(-20).reduce((acc, v, idx, arr) => {
        if (idx === 0) return acc;
        const ret = (v - arr[idx - 1]) / arr[idx - 1];
        return acc + ret * ret;
      }, 0);
      const rsi = computeRsi(closes);
      rows.push({
        r5: ((last - d5) / d5) * 100,
        r20: ((last - d20) / d20) * 100,
        rsi: toNum(rsi),
        trend: last > sma20 ? 1 : -1,
        vol: Math.sqrt(vol / 19) * 100,
        above20: last > sma20 ? 1 : 0
      });
    } catch {
      failures += 1;
    }
  }

  const providerFailureRate = symbols.length > 0 ? failures / symbols.length : 1;
  logMetric("sector.provider_failure_rate", Number(providerFailureRate.toFixed(3)), { sector });
  logMetric("sector.calc_duration_ms", Date.now() - startedAt, { sector });

  if (rows.length === 0) return null;
  const n = rows.length;
  const avg = (k) => rows.reduce((s, r) => s + toNum(r[k]), 0) / n;
  const breadth = (rows.reduce((s, r) => s + r.above20, 0) / n) * 100;
  const trendScore = ((avg("trend") + 1) / 2) * 10;
  const volatilityScore = Math.max(1, 10 - Math.min(9, avg("vol")));
  const strength = (avg("r5") * 0.35) + (avg("r20") * 0.45) + ((avg("rsi") - 50) * 0.2);
  const bias = strength >= 2 && breadth >= 60 && avg("rsi") >= 53
    ? "BULLISH"
    : strength <= -2 || breadth <= 40 || avg("rsi") <= 47
    ? "BEARISH"
    : "NEUTRAL";

  return {
    sector,
    bias,
    strength: Number(strength.toFixed(2)),
    metrics: {
      avgReturn5d: Number(avg("r5").toFixed(2)),
      avgReturn20d: Number(avg("r20").toFixed(2)),
      avgRsi: Number(avg("rsi").toFixed(2)),
      trendScore: Number(trendScore.toFixed(2)),
      volatilityScore: Number(volatilityScore.toFixed(2)),
      breadthScore: Number(breadth.toFixed(2))
    },
    constituentsAnalyzed: n,
    totalConstituents: symbols.length
  };
}

export async function getSectorMomentum() {
  const cached = await getSharedCache(SECTOR_CACHE_KEY);
  logMetric("sector.cache_hit", cached ? 1 : 0);
  if (cached) return cached;

  const startedAt = Date.now();
  const payload = await getOrPopulateSharedCache(
    SECTOR_CACHE_KEY,
    SECTOR_CACHE_GROUP,
    SECTOR_TTL_SECONDS,
    async () => {
      const entries = await Promise.all(
        Object.entries(SECTOR_CONSTITUENTS).map(async ([sector, symbols]) => [sector, await computeSectorMetrics(sector, symbols)])
      );
      const result = {};
      entries.forEach(([sector, metrics]) => {
        if (metrics) result[sector] = metrics;
      });
      if (Object.keys(result).length === 0) {
        return { unavailable: true, message: "Sector momentum unavailable." };
      }
      return result;
    },
    {
      lockOwner: "sector_momentum",
      fillLockTtlSeconds: 60,
      waitMs: 8000
    }
  );
  logMetric("sector.calc_duration_ms", Date.now() - startedAt, { scope: "all" });
  logEvent("sector.momentum.refreshed", { sectors: Object.keys(payload || {}).length });
  return payload;
}

export function calculatePositionSize(riskAmount, entry, stopLoss) {
  if (!entry || !stopLoss || entry <= stopLoss) return null;
  const riskPerShare = entry - stopLoss;
  return Math.floor(riskAmount / riskPerShare);
}

import supabase from "./supabase.service.js";
import { getHistoricalCandles, getLiveMarketData } from "./marketData.service.js";

const TIMEFRAME_DAYS = {
  "1D": 2,
  "1W": 7,
  "1M": 30,
  "3M": 90,
  "6M": 180,
  "1Y": 365
};

function toNumber(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function stddev(values = []) {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((acc, x) => acc + ((x - mean) ** 2), 0) / (values.length - 1);
  return Math.sqrt(Math.max(variance, 0));
}

function covariance(a = [], b = []) {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  const x = a.slice(-n);
  const y = b.slice(-n);
  const mx = x.reduce((s, v) => s + v, 0) / n;
  const my = y.reduce((s, v) => s + v, 0) / n;
  return x.reduce((acc, v, i) => acc + ((v - mx) * (y[i] - my)), 0) / (n - 1);
}

function normalizeCandles(candles = []) {
  return candles
    .map((c) => ({
      timestamp: new Date(c.date || c.timestamp || c.datetime || Date.now()).getTime(),
      open: toNumber(c.open),
      high: toNumber(c.high),
      low: toNumber(c.low),
      close: toNumber(c.close),
      volume: toNumber(c.volume)
    }))
    .filter((c) => c.close > 0)
    .sort((a, b) => a.timestamp - b.timestamp);
}

export async function fetchHistoricalCandles(ticker, timeframe = "1Y") {
  const days = TIMEFRAME_DAYS[String(timeframe).toUpperCase()] || 365;
  const candles = await getHistoricalCandles(ticker, { days, interval: "1d" });
  return normalizeCandles(candles);
}

export function fetchRollingReturns(candles = []) {
  const out = [];
  for (let i = 1; i < candles.length; i += 1) {
    const prev = candles[i - 1].close;
    const curr = candles[i].close;
    if (prev > 0 && curr > 0) out.push((curr / prev) - 1);
  }
  return out;
}

export function fetchRollingVolatility(returns = [], window = 20) {
  if (!returns.length) return 0;
  const sample = returns.slice(-window);
  return stddev(sample) * Math.sqrt(252);
}

export function fetchHistoricalVolume(candles = [], window = 20) {
  const sample = candles.slice(-window);
  if (!sample.length) return { averageVolume: 0, latestVolume: 0, volumeRatio: 1 };
  const avg = sample.reduce((s, c) => s + c.volume, 0) / sample.length;
  const latest = sample[sample.length - 1]?.volume || 0;
  return {
    averageVolume: Number(avg.toFixed(2)),
    latestVolume: Number(latest.toFixed(2)),
    volumeRatio: Number((latest / Math.max(avg, 1)).toFixed(4))
  };
}

export async function fetchHistoricalBeta(ticker, benchmarkTicker = "^NSEI", days = 252) {
  const [assetCandles, benchCandles] = await Promise.all([
    fetchHistoricalCandles(ticker, "1Y"),
    fetchHistoricalCandles(benchmarkTicker, "1Y")
  ]);
  const rA = fetchRollingReturns(assetCandles).slice(-days);
  const rB = fetchRollingReturns(benchCandles).slice(-days);
  const cov = covariance(rA, rB);
  const varB = covariance(rB, rB);
  return varB > 0 ? Number((cov / varB).toFixed(4)) : 1;
}

export function fetchHistoricalDrawdowns(candles = []) {
  let peak = 0;
  let maxDrawdown = 0;
  const curve = candles.map((c) => {
    peak = Math.max(peak, c.close);
    const dd = peak > 0 ? ((c.close / peak) - 1) : 0;
    maxDrawdown = Math.min(maxDrawdown, dd);
    return { timestamp: c.timestamp, drawdown: dd };
  });
  return {
    maxDrawdown: Number((maxDrawdown * 100).toFixed(2)),
    curve
  };
}

export async function fetchHistoricalCorrelationData(tickers = [], timeframe = "1Y") {
  const entries = await Promise.all(
    tickers.map(async (ticker) => {
      const candles = await fetchHistoricalCandles(ticker, timeframe);
      return { ticker, candles, returns: fetchRollingReturns(candles) };
    })
  );
  return entries;
}

export async function buildHistoricalFactorSnapshot(ticker) {
  const [candles, live] = await Promise.all([
    fetchHistoricalCandles(ticker, "1Y"),
    getLiveMarketData(ticker).catch(() => ({}))
  ]);

  const returns = fetchRollingReturns(candles);
  const volatility = fetchRollingVolatility(returns);
  const volume = fetchHistoricalVolume(candles);
  const drawdowns = fetchHistoricalDrawdowns(candles);
  const beta = await fetchHistoricalBeta(ticker).catch(() => 1);

  return {
    ticker,
    candles,
    returns,
    volatility,
    volume,
    drawdowns,
    beta,
    currentPrice: toNumber(live.currentPrice, candles[candles.length - 1]?.close || 0)
  };
}

export async function persistHistoricalMarketReturns(records = []) {
  if (!records.length) return;
  const rows = records.map((r) => ({
    ticker: r.ticker,
    timeframe: r.timeframe || "1Y",
    returns: r.returns || [],
    volatility: Number(r.volatility || 0),
    beta: Number(r.beta || 1),
    created_at: new Date().toISOString()
  }));

  const { error } = await supabase.from("historical_market_returns").insert(rows);
  if (error) console.warn("[HIST] persistHistoricalMarketReturns failed:", error.message);
}

import { getHistoricalCandles } from "./marketData.service.js";

const BENCHMARK_SYMBOLS = {
  NIFTY50: "^NSEI",
  BANKNIFTY: "^NSEBANK",
  AUTO: "NIFTY_AUTO",
  IT: "NIFTY_IT",
  FINANCIALS: "NIFTY_FIN_SERVICE"
};

function toDateOnly(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid timestamp: ${value}`);
  return d.toISOString().slice(0, 10);
}

function normalizeCandle(candle) {
  const ts = candle?.date || candle?.timestamp;
  const close = Number(candle?.close);
  if (!ts || !Number.isFinite(close) || close <= 0) throw new Error("Invalid benchmark candle");
  return { date: toDateOnly(ts), close };
}

function cumulativeCurve(candles, startDate, endDate) {
  const start = toDateOnly(startDate);
  const end = toDateOnly(endDate);
  const filtered = candles
    .map(normalizeCandle)
    .filter((c) => c.date >= start && c.date <= end)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (filtered.length < 2) throw new Error("Insufficient benchmark candles");

  const base = filtered[0].close;
  return filtered.map((c) => ({
    timestamp: `${c.date}T00:00:00.000Z`,
    equity: c.close,
    cumulative_return: ((c.close - base) / base) * 100
  }));
}

export async function getBenchmarkReturns({ startDate, endDate, benchmark = "NIFTY50", days = 400 } = {}) {
  const symbol = BENCHMARK_SYMBOLS[String(benchmark || "").toUpperCase()] || BENCHMARK_SYMBOLS.NIFTY50;
  const candles = await getHistoricalCandles(symbol, { days, interval: "1d" });
  const curve = cumulativeCurve(candles || [], startDate, endDate);
  return {
    benchmark: String(benchmark || "NIFTY50").toUpperCase(),
    symbol,
    curve,
    total_return_pct: curve[curve.length - 1].cumulative_return
  };
}

export function compareAgainstBenchmark(strategyReturns = [], benchmarkReturns = []) {
  const n = Math.min(strategyReturns.length, benchmarkReturns.length);
  if (n < 2) {
    return {
      alpha: 0,
      beta: 0,
      benchmark_return: 0,
      excess_return: 0,
      comparison_version: "benchmark-v1"
    };
  }

  const s = strategyReturns.slice(-n);
  const b = benchmarkReturns.slice(-n);

  const mean = (arr) => arr.reduce((sum, v) => sum + v, 0) / arr.length;
  const varOf = (arr, mu) => arr.reduce((sum, v) => sum + ((v - mu) ** 2), 0) / (arr.length - 1);

  const muS = mean(s);
  const muB = mean(b);
  const cov = s.reduce((sum, v, i) => sum + ((v - muS) * (b[i] - muB)), 0) / (n - 1);
  const varB = varOf(b, muB);
  const beta = varB === 0 ? 0 : cov / varB;
  const alpha = muS - (beta * muB);

  return {
    alpha,
    beta,
    excess_return: s.reduce((sum, v, i) => sum + (v - b[i]), 0)
  };
}

export function computeRelativeAlpha(strategyTotalReturnPct = 0, benchmarkTotalReturnPct = 0) {
  return Number(strategyTotalReturnPct) - Number(benchmarkTotalReturnPct);
}

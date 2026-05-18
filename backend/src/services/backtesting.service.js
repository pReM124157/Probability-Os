import supabase from "./supabase.service.js";
import { getHistoricalCandles } from "./marketData.service.js";
import { logEvent } from "./telemetry.service.js";
import { compareAgainstBenchmark, computeRelativeAlpha, getBenchmarkReturns } from "./benchmark.service.js";

const REPLAY_VERSION = "replay-v1";
const EXECUTION_VERSION = "execution-v1";
const METRICS_VERSION = "metrics-v1";
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_SLIPPAGE_BPS = Number(process.env.BACKTEST_SLIPPAGE_BPS || 5);
const DEFAULT_TXN_COST_BPS = Number(process.env.BACKTEST_TXN_COST_BPS || 10);
const STRATEGY_SET = ["HOLD", "BUY", "SWING", "MOMENTUM", "VALUE", "BREAKOUT"];

class BacktestingError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = "BacktestingError";
    this.code = code;
    this.details = details;
  }
}

function toNum(v, name) {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new BacktestingError(`Invalid number for ${name}`, "INVALID_NUMERIC", { name, v });
  return n;
}

function toTs(v, name) {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new BacktestingError(`Malformed timestamp for ${name}`, "INVALID_TIMESTAMP", { name, v });
  return d;
}

function dateOnly(v) {
  return toTs(v, "date").toISOString().slice(0, 10);
}

function dailyReturnsFromCurve(curve = []) {
  const out = [];
  for (let i = 1; i < curve.length; i += 1) {
    const prev = Number(curve[i - 1].equity);
    const next = Number(curve[i].equity);
    if (!Number.isFinite(prev) || !Number.isFinite(next) || prev <= 0) continue;
    out.push(((next - prev) / prev) * 100);
  }
  return out;
}

function stddev(values) {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((s, x) => s + ((x - mean) ** 2), 0) / (values.length - 1);
  return Math.sqrt(Math.max(variance, 0));
}

function maxDrawdownFromCurve(curve = []) {
  let peak = Number.NEGATIVE_INFINITY;
  let maxDd = 0;
  for (const p of curve) {
    const eq = Number(p.equity);
    if (!Number.isFinite(eq) || eq <= 0) throw new BacktestingError("Invalid equity point", "INVALID_EQUITY");
    peak = Math.max(peak, eq);
    const dd = ((eq - peak) / peak) * 100;
    if (dd < maxDd) maxDd = dd;
  }
  return maxDd;
}

function buildRollingSeries(equityCurve = [], window = 20) {
  if (equityCurve.length < 2) return { rollingCagr: [], rollingSharpe: [] };
  const rollingCagr = [];
  const rollingSharpe = [];
  for (let i = 1; i < equityCurve.length; i += 1) {
    const left = Math.max(0, i - window + 1);
    const sample = equityCurve.slice(left, i + 1);
    const first = Number(sample[0].equity);
    const last = Number(sample[sample.length - 1].equity);
    const days = Math.max(1, sample.length);
    const years = days / 252;
    const cagr = first > 0 ? (((last / first) ** (1 / years)) - 1) * 100 : 0;
    const rets = dailyReturnsFromCurve(sample).map((r) => r / 100);
    const mu = rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length : 0;
    const sigma = stddev(rets);
    const sharpe = sigma === 0 ? 0 : (mu / sigma) * Math.sqrt(252);
    const ts = sample[sample.length - 1].timestamp;
    rollingCagr.push({ timestamp: ts, value: Number(cagr.toFixed(6)) });
    rollingSharpe.push({ timestamp: ts, value: Number(sharpe.toFixed(6)) });
  }
  return { rollingCagr, rollingSharpe };
}

function stratMatch(recoType, wanted) {
  const a = String(recoType || "").toUpperCase();
  const b = String(wanted || "").toUpperCase();
  if (b === "BUY") return ["BUY", "LONG"].includes(a);
  if (b === "HOLD") return ["HOLD"].includes(a);
  return a.includes(b);
}

function gradeFromMetrics({ cagr = 0, sharpe = 0, drawdown = -100, consistency = 0, alpha = 0 }) {
  const score = (cagr * 0.25) + (sharpe * 15) + (Math.max(drawdown, -50) * 0.3) + (consistency * 12) + (alpha * 0.2);
  if (score >= 55) return "A+";
  if (score >= 40) return "A";
  if (score >= 25) return "B";
  if (score >= 10) return "C";
  return "D";
}

async function loadRecommendations({ strategy, startDate, endDate, universe }) {
  let q = supabase
    .from("recommendation_audit")
    .select("recommendation_id,symbol,action,recommendation_type,confidence,entry_price,target_price,stop_loss,horizon,sector,market_regime,created_at")
    .gte("created_at", `${dateOnly(startDate)}T00:00:00.000Z`)
    .lte("created_at", `${dateOnly(endDate)}T23:59:59.999Z`)
    .order("created_at", { ascending: true });

  const { data, error } = await q;
  if (error) throw new BacktestingError("Failed to load recommendations", "FETCH_FAILED", { error });
  const rows = data || [];
  if (!rows.length) return [];

  const recommendationIds = rows.map((r) => r.recommendation_id);
  const { data: outcomeRows, error: outcomeError } = await supabase
    .from("recommendation_outcomes")
    .select("recommendation_id,outcome_status")
    .in("recommendation_id", recommendationIds)
    .in("outcome_status", ["OPEN", "TARGET_HIT", "STOP_HIT"]);
  if (outcomeError) {
    throw new BacktestingError("Failed to load recommendation outcomes", "FETCH_FAILED", { error: outcomeError });
  }

  const allowed = new Set((outcomeRows || []).map((row) => row.recommendation_id));
  const filtered = rows.filter((r) => allowed.has(r.recommendation_id));
  return filtered.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
}

function pickExitDate(horizon, createdAt) {
  const d = new Date(createdAt);
  const h = String(horizon || "").toUpperCase();
  if (h.includes("INTRADAY")) d.setDate(d.getDate() + 2);
  else if (h.includes("SWING")) d.setDate(d.getDate() + 30);
  else if (h.includes("POSITIONAL")) d.setDate(d.getDate() + 90);
  else d.setDate(d.getDate() + 30);
  return d;
}

function normalizeCandle(c) {
  const ts = toTs(c?.date || c?.timestamp, "candle.ts");
  const open = toNum(c?.open ?? c?.close, "candle.open");
  const close = toNum(c?.close, "candle.close");
  if (open <= 0 || close <= 0) throw new BacktestingError("Invalid candle price", "INVALID_PRICE");
  return { ts, open, close };
}

export function simulateTradeExecution(recommendation, candles, options = {}) {
  const createdAt = toTs(recommendation.created_at, "created_at");
  const entryBase = toNum(recommendation.entry_price, "entry_price");
  if (entryBase <= 0) throw new BacktestingError("Invalid entry price", "INVALID_ENTRY");

  const slippageBps = Number(options.slippageBps ?? DEFAULT_SLIPPAGE_BPS);
  const txnCostBps = Number(options.transactionCostBps ?? DEFAULT_TXN_COST_BPS);
  const all = (candles || []).map(normalizeCandle).sort((a, b) => a.ts.getTime() - b.ts.getTime());

  const recommendationTs = new Date(recommendation.created_at).getTime();
  const available = all.filter((c) => {
    const candleTs = new Date(c.ts || c.timestamp || c.date || c.datetime).getTime();
    return candleTs >= (recommendationTs - (5 * 24 * 60 * 60 * 1000));
  });
  if (!available.length) {
    throw new BacktestingError("Missing candles after recommendation timestamp", "MISSING_CANDLES");
  }

  const exitDeadline = pickExitDate(recommendation.horizon, createdAt).getTime();
  const eligible = available.filter((c) => c.ts.getTime() <= exitDeadline);
  if (!eligible.length) throw new BacktestingError("No eligible candles for holding horizon", "MISSING_CANDLES");
  const entryTs = createdAt.getTime();
  const validExitCandles = eligible.filter((c) => c.ts.getTime() >= entryTs);
  const exitCandle = validExitCandles[validExitCandles.length - 1];
  if (!exitCandle) {
    throw new BacktestingError("No valid exit candle after entry", "INVALID_EXIT");
  }

  const entry = entryBase * (1 + (slippageBps / 10000));
  const exitRaw = exitCandle.close;
  const exit = exitRaw * (1 - (slippageBps / 10000));
  if (exit <= 0 || entry <= 0) throw new BacktestingError("Impossible fill price", "IMPOSSIBLE_FILL");

  const grossReturnPct = ((exit - entry) / entry) * 100;
  const totalCostPct = ((txnCostBps * 2) / 10000) * 100;
  const netReturnPct = grossReturnPct - totalCostPct;
  const holdingDays = Math.max(1, Math.round((exitCandle.ts.getTime() - createdAt.getTime()) / DAY_MS));

  return {
    recommendation_id: recommendation.recommendation_id,
    symbol: recommendation.symbol,
    action: recommendation.action,
    entry_date: createdAt.toISOString(),
    exit_date: exitCandle.ts.toISOString(),
    entry_price: Number(entry.toFixed(6)),
    exit_price: Number(exit.toFixed(6)),
    return_pct: Number(netReturnPct.toFixed(6)),
    holding_days: holdingDays,
    outcome_status: netReturnPct >= 0 ? "TARGET_HIT" : "STOP_HIT",
    strategy_name: recommendation.recommendation_type,
    market_regime: recommendation.market_regime || null,
    confidence: recommendation.confidence == null ? null : Number(recommendation.confidence)
  };
}

export function buildEquityCurve(trades = [], initialCapital = 100000) {
  const sorted = [...trades].sort((a, b) => new Date(a.exit_date).getTime() - new Date(b.exit_date).getTime());
  let equity = Number(initialCapital);
  let peak = equity;
  const out = [];
  for (const t of sorted) {
    const r = Number(t.return_pct) / 100;
    equity *= (1 + r);
    peak = Math.max(peak, equity);
    const drawdown = ((equity - peak) / peak) * 100;
    out.push({
      timestamp: t.exit_date,
      equity: Number(equity.toFixed(6)),
      drawdown: Number(drawdown.toFixed(6)),
      cumulative_return: Number((((equity - initialCapital) / initialCapital) * 100).toFixed(6))
    });
  }
  return out;
}

export async function computeBenchmarkComparison({ equityCurve, startDate, endDate, benchmark = "NIFTY50" }) {
  const benchmarkData = await getBenchmarkReturns({ startDate, endDate, benchmark });
  const stratR = dailyReturnsFromCurve(equityCurve);
  const benchR = dailyReturnsFromCurve(benchmarkData.curve);
  const cmp = compareAgainstBenchmark(stratR, benchR);
  return {
    benchmark: benchmarkData.benchmark,
    benchmark_curve: benchmarkData.curve,
    benchmark_return: benchmarkData.total_return_pct,
    alpha: computeRelativeAlpha(
      equityCurve[equityCurve.length - 1]?.cumulative_return || 0,
      benchmarkData.total_return_pct
    ),
    beta: cmp.beta,
    excess_return: cmp.excess_return
  };
}

export function computeInstitutionalMetrics({ trades, equityCurve, initialCapital, startDate, endDate, benchmarkReturn = 0, alpha = 0, beta = 0 }) {
  const returns = trades.map((t) => Number(t.return_pct));
  const wins = returns.filter((r) => r > 0);
  const losses = returns.filter((r) => r <= 0);
  const totalTrades = trades.length;
  const winRate = totalTrades ? (wins.length / totalTrades) * 100 : 0;
  const expectancy = totalTrades ? returns.reduce((a, b) => a + b, 0) / totalTrades : 0;
  const grossProfit = wins.reduce((a, b) => a + b, 0);
  const grossLossAbs = Math.abs(losses.reduce((a, b) => a + b, 0));
  const profitFactor = grossLossAbs === 0 ? grossProfit : grossProfit / grossLossAbs;

  const dailyReturns = dailyReturnsFromCurve(equityCurve).map((r) => r / 100);
  const meanDaily = dailyReturns.length ? dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length : 0;
  const volDaily = stddev(dailyReturns);
  const volatility = volDaily * Math.sqrt(252) * 100;
  const sharpe = volDaily === 0 ? 0 : (meanDaily / volDaily) * Math.sqrt(252);
  const downside = dailyReturns.filter((r) => r < 0);
  const downsideVol = stddev(downside.length ? downside : [0]);
  const sortino = downsideVol === 0 ? 0 : (meanDaily / downsideVol) * Math.sqrt(252);

  const start = toTs(startDate, "startDate");
  const end = toTs(endDate, "endDate");
  const years = Math.max((end.getTime() - start.getTime()) / (365.25 * DAY_MS), 1 / 365.25);
  const finalEquity = equityCurve[equityCurve.length - 1]?.equity ?? initialCapital;
  const cagr = ((finalEquity / initialCapital) ** (1 / years) - 1) * 100;
  const maxDrawdown = maxDrawdownFromCurve(equityCurve);
  const calmarRatio = maxDrawdown === 0 ? 0 : cagr / Math.abs(maxDrawdown);
  const avgHolding = totalTrades ? trades.reduce((sum, t) => sum + Number(t.holding_days || 0), 0) / totalTrades : 0;
  const totalReturnPct = ((finalEquity - initialCapital) / initialCapital) * 100;

  return {
    total_trades: totalTrades,
    wins: wins.length,
    losses: losses.length,
    win_rate: winRate,
    expectancy,
    sharpe_ratio: sharpe,
    sortino_ratio: sortino,
    max_drawdown: maxDrawdown,
    cagr,
    benchmark_return: benchmarkReturn,
    alpha,
    beta,
    volatility,
    calmar_ratio: calmarRatio,
    profit_factor: Number.isFinite(profitFactor) ? profitFactor : 0,
    avg_holding_days: avgHolding,
    total_return_pct: totalReturnPct,
    final_equity: finalEquity
  };
}

function normalizeBacktestId(strategy, startDate, endDate, universe) {
  return `bt_${String(strategy).toUpperCase()}_${dateOnly(startDate)}_${dateOnly(endDate)}_${String(universe || "ALL").toUpperCase()}`;
}

export async function runHistoricalReplay({ strategy, startDate, endDate, universe = "ALL", initialCapital = 100000, benchmark = "NIFTY50" }) {
  const startedAt = Date.now();
  logEvent("backtest.started", { strategy, universe, startDate, endDate, initialCapital });

  const backtestId = normalizeBacktestId(strategy, startDate, endDate, universe);
  const recs = await loadRecommendations({ strategy, startDate, endDate, universe });
  if (!recs.length) throw new BacktestingError("No recommendations for replay", "NO_DATA");

  const trades = [];
  for (const reco of recs) {
    const createdAt = toTs(reco.created_at, "created_at");
    const days = Math.max(40, Math.ceil((Date.now() - createdAt.getTime()) / DAY_MS) + 5);
    const candles = await getHistoricalCandles(reco.symbol, { days, interval: "1d" });
    const trade = simulateTradeExecution(reco, candles, {});
    trades.push(trade);
    logEvent("backtest.trade.executed", { backtest_id: backtestId, symbol: trade.symbol, return_pct: trade.return_pct });
  }

  const equityCurve = buildEquityCurve(trades, initialCapital);
  if (!equityCurve.length) throw new BacktestingError("Replay produced empty equity curve", "EMPTY_EQUITY_CURVE");
  const bench = await computeBenchmarkComparison({ equityCurve, startDate, endDate, benchmark });
  logEvent("backtest.benchmark.computed", { backtest_id: backtestId, benchmark: bench.benchmark, alpha: bench.alpha, beta: bench.beta });

  const metrics = computeInstitutionalMetrics({
    trades,
    equityCurve,
    initialCapital,
    startDate,
    endDate,
    benchmarkReturn: bench.benchmark_return,
    alpha: bench.alpha,
    beta: bench.beta
  });

  const consistency = metrics.win_rate / Math.max(Math.abs(metrics.max_drawdown), 1);
  const rolling = buildRollingSeries(equityCurve, 20);
  const institutionalGrade = gradeFromMetrics({
    cagr: metrics.cagr,
    sharpe: metrics.sharpe_ratio,
    drawdown: metrics.max_drawdown,
    consistency,
    alpha: metrics.alpha
  });

  const row = {
    backtest_id: backtestId,
    strategy_name: String(strategy).toUpperCase(),
    universe: String(universe),
    start_date: dateOnly(startDate),
    end_date: dateOnly(endDate),
    ...metrics,
    trade_log: trades,
    equity_curve: equityCurve,
    benchmark_curve: bench.benchmark_curve,
    replay_metadata: {
      versions: {
        replay: REPLAY_VERSION,
        execution: EXECUTION_VERSION,
        metrics: METRICS_VERSION
      },
      institutional_grade: institutionalGrade,
      rolling_cagr: rolling.rollingCagr,
      rolling_sharpe: rolling.rollingSharpe,
      benchmark: bench.benchmark,
      generated_at: new Date().toISOString()
    },
    calculation_version: `${REPLAY_VERSION}|${EXECUTION_VERSION}|${METRICS_VERSION}`,
    initial_capital: initialCapital
  };

  const { error: runErr } = await supabase.from("backtest_runs").upsert([row], { onConflict: "backtest_id" });
  if (runErr) {
    logEvent("backtest.failed", { backtest_id: backtestId, message: runErr.message });
    throw new BacktestingError("Failed to persist backtest run", "PERSIST_FAILED", { runErr });
  }

  const tradeRows = trades.map((t) => ({ backtest_id: backtestId, ...t }));
  const { error: purgeErr } = await supabase.from("backtest_trade_log").delete().eq("backtest_id", backtestId);
  if (purgeErr) throw new BacktestingError("Failed clearing previous trade log", "PERSIST_FAILED", { purgeErr });
  if (tradeRows.length) {
    const { error: tradeErr } = await supabase.from("backtest_trade_log").insert(tradeRows);
    if (tradeErr) throw new BacktestingError("Failed to persist trade log", "PERSIST_FAILED", { tradeErr });
  }

  logEvent("backtest.metrics.generated", {
    backtest_id: backtestId,
    processing_latency_ms: Date.now() - startedAt,
    trades_processed: metrics.total_trades,
    total_return_pct: metrics.total_return_pct,
    sharpe_ratio: metrics.sharpe_ratio,
    max_drawdown: metrics.max_drawdown,
    cagr: metrics.cagr,
    alpha: metrics.alpha
  });

  logEvent("backtest.completed", {
    backtest_id: backtestId,
    processing_latency_ms: Date.now() - startedAt,
    trades_processed: metrics.total_trades,
    total_return_pct: metrics.total_return_pct,
    sharpe_ratio: metrics.sharpe_ratio,
    max_drawdown: metrics.max_drawdown,
    cagr: metrics.cagr,
    alpha: metrics.alpha
  });

  return { backtestId, ...row };
}

export async function rankStrategies({ startDate, endDate, universe = "ALL", initialCapital = 100000 } = {}) {
  const results = [];
  for (const strategy of STRATEGY_SET) {
    try {
      const run = await runHistoricalReplay({ strategy, startDate, endDate, universe, initialCapital });
      const consistency = Number(run.win_rate || 0) / Math.max(Math.abs(Number(run.max_drawdown || 0)), 1);
      results.push({
        strategy_name: strategy,
        cagr: Number(run.cagr || 0),
        sharpe_ratio: Number(run.sharpe_ratio || 0),
        max_drawdown: Number(run.max_drawdown || 0),
        consistency,
        alpha: Number(run.alpha || 0),
        institutional_grade: String(run.replay_metadata?.institutional_grade || "D")
      });
    } catch (_error) {
      // Fail closed per strategy and continue ranking available valid results.
    }
  }

  return results
    .sort((a, b) => (
      (b.cagr - a.cagr)
      || (b.sharpe_ratio - a.sharpe_ratio)
      || (b.alpha - a.alpha)
      || (a.max_drawdown - b.max_drawdown)
    ));
}

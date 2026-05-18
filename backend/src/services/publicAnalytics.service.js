import supabase from "./supabase.service.js";
import { logError, logEvent } from "./telemetry.service.js";

const ANALYTICS_VERSION = "analytics-v1";
const CALIBRATION_VERSION = "calibration-v1";
const STRATEGY_VERSION = "strategy-v1";
const RISK_FREE_RATE_ANNUAL = 0.02;
const TRADING_DAYS = 252;

class AnalyticsError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = "AnalyticsError";
    this.code = code;
    this.details = details;
  }
}

function ensureFinite(v, name) {
  if (!Number.isFinite(v)) throw new AnalyticsError(`Invalid metric ${name}`, "INVALID_MATH", { name, value: v });
  return v;
}

function mean(values) {
  if (!values.length) throw new AnalyticsError("Mean requires non-empty values", "INSUFFICIENT_DATA");
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function median(values) {
  if (!values.length) throw new AnalyticsError("Median requires non-empty values", "INSUFFICIENT_DATA");
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function stddev(values) {
  if (values.length < 2) return 0;
  const mu = mean(values);
  const variance = values.reduce((sum, x) => sum + ((x - mu) ** 2), 0) / (values.length - 1);
  return Math.sqrt(Math.max(0, variance));
}

function calcSharpe(values) {
  if (values.length < 2) return 0;
  const dailyReturns = values.map((v) => Number(v) / 100);
  const sigma = stddev(dailyReturns);
  if (sigma === 0) return 0;
  const dailyRiskFree = RISK_FREE_RATE_ANNUAL / TRADING_DAYS;
  return ((mean(dailyReturns) - dailyRiskFree) / sigma) * Math.sqrt(TRADING_DAYS);
}

function calcProfitFactor(values) {
  const gp = values.filter((x) => x > 0).reduce((a, b) => a + b, 0);
  const gl = Math.abs(values.filter((x) => x < 0).reduce((a, b) => a + b, 0));
  if (gl === 0) return gp || 0;
  return gp / gl;
}

function calcExpectancy(values) {
  const wins = values.filter((v) => v > 0);
  const losses = values.filter((v) => v <= 0);
  if (!wins.length || !losses.length) return 0;
  const pWin = wins.length / values.length;
  const pLoss = losses.length / values.length;
  return (pWin * mean(wins)) - (pLoss * Math.abs(mean(losses)));
}

function pct(part, whole) {
  if (whole === 0) return 0;
  return (part / whole) * 100;
}

function isClosed(status) {
  return ["TARGET_HIT", "STOP_HIT", "EXPIRED", "CLOSED_MANUAL"].includes(String(status || "").toUpperCase());
}

function isWin(row) {
  return String(row.outcome_status || "").toUpperCase() === "TARGET_HIT" || Number(row.realized_return_pct || 0) > 0;
}

function confidenceBand(confidence) {
  const c = Number(confidence || 0);
  if (c <= 40) return "LOW";
  if (c <= 70) return "MEDIUM";
  return "HIGH";
}

function filterWindow(rows, window) {
  if (window === "ALL_TIME") return rows;
  const days = Number(String(window).replace("D", ""));
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return rows.filter((r) => new Date(r.recommendation_created_at).getTime() >= cutoff);
}

async function loadDataset() {
  const { data: outcomes, error } = await supabase
    .from("recommendation_outcomes")
    .select("recommendation_id,symbol,outcome_status,recommendation_created_at,realized_return_pct,unrealized_return_pct,max_drawdown_pct,closed_at,target_hit_at,stop_hit_at");
  if (error) throw new AnalyticsError("Failed to load outcomes", "FETCH_FAILED", { error });
  if (!outcomes?.length) throw new AnalyticsError("No outcomes for analytics", "INSUFFICIENT_DATA");

  const ids = outcomes.map((o) => o.recommendation_id);
  const { data: audits, error: auditError } = await supabase
    .from("recommendation_audit")
    .select("recommendation_id,confidence,recommendation_type,action,sector,market_regime,created_at")
    .in("recommendation_id", ids);
  if (auditError) throw new AnalyticsError("Failed to load audit records", "FETCH_FAILED", { auditError });
  const map = new Map((audits || []).map((a) => [a.recommendation_id, a]));
  return outcomes.map((o) => ({ ...o, audit: map.get(o.recommendation_id) || null }));
}

export function generateConfidenceAnalytics(rows) {
  const closed = rows.filter((r) => isClosed(r.outcome_status));
  const buckets = [
    { label: "0-40", min: 0, max: 40 },
    { label: "41-70", min: 41, max: 70 },
    { label: "71-100", min: 71, max: 100 }
  ];
  return buckets.map((bucket) => {
    const sample = closed.filter((r) => {
      const c = Number(r.audit?.confidence ?? NaN);
      return Number.isFinite(c) && c >= bucket.min && c <= bucket.max;
    });
    const wins = sample.filter(isWin).length;
    const actual = sample.length ? pct(wins, sample.length) : 0;
    const predicted = sample.length ? mean(sample.map((r) => Number(r.audit?.confidence || 0))) : 0;
    return {
      confidence_bucket: bucket.label,
      total_predictions: sample.length,
      actual_win_rate: ensureFinite(actual, "actual_win_rate"),
      avg_return_pct: sample.length ? mean(sample.map((r) => Number(r.realized_return_pct ?? 0))) : 0,
      avg_drawdown_pct: sample.length ? mean(sample.map((r) => Number(r.max_drawdown_pct ?? 0))) : 0,
      calibration_error: sample.length ? Math.abs(predicted - actual) : 0
    };
  });
}

export function generateSectorAnalytics(rows) {
  const closed = rows.filter((r) => isClosed(r.outcome_status));
  const groups = new Map();
  for (const row of closed) {
    const sector = String(row.audit?.sector || "UNKNOWN");
    const g = groups.get(sector) || [];
    g.push(row);
    groups.set(sector, g);
  }
  const out = [];
  for (const [sector, sample] of groups.entries()) {
    const returns = sample.map((r) => Number(r.realized_return_pct ?? 0));
    out.push({
      sector,
      total_trades: sample.length,
      win_rate: pct(sample.filter(isWin).length, sample.length),
      avg_return_pct: mean(returns),
      profit_factor: calcProfitFactor(returns),
      sharpe_ratio: calcSharpe(returns),
      expectancy: calcExpectancy(returns),
      benchmark_return: mean(rows.filter((r) => isClosed(r.outcome_status)).map((r) => Number(r.realized_return_pct ?? 0)))
    });
  }
  return out.sort((a, b) => b.expectancy - a.expectancy);
}

export function generateStrategyLeaderboard(rows) {
  const closed = rows.filter((r) => isClosed(r.outcome_status));
  const groups = new Map();
  for (const row of closed) {
    const name = String(row.audit?.recommendation_type || "UNKNOWN");
    const g = groups.get(name) || [];
    g.push(row);
    groups.set(name, g);
  }
  const out = [];
  for (const [strategy_name, sample] of groups.entries()) {
    const returns = sample.map((r) => Number(r.realized_return_pct ?? 0));
    const wins = sample.filter(isWin).length;
    const losses = sample.length - wins;
    const winRate = pct(wins, sample.length);
    const sharpe = calcSharpe(returns);
    const expectancy = calcExpectancy(returns);
    const maxDrawdown = Math.abs(mean(sample.map((r) => Number(r.max_drawdown_pct ?? 0)))) || 1;
    const consistency = (winRate * (sharpe || 0)) / maxDrawdown;
    out.push({
      strategy_name,
      total_trades: sample.length,
      wins,
      losses,
      win_rate: winRate,
      avg_return_pct: mean(returns),
      expectancy,
      sharpe_ratio: sharpe,
      profit_factor: calcProfitFactor(returns),
      statistical_grade: consistency >= 8 ? "A" : consistency >= 4 ? "B" : consistency >= 2 ? "C" : "D",
      consistency_score: consistency
    });
  }
  return out.sort((a, b) => b.expectancy - a.expectancy);
}

export function generateGlobalAnalytics(rows, window = "ALL_TIME") {
  const scoped = filterWindow(rows, window);
  if (!scoped.length) throw new AnalyticsError("Insufficient data for global analytics", "INSUFFICIENT_DATA");
  const closed = scoped.filter((r) => isClosed(r.outcome_status));
  if (!closed.length) throw new AnalyticsError("No closed outcomes for global analytics", "INSUFFICIENT_DATA");
  const returns = closed.map((r) => Number(r.realized_return_pct ?? 0));
  const calibration = generateConfidenceAnalytics(scoped);
  const sectors = generateSectorAnalytics(scoped);
  const strategies = generateStrategyLeaderboard(scoped);
  const high = calibration.find((b) => b.confidence_bucket === "71-100");
  const med = calibration.find((b) => b.confidence_bucket === "41-70");
  const low = calibration.find((b) => b.confidence_bucket === "0-40");

  const holdDays = closed.map((r) => {
    const endAt = r.closed_at || r.target_hit_at || r.stop_hit_at || new Date().toISOString();
    return (new Date(endAt).getTime() - new Date(r.recommendation_created_at).getTime()) / (1000 * 60 * 60 * 24);
  });

  return {
    snapshot_type: "GLOBAL",
    calculation_window: window,
    total_recommendations: scoped.length,
    closed_recommendations: closed.length,
    win_rate: pct(closed.filter(isWin).length, closed.length),
    avg_return_pct: mean(returns),
    median_return_pct: median(returns),
    sharpe_ratio: calcSharpe(returns),
    expectancy: calcExpectancy(returns),
    profit_factor: calcProfitFactor(returns),
    calibration_drift: mean(calibration.map((c) => Number(c.calibration_error || 0))),
    best_sector: sectors[0]?.sector || null,
    worst_sector: sectors[sectors.length - 1]?.sector || null,
    best_strategy: strategies[0]?.strategy_name || null,
    worst_strategy: strategies[strategies.length - 1]?.strategy_name || null,
    high_confidence_win_rate: high?.actual_win_rate || 0,
    medium_confidence_win_rate: med?.actual_win_rate || 0,
    low_confidence_win_rate: low?.actual_win_rate || 0,
    recommendation_growth: scoped.length,
    average_holding_duration: mean(holdDays),
    analytics_version: ANALYTICS_VERSION,
    generated_by: "publicAnalytics.service"
  };
}

export async function persistAnalyticsSnapshots({ window = "ALL_TIME", snapshotType = "SCHEDULED" } = {}) {
  const startedAt = Date.now();
  const rows = await loadDataset();
  const global = generateGlobalAnalytics(rows, window);
  const sectors = generateSectorAnalytics(filterWindow(rows, window));
  const strategies = generateStrategyLeaderboard(filterWindow(rows, window));
  const calibration = generateConfidenceAnalytics(filterWindow(rows, window));

  const regimeStats = {};
  for (const regime of ["bullish", "bearish", "sideways"]) {
    const sample = rows.filter((r) => String(r.audit?.market_regime || "").toLowerCase() === regime && isClosed(r.outcome_status));
    if (sample.length) regimeStats[regime] = mean(sample.map((r) => Number(r.realized_return_pct ?? 0)));
  }

  const snapshotRow = {
    ...global,
    snapshot_type: snapshotType,
    snapshot_metadata: {
      rolling_30d: generateGlobalAnalytics(rows, "30D"),
      rolling_90d: generateGlobalAnalytics(rows, "90D"),
      confidence_buckets: calibration,
      regime_performance: regimeStats,
      sector_relative_alpha: sectors.map((s) => ({
        sector: s.sector,
        alpha: s.avg_return_pct - s.benchmark_return
      })),
      versions: {
        analytics: ANALYTICS_VERSION,
        calibration: CALIBRATION_VERSION,
        strategy: STRATEGY_VERSION
      }
    }
  };

  const { error: snapshotError } = await supabase.from("analytics_snapshots").insert([snapshotRow]);
  if (snapshotError) throw new AnalyticsError("Failed to persist analytics snapshot", "PERSISTENCE_FAILED", { snapshotError });

  const { error: sectorDeleteError } = await supabase.from("sector_performance").delete().gte("total_trades", 0);
  if (sectorDeleteError) throw new AnalyticsError("Failed to refresh sector_performance", "PERSISTENCE_FAILED", { sectorDeleteError });
  if (sectors.length) {
    const { error: sectorInsertError } = await supabase.from("sector_performance").insert(
      sectors.map((s) => ({
        sector: s.sector,
        total_trades: s.total_trades,
        win_rate: s.win_rate,
        avg_return_pct: s.avg_return_pct,
        profit_factor: s.profit_factor,
        sharpe_ratio: s.sharpe_ratio,
        expectancy: s.expectancy,
        last_updated: new Date().toISOString()
      }))
    );
    if (sectorInsertError) throw new AnalyticsError("Failed to persist sector_performance", "PERSISTENCE_FAILED", { sectorInsertError });
  }

  const { error: stratDeleteError } = await supabase.from("strategy_leaderboard").delete().gte("total_trades", 0);
  if (stratDeleteError) throw new AnalyticsError("Failed to refresh strategy_leaderboard", "PERSISTENCE_FAILED", { stratDeleteError });
  if (strategies.length) {
    const { error: stratInsertError } = await supabase.from("strategy_leaderboard").insert(
      strategies.map((s) => ({
        strategy_name: s.strategy_name,
        total_trades: s.total_trades,
        wins: s.wins,
        losses: s.losses,
        win_rate: s.win_rate,
        avg_return_pct: s.avg_return_pct,
        expectancy: s.expectancy,
        sharpe_ratio: s.sharpe_ratio,
        profit_factor: s.profit_factor,
        statistical_grade: s.statistical_grade,
        last_updated: new Date().toISOString()
      }))
    );
    if (stratInsertError) throw new AnalyticsError("Failed to persist strategy_leaderboard", "PERSISTENCE_FAILED", { stratInsertError });
  }

  logEvent("analytics.snapshot.generated", {
    processing_latency_ms: Date.now() - startedAt,
    total_recommendations: global.total_recommendations,
    sectors_processed: sectors.length,
    strategies_processed: strategies.length,
    calculation_window: window
  });
  logEvent("analytics.sector.updated", {
    processing_latency_ms: Date.now() - startedAt,
    total_recommendations: global.total_recommendations,
    sectors_processed: sectors.length,
    strategies_processed: strategies.length,
    calculation_window: window
  });
  logEvent("analytics.strategy.updated", {
    processing_latency_ms: Date.now() - startedAt,
    total_recommendations: global.total_recommendations,
    sectors_processed: sectors.length,
    strategies_processed: strategies.length,
    calculation_window: window
  });
  logEvent("analytics.calibration.updated", {
    processing_latency_ms: Date.now() - startedAt,
    total_recommendations: global.total_recommendations,
    sectors_processed: sectors.length,
    strategies_processed: strategies.length,
    calculation_window: window
  });

  return {
    global,
    sectors,
    strategies,
    calibration
  };
}

export async function getLatestAnalyticsReport() {
  const { data, error } = await supabase
    .from("analytics_snapshots")
    .select("*")
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new AnalyticsError("Failed to fetch latest analytics report", "FETCH_FAILED", { error });
  if (!data) throw new AnalyticsError("No analytics snapshot available", "INSUFFICIENT_DATA");
  return data;
}

export async function runPublicAnalytics({ window = "ALL_TIME", snapshotType = "SCHEDULED" } = {}) {
  try {
    return await persistAnalyticsSnapshots({ window, snapshotType });
  } catch (error) {
    logEvent("analytics.failure", {
      processing_latency_ms: null,
      total_recommendations: 0,
      sectors_processed: 0,
      strategies_processed: 0,
      calculation_window: window
    });
    logError("analytics.engine.error", error, { window, snapshotType });
    throw error;
  }
}

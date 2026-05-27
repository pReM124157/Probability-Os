import supabase from "./supabase.service.js";
import { logError, logEvent } from "./telemetry.service.js";

const CALC_VERSION = "stats-v1";
const RISK_FREE_RATE_ANNUAL = 0.02;
const TRADING_DAYS = 252;
const MINIMUM_REQUIRED_DATASET_SIZE = 30;
const CONFIDENCE_BUCKETS = [
  { label: "50-59", min: 50, max: 59.9999 },
  { label: "60-69", min: 60, max: 69.9999 },
  { label: "70-79", min: 70, max: 79.9999 },
  { label: "80-89", min: 80, max: 89.9999 },
  { label: "90-100", min: 90, max: 100.0001 }
];

class StatisticalValidationError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = "StatisticalValidationError";
    this.code = code;
    this.details = details;
  }
}

function ensureFinite(value, field) {
  if (!Number.isFinite(value)) {
    throw new StatisticalValidationError(`Invalid ${field}: non-finite`, "INVALID_MATH_STATE", { field, value });
  }
  return value;
}

function mean(values) {
  if (values.length === 0) throw new StatisticalValidationError("Mean requires non-empty array", "DIVIDE_BY_ZERO");
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function median(values) {
  if (values.length === 0) throw new StatisticalValidationError("Median requires non-empty array", "DIVIDE_BY_ZERO");
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function stddev(values) {
  if (values.length < 2) return 0;
  const mu = mean(values);
  const variance = values.reduce((sum, v) => sum + ((v - mu) ** 2), 0) / (values.length - 1);
  if (variance < 0) throw new StatisticalValidationError("Variance cannot be negative", "INVALID_STDDEV");
  return Math.sqrt(variance);
}

function pct(part, whole, field) {
  if (whole === 0) throw new StatisticalValidationError(`Divide by zero in ${field}`, "DIVIDE_BY_ZERO", { field });
  return (part / whole) * 100;
}

function expectancy(returns) {
  const wins = returns.filter((r) => r > 0);
  const losses = returns.filter((r) => r <= 0);
  if (wins.length === 0 || losses.length === 0) {
    return 0;
  }
  const pWin = wins.length / returns.length;
  const pLoss = losses.length / returns.length;
  const avgWin = mean(wins);
  const avgLossAbs = Math.abs(mean(losses));
  return (pWin * avgWin) - (pLoss * avgLossAbs);
}

function profitFactor(returns) {
  const grossProfit = returns.filter((r) => r > 0).reduce((s, r) => s + r, 0);
  const grossLoss = Math.abs(returns.filter((r) => r < 0).reduce((s, r) => s + r, 0));
  if (grossLoss === 0) return grossProfit || 0;
  return grossProfit / grossLoss;
}

function sharpe(returns) {
  if (returns.length < 2) return 0;
  const dailyReturns = returns.map((r) => Number(r) / 100);
  const mu = mean(dailyReturns);
  const sigma = stddev(dailyReturns);
  if (sigma === 0) return 0;
  const dailyRiskFree = RISK_FREE_RATE_ANNUAL / TRADING_DAYS;
  return ((mu - dailyRiskFree) / sigma) * Math.sqrt(TRADING_DAYS);
}

function isClosed(status) {
  return ["TARGET_HIT", "STOP_HIT", "EXPIRED", "CLOSED_MANUAL"].includes(String(status || "").toUpperCase());
}

function isWin(row) {
  const status = String(row.outcome_status || "").toUpperCase();
  const realized = Number(row.realized_return_pct || 0);
  return status === "TARGET_HIT" || realized > 0;
}

function gradeRecommendation(row) {
  const status = String(row.outcome_status || "").toUpperCase();
  const realized = Number(row.realized_return_pct ?? row.unrealized_return_pct ?? 0);
  const maxDrawdown = Number(row.max_drawdown_pct ?? 0);
  if (status === "TARGET_HIT" && realized >= 3 && maxDrawdown >= -3) return "A";
  if (realized > 0 && maxDrawdown >= -6) return "B";
  if (status === "STOP_HIT" || maxDrawdown < -10) return "D";
  return "C";
}

function calcWindowFilter(rows, window) {
  if (window === "ALL_TIME") return rows;
  const days = Number(String(window).replace("D", ""));
  const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
  return rows.filter((r) => new Date(r.recommendation_created_at).getTime() >= cutoff);
}

function isProductionRecommendationRow(row) {
  const audit = row?.recommendation_audit || {};
  const blob = JSON.stringify({
    recommendation_id: row?.recommendation_id,
    symbol: row?.symbol,
    audit_symbol: audit?.symbol,
    generated_by: audit?.generated_by,
    provider_metadata: audit?.provider_metadata
  }).toUpperCase();

  if (blob.includes("TEST")) return false;
  if (blob.includes("TRIAL")) return false;
  if (blob.includes("MANUAL.TEST")) return false;
  if (blob.includes("MANUAL_TEST")) return false;
  if (blob.includes("COPILOT.DELIVERY")) return false;
  if (blob.includes("PRODUCTION.DELIVERY.VERIFICATION")) return false;

  return true;
}

async function fetchJoinedOutcomeRows() {
  const { data: outcomes, error } = await supabase
    .from("recommendation_outcomes")
    .select("recommendation_id,symbol,outcome_status,recommendation_created_at,realized_return_pct,unrealized_return_pct,max_upside_pct,max_drawdown_pct,target_hit_at,stop_hit_at,closed_at,recommendation_quality_grade");
  if (error) throw new StatisticalValidationError("Failed to fetch joined outcomes", "FETCH_FAILED", { error });
  const rows = outcomes || [];
  if (!rows.length) return [];

  const ids = rows.map((r) => r.recommendation_id);
  const { data: audits, error: auditError } = await supabase
    .from("recommendation_audit")
    .select("recommendation_id,symbol,confidence,recommendation_type,action,sector,market_regime,generated_by,provider_metadata,telegram_delivery_status")
    .in("recommendation_id", ids);
  if (auditError) throw new StatisticalValidationError("Failed to fetch recommendation audit rows", "FETCH_FAILED", { auditError });

  const auditMap = new Map((audits || []).map((a) => [a.recommendation_id, a]));
  return rows.map((row) => ({
    ...row,
    recommendation_audit: auditMap.get(row.recommendation_id) || null
  }));
}

function computeGlobalStats(rows, window) {
  const scoped = calcWindowFilter(rows, window);
  const total = scoped.length;
  if (total < 1) throw new StatisticalValidationError("Insufficient recommendations for statistical computation", "INSUFFICIENT_DATA", { window, total });

  const closed = scoped.filter((r) => isClosed(r.outcome_status));
  if (closed.length < 1) throw new StatisticalValidationError("Insufficient closed recommendations", "INSUFFICIENT_DATA", { window, closed: closed.length });

  const returns = closed.map((r) => Number(r.realized_return_pct ?? r.unrealized_return_pct ?? 0));
  returns.forEach((v) => ensureFinite(v, "return_pct"));
  const maxUpsides = closed.map((r) => Number(r.max_upside_pct ?? 0));
  const maxDrawdowns = closed.map((r) => Number(r.max_drawdown_pct ?? 0));
  const holdingDays = closed.map((r) => {
    const endAt = r.closed_at || r.target_hit_at || r.stop_hit_at || new Date().toISOString();
    return (new Date(endAt).getTime() - new Date(r.recommendation_created_at).getTime()) / (1000 * 60 * 60 * 24);
  });

  const wins = closed.filter(isWin).length;
  const targetHits = closed.filter((r) => String(r.outcome_status).toUpperCase() === "TARGET_HIT").length;
  const stopHits = closed.filter((r) => String(r.outcome_status).toUpperCase() === "STOP_HIT").length;

  const result = {
    calculation_window: window,
    total_recommendations: total,
    closed_recommendations: closed.length,
    win_rate: ensureFinite(pct(wins, closed.length, "win_rate"), "win_rate"),
    avg_return_pct: ensureFinite(mean(returns), "avg_return_pct"),
    median_return_pct: ensureFinite(median(returns), "median_return_pct"),
    avg_max_upside_pct: ensureFinite(mean(maxUpsides), "avg_max_upside_pct"),
    avg_max_drawdown_pct: ensureFinite(mean(maxDrawdowns), "avg_max_drawdown_pct"),
    avg_holding_days: ensureFinite(mean(holdingDays), "avg_holding_days"),
    target_hit_rate: ensureFinite(pct(targetHits, closed.length, "target_hit_rate"), "target_hit_rate"),
    stop_hit_rate: ensureFinite(pct(stopHits, closed.length, "stop_hit_rate"), "stop_hit_rate"),
    expectancy: ensureFinite(expectancy(returns), "expectancy"),
    sharpe_ratio: ensureFinite(sharpe(returns), "sharpe_ratio"),
    profit_factor: ensureFinite(profitFactor(returns), "profit_factor"),
    calculation_version: CALC_VERSION,
    source_recommendation_count: total,
    replay_metadata: {
      generated_at: new Date().toISOString(),
      window,
      closed_count: closed.length
    }
  };
  Object.entries(result).forEach(([k, v]) => {
    if (typeof v === "number") ensureFinite(v, k);
    if (typeof v === "number" && v < 0 && ["total_recommendations", "closed_recommendations", "source_recommendation_count"].includes(k)) {
      throw new StatisticalValidationError(`Negative count for ${k}`, "INVALID_COUNT");
    }
  });
  return result;
}

function computeCalibration(rows) {
  const closed = rows.filter((r) => isClosed(r.outcome_status));
  const out = [];
  for (const bucket of CONFIDENCE_BUCKETS) {
    const bucketRows = closed.filter((r) => {
      const c = Number(r.recommendation_audit?.confidence ?? NaN);
      return Number.isFinite(c) && c >= bucket.min && c <= bucket.max;
    });
    if (bucketRows.length === 0) continue;
    const wins = bucketRows.filter(isWin).length;
    const actualWinRate = pct(wins, bucketRows.length, "actual_win_rate");
    const returns = bucketRows.map((r) => Number(r.realized_return_pct ?? 0));
    const avgDrawdown = mean(bucketRows.map((r) => Number(r.max_drawdown_pct ?? 0)));
    const bucketMid = (bucket.min + Math.min(100, bucket.max)) / 2;
    const calibrationError = Math.abs(bucketMid - actualWinRate);

    out.push({
      confidence_bucket: bucket.label,
      total_predictions: bucketRows.length,
      actual_win_rate: ensureFinite(actualWinRate, "actual_win_rate"),
      avg_return_pct: ensureFinite(mean(returns), "avg_return_pct"),
      avg_drawdown_pct: ensureFinite(avgDrawdown, "avg_drawdown_pct"),
      calibration_error: ensureFinite(calibrationError, "calibration_error"),
      calculation_version: CALC_VERSION,
      source_recommendation_count: bucketRows.length,
      replay_metadata: {
        generated_at: new Date().toISOString(),
        bucket: bucket.label
      }
    });
  }
  return out;
}

function computeStrategyPerformance(rows) {
  const closed = rows.filter((r) => isClosed(r.outcome_status));
  const groups = new Map();
  for (const row of closed) {
    const strategy = String(row.recommendation_audit?.recommendation_type || "UNKNOWN");
    const sector = String(row.recommendation_audit?.sector || "UNKNOWN");
    const regime = String(row.recommendation_audit?.market_regime || "UNKNOWN");
    const key = `${strategy}::${sector}::${regime}`;
    const bucket = groups.get(key) || { strategy, sector, regime, rows: [] };
    bucket.rows.push(row);
    groups.set(key, bucket);
  }

  const out = [];
  for (const group of groups.values()) {
    if (group.rows.length < 1) continue;
    const returns = group.rows.map((r) => Number(r.realized_return_pct ?? 0));
    const wins = group.rows.filter(isWin).length;
    const targetHits = group.rows.filter((r) => String(r.outcome_status).toUpperCase() === "TARGET_HIT").length;
    const stopHits = group.rows.filter((r) => String(r.outcome_status).toUpperCase() === "STOP_HIT").length;
    out.push({
      strategy_name: group.strategy,
      sector: group.sector,
      market_regime: group.regime,
      total_recommendations: group.rows.length,
      win_rate: ensureFinite(pct(wins, group.rows.length, "strategy_win_rate"), "strategy_win_rate"),
      avg_return_pct: ensureFinite(mean(returns), "strategy_avg_return"),
      expectancy: ensureFinite(expectancy(returns), "strategy_expectancy"),
      target_hit_rate: ensureFinite(pct(targetHits, group.rows.length, "strategy_target_hit_rate"), "strategy_target_hit_rate"),
      stop_hit_rate: ensureFinite(pct(stopHits, group.rows.length, "strategy_stop_hit_rate"), "strategy_stop_hit_rate"),
      calculation_version: CALC_VERSION,
      source_recommendation_count: group.rows.length,
      replay_metadata: {
        generated_at: new Date().toISOString(),
        strategy: group.strategy
      }
    });
  }
  return out;
}

async function persistGrades(rows) {
  const updates = rows.map((row) => ({
    recommendation_id: row.recommendation_id,
    recommendation_quality_grade: gradeRecommendation(row)
  }));

  for (const item of updates) {
    const { data, error } = await supabase
      .from("recommendation_outcomes")
      .update({
        recommendation_quality_grade: item.recommendation_quality_grade
      })
      .eq("recommendation_id", item.recommendation_id)
      .select();

    if (error) {
      throw new StatisticalValidationError(
        "Failed to update recommendation_outcomes row",
        "PERSISTENCE_FAILED",
        { error }
      );
    }
    if (!data || data.length < 1) {
      throw new StatisticalValidationError(
        "Missing recommendation_outcomes row for grade update",
        "PERSISTENCE_FAILED",
        { recommendation_id: item.recommendation_id }
      );
    }
  }
  logEvent("statistics.grade.generated", { total_recommendations: rows.length });
}

export async function runStatisticalValidation({ calculationWindow = "ALL_TIME" } = {}) {
  const startedAt = Date.now();
  try {
    const rows = (await fetchJoinedOutcomeRows()).filter(isProductionRecommendationRow);
    const scopedRows = calcWindowFilter(rows, calculationWindow);
    if (scopedRows.length < MINIMUM_REQUIRED_DATASET_SIZE) {
      const response = {
        status: "INSUFFICIENT_DATA",
        minimumRequired: MINIMUM_REQUIRED_DATASET_SIZE,
        current: scopedRows.length
      };
      logEvent("statistics.validation.insufficient_data", {
        calculation_window: calculationWindow,
        minimum_required: MINIMUM_REQUIRED_DATASET_SIZE,
        current: scopedRows.length,
        processing_latency_ms: Date.now() - startedAt
      });
      return response;
    }

    await persistGrades(rows);

    const statsPayload = computeGlobalStats(rows, calculationWindow);
    const calibrationPayload = computeCalibration(rows);
    const strategyPayload = computeStrategyPerformance(rows);

    const persistJobs = [
      supabase.from("recommendation_statistics").insert([statsPayload])
    ];

    if (calibrationPayload.length > 0) {
      persistJobs.push(supabase.from("confidence_calibration").insert(calibrationPayload));
    } else {
      logEvent("statistics.calibration.insufficient_data", {
        calculation_window: calculationWindow,
        reason: "NO_CONFIDENCE_BUCKETS_AFTER_FILTERING",
        source_recommendation_count: statsPayload.source_recommendation_count
      });
    }

    if (strategyPayload.length > 0) {
      persistJobs.push(supabase.from("strategy_performance").insert(strategyPayload));
    } else {
      logEvent("statistics.strategy.insufficient_data", {
        calculation_window: calculationWindow,
        reason: "NO_STRATEGY_GROUPS_AFTER_FILTERING",
        source_recommendation_count: statsPayload.source_recommendation_count
      });
    }

    const persistResults = await Promise.all(persistJobs);
    const persistError = persistResults.find((r) => r?.error)?.error;

    if (persistError) {
      throw new StatisticalValidationError("Failed to persist statistical outputs", "PERSISTENCE_FAILED", {
        persistError
      });
    }

    const calibrationDrift = calibrationPayload.length > 0
      ? mean(calibrationPayload.map((r) => Number(r.calibration_error)))
      : null;
    if (calibrationPayload.length > 0) {
      logEvent("statistics.calibration.updated", {
        total_recommendations: statsPayload.total_recommendations,
        calculation_window: calculationWindow,
        win_rate: statsPayload.win_rate,
        expectancy: statsPayload.expectancy,
        sharpe_ratio: statsPayload.sharpe_ratio,
        calibration_drift: calibrationDrift,
        calibration_buckets: calibrationPayload.length,
        processing_latency_ms: Date.now() - startedAt
      });
    }

    if (strategyPayload.length > 0) {
      logEvent("statistics.strategy.updated", {
        total_recommendations: statsPayload.total_recommendations,
        calculation_window: calculationWindow,
        win_rate: statsPayload.win_rate,
        expectancy: statsPayload.expectancy,
        sharpe_ratio: statsPayload.sharpe_ratio,
        calibration_drift: calibrationDrift,
        strategy_groups: strategyPayload.length,
        processing_latency_ms: Date.now() - startedAt
      });
    }
    logEvent("statistics.validation.completed", {
      total_recommendations: statsPayload.total_recommendations,
      calculation_window: calculationWindow,
      win_rate: statsPayload.win_rate,
      expectancy: statsPayload.expectancy,
      sharpe_ratio: statsPayload.sharpe_ratio,
      calibration_drift: calibrationDrift,
      processing_latency_ms: Date.now() - startedAt
    });

    return {
      stats: statsPayload,
      calibration: calibrationPayload.length,
      strategies: strategyPayload.length
    };
  } catch (error) {
    logEvent("statistics.validation.failed", {
      total_recommendations: 0,
      calculation_window: calculationWindow,
      win_rate: null,
      expectancy: null,
      sharpe_ratio: null,
      calibration_drift: null,
      processing_latency_ms: Date.now() - startedAt
    });
    logError("statistics.validation.error", error, { calculationWindow });
    throw error;
  }
}

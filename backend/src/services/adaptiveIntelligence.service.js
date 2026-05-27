import supabase from "./supabase.service.js";
import { logError, logEvent } from "./telemetry.service.js";
import { detectModelDrift as detectModelDriftRaw } from "./driftDetection.service.js";
import { buildMetaScore } from "./metaScoring.service.js";

const ADAPTIVE_VERSION = "adaptive-v1";
const DAY_MS = 24 * 60 * 60 * 1000;
const SAFE_MIN_WEIGHT = 0.5;
const SAFE_MAX_WEIGHT = 1.5;
const TRADING_DAYS = 252;
const RISK_FREE_RATE_ANNUAL = 0.02;

class AdaptiveError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = "AdaptiveError";
    this.code = code;
    this.details = details;
  }
}

function clamp(v, lo, hi) {
  if (!Number.isFinite(v)) return lo;
  return Math.min(hi, Math.max(lo, v));
}

function mean(values = []) {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stddev(values = []) {
  if (values.length < 2) return 0;
  const mu = mean(values);
  const variance = values.reduce((sum, v) => sum + ((v - mu) ** 2), 0) / (values.length - 1);
  return Math.sqrt(Math.max(variance, 0));
}

function classifyRegime(raw) {
  const v = String(raw || "").toUpperCase();
  if (["BULL", "BEAR", "SIDEWAYS", "HIGH_VOLATILITY", "LOW_LIQUIDITY"].includes(v)) return v;
  if (v.includes("BULL")) return "BULL";
  if (v.includes("BEAR")) return "BEAR";
  if (v.includes("VOL")) return "HIGH_VOLATILITY";
  if (v.includes("LIQ")) return "LOW_LIQUIDITY";
  return "SIDEWAYS";
}

function safeRealizedReturn(row) {
  const realized = Number(row.realized_return_pct);
  const unrealized = Number(row.unrealized_return_pct);
  if (Number.isFinite(realized)) return realized;
  if (Number.isFinite(unrealized)) return unrealized;
  return 0;
}

function isClosedOutcomeStatus(status) {
  return ["TARGET_HIT", "STOP_HIT", "EXPIRED", "TRADE_CLOSED", "CLOSED_MANUAL"].includes(
    String(status || "").toUpperCase()
  );
}

function isProductionAdaptiveRow(row) {
  const audit = row?.audit || {};
  const blob = JSON.stringify({
    recommendation_id: row?.recommendation_id,
    outcome_status: row?.outcome_status,
    generated_by: audit?.generated_by,
    provider_metadata: audit?.provider_metadata,
    symbol: audit?.symbol
  }).toUpperCase();

  if (blob.includes("TEST")) return false;
  if (blob.includes("TRIAL")) return false;
  if (blob.includes("MANUAL.TEST")) return false;
  if (blob.includes("MANUAL_TEST")) return false;
  if (blob.includes("COPILOT.DELIVERY")) return false;
  if (blob.includes("PRODUCTION.DELIVERY.VERIFICATION")) return false;

  return true;
}

function computeReplayConsistency(rows = []) {
  if (!rows.length) return 0;
  const outcomes = rows.map((r) => (safeRealizedReturn(r) >= 0 ? 1 : 0));
  const score = outcomes.reduce((a, b) => a + b, 0) / outcomes.length;
  return clamp(score * 100, 0, 100);
}

export function computeAdaptiveWeights({ trustScore = 50, driftScore = 0, rollingWinRate = 0, rollingSharpe = 0 }) {
  const base = 1 + ((Number(trustScore) - 50) / 200) + (Number(rollingWinRate) - 50) / 500 + (Number(rollingSharpe) / 20) - (Number(driftScore) / 200);
  return clamp(base, SAFE_MIN_WEIGHT, SAFE_MAX_WEIGHT);
}

export function computeTrustScore({ rollingWinRate = 0, expectancy = 0, sharpe = 0, calibrationAccuracy = 0, replayConsistency = 0, drawdownStability = 0 }) {
  const winComponent = clamp(rollingWinRate, 0, 100) * 0.28;
  const expectancyComponent = clamp((expectancy + 10) * 5, 0, 100) * 0.14;
  const sharpeComponent = clamp((sharpe + 2) * 20, 0, 100) * 0.16;
  const calibrationComponent = clamp(calibrationAccuracy, 0, 100) * 0.2;
  const replayComponent = clamp(replayConsistency, 0, 100) * 0.14;
  const stabilityComponent = clamp(drawdownStability, 0, 100) * 0.08;
  return clamp(winComponent + expectancyComponent + sharpeComponent + calibrationComponent + replayComponent + stabilityComponent, 0, 100);
}

export function detectModelDrift(metrics = {}) {
  const result = detectModelDriftRaw(metrics);
  return result;
}

function betaPosterior({ wins, losses, priorAlpha = 2, priorBeta = 2, decay = 1 }) {
  const safeDecay = clamp(Number(decay || 1), 0.7, 1);
  const decayedWins = Number(wins || 0) * safeDecay;
  const decayedLosses = Number(losses || 0) * safeDecay;
  const alpha = priorAlpha + decayedWins;
  const beta = priorBeta + decayedLosses;
  return { alpha, beta, posteriorMean: alpha / (alpha + beta) };
}

export function computeAdaptiveConfidence({ rawConfidence = 50, sectorHistory = {}, strategyHistory = {}, recentOutcomes = [], marketRegime = "SIDEWAYS" }) {
  const safeRaw = clamp(Number(rawConfidence), 0, 100);
  const wins = recentOutcomes.filter((r) => Number(r) > 0).length;
  const losses = Math.max(0, recentOutcomes.length - wins);
  const posterior = betaPosterior({ wins, losses, decay: 0.96 });

  const posteriorConfidence = posterior.posteriorMean * 100;
  const sectorAdj = clamp(Number(sectorHistory.weight || 1), SAFE_MIN_WEIGHT, SAFE_MAX_WEIGHT);
  const strategyAdj = clamp(Number(strategyHistory.weight || 1), SAFE_MIN_WEIGHT, SAFE_MAX_WEIGHT);
  const regimeAdjMap = {
    BULL: 1.03,
    BEAR: 0.97,
    SIDEWAYS: 1,
    HIGH_VOLATILITY: 0.94,
    LOW_LIQUIDITY: 0.92
  };
  const regimeAdj = regimeAdjMap[classifyRegime(marketRegime)] || 1;

  const calibrated = (safeRaw * 0.5) + (posteriorConfidence * 0.5);
  const adjusted = clamp(calibrated * sectorAdj * strategyAdj * regimeAdj, 0, 100);
  const delta = adjusted - safeRaw;
  return {
    adjusted_confidence: adjusted,
    confidence_delta: delta,
    adaptive_score_breakdown: {
      posterior_confidence: posteriorConfidence,
      sector_adjustment: sectorAdj,
      strategy_adjustment: strategyAdj,
      regime_adjustment: regimeAdj,
      regime: classifyRegime(marketRegime)
    }
  };
}

async function fetchAdaptiveRows(windowDays = 365) {
  const cutoff = new Date(Date.now() - (windowDays * DAY_MS)).toISOString();
  const { data: outcomes, error } = await supabase
    .from("recommendation_outcomes")
    .select("recommendation_id,outcome_status,recommendation_created_at,realized_return_pct,unrealized_return_pct,max_drawdown_pct")
    .gte("recommendation_created_at", cutoff);
  if (error) throw new AdaptiveError("Failed loading outcomes", "FETCH_FAILED", { error });

  const ids = (outcomes || []).map((r) => r.recommendation_id);
  const { data: audits, error: auditError } = await supabase
    .from("recommendation_audit")
    .select("recommendation_id,symbol,action,confidence,recommendation_type,sector,market_regime,generated_by,provider_metadata")
    .in("recommendation_id", ids.length ? ids : ["__none__"]);
  if (auditError) throw new AdaptiveError("Failed loading recommendation audits", "FETCH_FAILED", { auditError });

  const auditMap = new Map((audits || []).map((a) => [a.recommendation_id, a]));
  return (outcomes || [])
    .map((o) => ({ ...o, audit: auditMap.get(o.recommendation_id) || null }))
    .filter((row) => row.audit)
    .filter(isProductionAdaptiveRow)
    .filter((row) => isClosedOutcomeStatus(row.outcome_status))
    .filter((row) => {
      const action = String(row.audit?.action || "").toUpperCase();
      return action === "BUY" || action === "SELL";
    });
}

function groupByModel(rows = []) {
  const groups = new Map();
  for (const row of rows) {
    const strategy = String(row.audit?.recommendation_type || "UNKNOWN").toUpperCase();
    const sector = String(row.audit?.sector || "UNKNOWN").toUpperCase();
    const regime = classifyRegime(row.audit?.market_regime);
    const modelKey = `${strategy}::${sector}::${regime}`;
    if (!groups.has(modelKey)) groups.set(modelKey, { modelKey, strategy, sector, regime, rows: [] });
    groups.get(modelKey).rows.push(row);
  }
  return Array.from(groups.values());
}

async function loadPreviousModelState(keys = []) {
  const { data, error } = await supabase
    .from("adaptive_model_state")
    .select("model_key,trust_score,drift_score,calibration_error,replay_consistency")
    .in("model_key", keys.length ? keys : ["__none__"]);
  if (error) throw new AdaptiveError("Failed loading model state", "FETCH_FAILED", { error });
  return new Map((data || []).map((row) => [row.model_key, row]));
}

function computeCalibrationError(rows = []) {
  const pairs = rows
    .map((row) => {
      const conf = Number(row.audit?.confidence);
      if (!Number.isFinite(conf)) return null;
      const hit = safeRealizedReturn(row) > 0 ? 100 : 0;
      return { conf, hit };
    })
    .filter(Boolean);
  if (!pairs.length) return 0;
  return mean(pairs.map((p) => Math.abs(p.conf - p.hit)));
}

function computeModelRollups(group) {
  const returns = group.rows.map(safeRealizedReturn);
  const wins = returns.filter((r) => r > 0).length;
  const losses = Math.max(0, returns.length - wins);
  const rollingWinRate = returns.length ? (wins / returns.length) * 100 : 0;
  const rollingExpectancy = mean(returns);
  const dailyReturns = returns.map((r) => Number(r) / 100);
  const sigmaDaily = stddev(dailyReturns);
  const dailyRiskFree = RISK_FREE_RATE_ANNUAL / TRADING_DAYS;
  const rollingSharpe = sigmaDaily === 0 ? 0 : ((mean(dailyReturns) - dailyRiskFree) / sigmaDaily) * Math.sqrt(TRADING_DAYS);
  const rollingAlpha = mean(returns);
  const rollingDrawdown = mean(group.rows.map((r) => Number(r.max_drawdown_pct || 0)));
  const calibrationError = computeCalibrationError(group.rows);
  const calibrationAccuracy = clamp(100 - calibrationError, 0, 100);
  const replayConsistency = computeReplayConsistency(group.rows);
  const drawdownStability = clamp(100 - Math.abs(rollingDrawdown) * 5, 0, 100);
  const trustScore = computeTrustScore({
    rollingWinRate,
    expectancy: rollingExpectancy,
    sharpe: rollingSharpe,
    calibrationAccuracy,
    replayConsistency,
    drawdownStability
  });

  return {
    wins,
    losses,
    sampleSize: group.rows.length,
    rollingWinRate,
    rollingExpectancy,
    rollingSharpe,
    rollingAlpha,
    rollingDrawdown,
    calibrationError,
    calibrationAccuracy,
    replayConsistency,
    trustScore,
    confidenceStd: stddev(group.rows.map((r) => Number(r.audit?.confidence || 50)))
  };
}

async function persistAdaptiveScores(rows = [], stateByModel = new Map()) {
  if (!rows.length) return 0;
  const payload = [];
  for (const row of rows) {
    const strategy = String(row.audit?.recommendation_type || "UNKNOWN").toUpperCase();
    const sector = String(row.audit?.sector || "UNKNOWN").toUpperCase();
    const regime = classifyRegime(row.audit?.market_regime);
    const modelKey = `${strategy}::${sector}::${regime}`;
    const modelState = stateByModel.get(modelKey);
    if (!modelState) continue;

    const adaptive = computeAdaptiveConfidence({
      rawConfidence: row.audit?.confidence,
      sectorHistory: { weight: modelState.adaptive_weight },
      strategyHistory: { weight: modelState.confidence_multiplier },
      recentOutcomes: [safeRealizedReturn(row)],
      marketRegime: regime
    });

    payload.push({
      recommendation_id: row.recommendation_id,
      original_confidence: Number(row.audit?.confidence || 50),
      adjusted_confidence: adaptive.adjusted_confidence,
      confidence_delta: adaptive.confidence_delta,
      adaptive_weight: modelState.adaptive_weight,
      trust_score: modelState.trust_score,
      drift_penalty: modelState.penalty_score,
      calibration_adjustment: -Math.abs(modelState.calibration_error || 0),
      sector_adjustment: adaptive.adaptive_score_breakdown.sector_adjustment,
      strategy_adjustment: adaptive.adaptive_score_breakdown.strategy_adjustment,
      regime_adjustment: adaptive.adaptive_score_breakdown.regime_adjustment,
      final_score: adaptive.adjusted_confidence,
      scoring_version: ADAPTIVE_VERSION,
      metadata: {
        model_key: modelKey,
        breakdown: adaptive.adaptive_score_breakdown
      }
    });
  }

  if (!payload.length) return 0;
  const { error } = await supabase.from("adaptive_recommendation_scores").insert(payload);
  if (error) throw new AdaptiveError("Failed persisting adaptive recommendation scores", "PERSIST_FAILED", { error });
  return payload.length;
}

export async function runAdaptiveRecalibration({ windowDays = 365 } = {}) {
  const startedAt = Date.now();
  logEvent("adaptive.recalibration.started", { window_days: windowDays });

  try {
    const rows = await fetchAdaptiveRows(windowDays);
    const groups = groupByModel(rows);
    const previousMap = await loadPreviousModelState(groups.map((g) => g.modelKey));

    const states = [];
    const driftRows = [];

    for (const group of groups) {
      const roll = computeModelRollups(group);
      const prev = previousMap.get(group.modelKey) || {};
      const winRateDrop = Number(prev.rolling_win_rate || roll.rollingWinRate) - roll.rollingWinRate;
      const alphaDecay = roll.rollingAlpha - Number(prev.rolling_alpha || roll.rollingAlpha);
      const drift = detectModelDrift({
        win_rate_drop: winRateDrop,
        calibration_error: roll.calibrationError,
        volatility: Math.abs(roll.rollingSharpe) > 0 ? stddev(group.rows.map(safeRealizedReturn)) / Math.abs(roll.rollingSharpe) : 0,
        alpha_decay: alphaDecay,
        confidence_std: roll.confidenceStd
      });

      const driftScore = { LOW: 10, MEDIUM: 35, HIGH: 65, CRITICAL: 90 }[drift.severity] || 10;
      const adaptiveWeight = computeAdaptiveWeights({
        trustScore: roll.trustScore,
        driftScore,
        rollingWinRate: roll.rollingWinRate,
        rollingSharpe: roll.rollingSharpe
      });
      const rewardScore = clamp((roll.rollingWinRate - 50) + (roll.rollingSharpe * 8), 0, 100);
      const penaltyScore = clamp((Math.abs(Math.min(roll.rollingDrawdown, 0)) * 3) + (driftScore * 0.3), 0, 100);
      const confidenceMultiplier = clamp(1 + ((roll.trustScore - 50) / 200) - (driftScore / 300), SAFE_MIN_WEIGHT, SAFE_MAX_WEIGHT);
      const stabilityScore = clamp(100 - (Math.abs(roll.rollingDrawdown) * 4), 0, 100);
      const meta = buildMetaScore({
        trustScore: roll.trustScore,
        driftScore,
        calibrationError: roll.calibrationError,
        replayConsistency: roll.replayConsistency,
        adaptiveWeight
      });

      states.push({
        model_key: group.modelKey,
        model_type: "RECOMMENDATION_MODEL",
        sector: group.sector,
        strategy_name: group.strategy,
        regime: group.regime,
        confidence_multiplier: confidenceMultiplier,
        trust_score: roll.trustScore,
        drift_score: driftScore,
        stability_score: stabilityScore,
        calibration_error: roll.calibrationError,
        rolling_win_rate: roll.rollingWinRate,
        rolling_expectancy: roll.rollingExpectancy,
        rolling_sharpe: roll.rollingSharpe,
        rolling_alpha: roll.rollingAlpha,
        rolling_drawdown: roll.rollingDrawdown,
        sample_size: roll.sampleSize,
        decay_factor: 0.96,
        adaptive_weight: adaptiveWeight,
        reward_score: rewardScore,
        penalty_score: penaltyScore,
        replay_consistency: roll.replayConsistency,
        institutional_grade: meta.institutional_trust_grade,
        last_retrained_at: new Date().toISOString(),
        metadata: {
          version: ADAPTIVE_VERSION,
          signals: drift.signals,
          events: drift.events,
          meta
        },
        version: ADAPTIVE_VERSION,
        updated_at: new Date().toISOString()
      });

      if (drift.severity !== "LOW") {
        for (const eventType of drift.events) {
          driftRows.push({
            model_key: group.modelKey,
            drift_type: eventType,
            previous_score: Number(prev.drift_score || 0),
            current_score: driftScore,
            severity: drift.severity,
            triggered_by: "runAdaptiveRecalibration",
            detection_window: `${windowDays}D`,
            metadata: {
              signals: drift.signals,
              win_rate_drop: winRateDrop,
              alpha_decay: alphaDecay
            }
          });
        }
      }
    }

    if (states.length) {
      const { error } = await supabase.from("adaptive_model_state").upsert(states, { onConflict: "model_key" });
      if (error) throw new AdaptiveError("Failed persisting adaptive model state", "PERSIST_FAILED", { error });
      logEvent("adaptive.model.updated", { models_processed: states.length });
    }

    if (driftRows.length) {
      const { error } = await supabase.from("model_drift_events").insert(driftRows);
      if (error) throw new AdaptiveError("Failed persisting drift events", "PERSIST_FAILED", { error });
      logEvent("adaptive.drift.detected", { drift_events: driftRows.length });
    }

    const stateMap = new Map(states.map((s) => [s.model_key, s]));
    const scoredCount = await persistAdaptiveScores(rows, stateMap);
    if (scoredCount) logEvent("adaptive.confidence.adjusted", { recommendations_scored: scoredCount });

    const avgDelta = states.length ? mean(states.map((s) => Number(s.confidence_multiplier || 1) - 1)) * 100 : 0;
    const avgTrust = states.length ? mean(states.map((s) => Number(s.trust_score || 0))) : 0;
    const avgCalibrationError = states.length ? mean(states.map((s) => Math.abs(Number(s.calibration_error || 0)))) : 0;

    logEvent("adaptive.weights.updated", {
      processing_latency_ms: Date.now() - startedAt,
      models_processed: states.length,
      drift_events: driftRows.length,
      avg_confidence_delta: avgDelta,
      avg_trust_score: avgTrust,
      avg_calibration_error: avgCalibrationError
    });

    logEvent("adaptive.recalibration.completed", {
      processing_latency_ms: Date.now() - startedAt,
      models_processed: states.length,
      drift_events: driftRows.length,
      avg_confidence_delta: avgDelta,
      avg_trust_score: avgTrust,
      avg_calibration_error: avgCalibrationError
    });

    return {
      models_processed: states.length,
      drift_events: driftRows.length,
      recommendations_scored: scoredCount,
      avg_confidence_delta: avgDelta,
      avg_trust_score: avgTrust,
      avg_calibration_error: avgCalibrationError
    };
  } catch (error) {
    logError("adaptive.failure", error, { processing_latency_ms: Date.now() - startedAt });
    throw error;
  }
}

export async function getAdaptiveModelState({ limit = 200 } = {}) {
  const { data, error } = await supabase
    .from("adaptive_model_state")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(Math.max(1, Math.min(500, Number(limit || 200))));
  if (error) throw new AdaptiveError("Failed loading adaptive model state", "FETCH_FAILED", { error });
  return data || [];
}

export async function getAdaptiveDriftEvents({ limit = 200 } = {}) {
  const { data, error } = await supabase
    .from("model_drift_events")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(Math.max(1, Math.min(500, Number(limit || 200))));
  if (error) throw new AdaptiveError("Failed loading drift events", "FETCH_FAILED", { error });
  return data || [];
}

export async function getAdaptiveRecommendationScore(recommendationId) {
  const { data, error } = await supabase
    .from("adaptive_recommendation_scores")
    .select("*")
    .eq("recommendation_id", recommendationId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new AdaptiveError("Failed loading adaptive recommendation score", "FETCH_FAILED", { error });
  return data;
}

export async function getAdaptiveTrustSummary() {
  const rows = await getAdaptiveModelState({ limit: 500 });
  if (!rows.length) {
    return {
      avg_trust_score: 50,
      avg_drift_score: 0,
      avg_calibration_error: 0,
      system_reliability_score: 50,
      institutional_trust_grade: "C"
    };
  }
  const avgTrust = mean(rows.map((r) => Number(r.trust_score || 0)));
  const avgDrift = mean(rows.map((r) => Number(r.drift_score || 0)));
  const avgCal = mean(rows.map((r) => Number(r.calibration_error || 0)));
  const avgReplay = mean(rows.map((r) => Number(r.replay_consistency || 0)));
  return {
    ...buildMetaScore({ trustScore: avgTrust, driftScore: avgDrift, calibrationError: avgCal, replayConsistency: avgReplay }),
    avg_trust_score: avgTrust,
    avg_drift_score: avgDrift,
    avg_calibration_error: avgCal
  };
}

export async function getAdaptiveRegimeIntelligence() {
  const rows = await getAdaptiveModelState({ limit: 500 });
  const groups = new Map();
  for (const row of rows) {
    const regime = classifyRegime(row.regime);
    const g = groups.get(regime) || { regime, models: 0, avg_trust_score: 0, avg_weight: 0, avg_win_rate: 0 };
    g.models += 1;
    g.avg_trust_score += Number(row.trust_score || 0);
    g.avg_weight += Number(row.adaptive_weight || 1);
    g.avg_win_rate += Number(row.rolling_win_rate || 0);
    groups.set(regime, g);
  }
  return Array.from(groups.values()).map((g) => ({
    regime: g.regime,
    models: g.models,
    avg_trust_score: g.models ? g.avg_trust_score / g.models : 0,
    avg_weight: g.models ? g.avg_weight / g.models : 1,
    avg_win_rate: g.models ? g.avg_win_rate / g.models : 0
  }));
}

export async function getAdaptiveLeaderboard() {
  const rows = await getAdaptiveModelState({ limit: 500 });
  return rows
    .map((r) => ({
      model_key: r.model_key,
      strategy_name: r.strategy_name,
      sector: r.sector,
      regime: r.regime,
      trust_score: Number(r.trust_score || 0),
      adaptive_weight: Number(r.adaptive_weight || 1),
      rolling_win_rate: Number(r.rolling_win_rate || 0),
      rolling_alpha: Number(r.rolling_alpha || 0),
      institutional_grade: r.institutional_grade || "C"
    }))
    .sort((a, b) => (b.trust_score - a.trust_score) || (b.adaptive_weight - a.adaptive_weight))
    .slice(0, 100);
}

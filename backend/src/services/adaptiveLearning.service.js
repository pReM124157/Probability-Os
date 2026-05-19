import supabase from "./supabase.service.js";

function clamp(value, min = 0, max = 1) {
  return Math.min(Math.max(Number(value) || 0, min), max);
}

export async function storeDecisionOutcome(outcome = {}) {
  const row = {
    strategy_type: outcome.strategyType || "DEFENSIVE_EXIT",
    regime: outcome.regime || "UNKNOWN",
    confidence_score: Number(outcome.confidenceScore || 0),
    historical_accuracy: Number(outcome.predictionAccuracy || 0),
    recalibrated_weight: Number(outcome.recalibratedWeight || 0),
    prediction_accuracy: Number(outcome.predictionAccuracy || 0),
    exit_quality: Number(outcome.exitQuality || 0),
    unrealized_profit_captured: Number(outcome.unrealizedProfitCaptured || 0),
    downside_avoided: Number(outcome.downsideAvoided || 0),
    trend_state: outcome.trendState || "UNKNOWN",
    sector: outcome.sector || "UNKNOWN",
    volatility_regime: outcome.volatilityRegime || "UNKNOWN"
  };

  const { error } = await supabase.from("adaptive_learning_memory").insert(row);
  if (error) console.warn("[ADAPTIVE] storeDecisionOutcome failed:", error.message);
  return row;
}

export async function loadHistoricalDecisionOutcomes({ strategyType = "DEFENSIVE_EXIT", limit = 400 } = {}) {
  const { data, error } = await supabase
    .from("adaptive_learning_memory")
    .select("*")
    .eq("strategy_type", strategyType)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.warn("[ADAPTIVE] loadHistoricalDecisionOutcomes failed:", error.message);
    return [];
  }
  return data || [];
}

export function trackActualPortfolioPerformance(outcomes = []) {
  if (!outcomes.length) return { avgDownsideAvoided: 0, avgCapture: 0 };
  const avgDownsideAvoided = outcomes.reduce((a, r) => a + Number(r.downside_avoided || 0), 0) / outcomes.length;
  const avgCapture = outcomes.reduce((a, r) => a + Number(r.unrealized_profit_captured || 0), 0) / outcomes.length;
  return {
    avgDownsideAvoided: Number(avgDownsideAvoided.toFixed(4)),
    avgCapture: Number(avgCapture.toFixed(4))
  };
}

export function trackActualExitPerformance(outcomes = []) {
  if (!outcomes.length) return { exitQuality: 0, winRate: 0 };
  const exitQuality = outcomes.reduce((a, r) => a + Number(r.exit_quality || 0), 0) / outcomes.length;
  const winRate = outcomes.filter((r) => Number(r.exit_quality || 0) >= 0.6).length / outcomes.length;
  return { exitQuality: Number(exitQuality.toFixed(4)), winRate: Number(winRate.toFixed(4)) };
}

export function recalculateHistoricalAccuracy(outcomes = []) {
  if (!outcomes.length) return 0.5;
  const avg = outcomes.reduce((a, r) => a + Number(r.prediction_accuracy || r.historical_accuracy || 0), 0) / outcomes.length;
  return Number(clamp(avg, 0, 1).toFixed(4));
}

export function adaptByMarketRegime(outcomes = [], regime = "UNKNOWN") {
  const rows = outcomes.filter((o) => (o.regime || "UNKNOWN") === regime);
  const accuracy = recalculateHistoricalAccuracy(rows);
  return { regime, accuracy, penalty: Number(clamp(0.55 - accuracy, 0, 0.35).toFixed(4)) };
}

export function adaptByVolatilityRegime(outcomes = [], volatilityRegime = "UNKNOWN") {
  const rows = outcomes.filter((o) => (o.volatility_regime || "UNKNOWN") === volatilityRegime);
  const accuracy = recalculateHistoricalAccuracy(rows);
  return { volatilityRegime, accuracy, penalty: Number(clamp(0.55 - accuracy, 0, 0.35).toFixed(4)) };
}

export function reweightStrategiesAutomatically({ baseWeight = 1, accuracy = 0.6, exitQuality = 0.6 } = {}) {
  return Number(clamp(baseWeight * (0.5 + accuracy * 0.3 + exitQuality * 0.2), 0.2, 1.4).toFixed(4));
}

export function adaptConfidenceScaling({ baseConfidence = 0.75, accuracy = 0.6, regimePenalty = 0, volPenalty = 0 } = {}) {
  return Number(clamp(baseConfidence * (0.5 + accuracy * 0.5) * (1 - regimePenalty) * (1 - volPenalty), 0.1, 0.95).toFixed(4));
}

export async function recalibrateStrategyState({ strategyType = "DEFENSIVE_EXIT", regime = "UNKNOWN", volatilityRegime = "UNKNOWN", baseConfidence = 0.75 } = {}) {
  const outcomes = await loadHistoricalDecisionOutcomes({ strategyType });
  const accuracy = recalculateHistoricalAccuracy(outcomes);
  const perf = trackActualPortfolioPerformance(outcomes);
  const exitPerf = trackActualExitPerformance(outcomes);
  const regimeAdapt = adaptByMarketRegime(outcomes, regime);
  const volAdapt = adaptByVolatilityRegime(outcomes, volatilityRegime);

  return {
    reliability: accuracy,
    strategyWeight: reweightStrategiesAutomatically({
      baseWeight: 1,
      accuracy,
      exitQuality: exitPerf.exitQuality
    }),
    confidence: adaptConfidenceScaling({
      baseConfidence,
      accuracy,
      regimePenalty: regimeAdapt.penalty,
      volPenalty: volAdapt.penalty
    }),
    portfolioPerformance: perf,
    exitPerformance: exitPerf,
    regimeAdaptation: regimeAdapt,
    volatilityAdaptation: volAdapt
  };
}

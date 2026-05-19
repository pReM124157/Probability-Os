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

export function trackDecisionAccuracy(records = []) {
  if (!records.length) return 0;
  const avg = records.reduce((acc, r) => acc + Number(r.prediction_accuracy || r.historical_accuracy || 0), 0) / records.length;
  return Number(clamp(avg, 0, 1).toFixed(4));
}

export function trackProfitCaptureEfficiency(records = []) {
  if (!records.length) return 0;
  const avg = records.reduce((acc, r) => acc + Number(r.unrealized_profit_captured || 0), 0) / records.length;
  return Number(clamp(avg, 0, 1).toFixed(4));
}

export function calculateHistoricalReliability(records = []) {
  const accuracy = trackDecisionAccuracy(records);
  const capture = trackProfitCaptureEfficiency(records);
  const downside = records.length
    ? records.reduce((acc, r) => acc + Number(r.downside_avoided || 0), 0) / records.length
    : 0;
  return Number(clamp(accuracy * 0.45 + capture * 0.3 + clamp(downside, 0, 1) * 0.25, 0, 1).toFixed(4));
}

export function detectStrategyDecay(records = []) {
  if (records.length < 6) return { decaying: false, decayScore: 0 };
  const recent = records.slice(0, 3);
  const prior = records.slice(3, 6);
  const recentAcc = trackDecisionAccuracy(recent);
  const priorAcc = trackDecisionAccuracy(prior);
  const decayScore = clamp(priorAcc - recentAcc, 0, 1);
  return { decaying: decayScore > 0.1, decayScore: Number(decayScore.toFixed(4)) };
}

export function detectRegimeSpecificPerformance(records = []) {
  return records.reduce((acc, r) => {
    const regime = r.regime || "UNKNOWN";
    if (!acc[regime]) acc[regime] = { n: 0, accuracy: 0, capture: 0 };
    acc[regime].n += 1;
    acc[regime].accuracy += Number(r.prediction_accuracy || r.historical_accuracy || 0);
    acc[regime].capture += Number(r.unrealized_profit_captured || 0);
    return acc;
  }, {});
}

export function learnFromSuccessfulExits(records = []) {
  const good = records.filter((r) => Number(r.exit_quality || 0) >= 0.65);
  return {
    successRate: Number(clamp(good.length / Math.max(records.length, 1), 0, 1).toFixed(4)),
    avgProfile: calculateHistoricalReliability(good)
  };
}

export function learnFromFailedExits(records = []) {
  const bad = records.filter((r) => Number(r.exit_quality || 0) < 0.45);
  const earlyExitBias = bad.length
    ? bad.reduce((acc, r) => acc + Number(r.unrealized_profit_captured || 0), 0) / bad.length < 0.4
    : false;
  return {
    failureRate: Number(clamp(bad.length / Math.max(records.length, 1), 0, 1).toFixed(4)),
    earlyExitBias
  };
}

export function recalibrateConfidenceScores({ baseConfidence = 0.7, reliability = 0.7, decay = 0, regimePenalty = 0 } = {}) {
  const calibrated = clamp(baseConfidence * (0.6 + reliability * 0.4) * (1 - decay) * (1 - regimePenalty), 0.15, 0.95);
  return Number(calibrated.toFixed(4));
}

export function adjustStrategyWeights({ currentWeight = 1, reliability = 0.7, decay = 0, underperforming = false } = {}) {
  const penalty = underperforming ? 0.2 : 0;
  return Number(clamp(currentWeight * (0.7 + reliability * 0.3) * (1 - decay - penalty), 0.2, 1.2).toFixed(4));
}

export async function recalibrateStrategyState({ strategyType = "DEFENSIVE_EXIT", regime = "UNKNOWN", baseConfidence = 0.7 } = {}) {
  const { data } = await supabase
    .from("adaptive_learning_memory")
    .select("*")
    .eq("strategy_type", strategyType)
    .order("created_at", { ascending: false })
    .limit(40);

  const records = data || [];
  const reliability = calculateHistoricalReliability(records);
  const decay = detectStrategyDecay(records).decayScore;
  const regimePerf = detectRegimeSpecificPerformance(records);

  const regimeRows = records.filter((r) => (r.regime || "UNKNOWN") === regime);
  const regimeAccuracy = trackDecisionAccuracy(regimeRows);
  const regimePenalty = clamp(0.55 - regimeAccuracy, 0, 0.35);

  return {
    reliability,
    decay,
    regimePerformance: regimePerf,
    confidence: recalibrateConfidenceScores({ baseConfidence, reliability, decay, regimePenalty }),
    strategyWeight: adjustStrategyWeights({ currentWeight: 1, reliability, decay, underperforming: reliability < 0.5 })
  };
}

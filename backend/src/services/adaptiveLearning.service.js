import supabase from "./supabase.service.js";

function clamp(v, min = 0, max = 1) { return Math.min(Math.max(Number(v) || 0, min), max); }
function mean(values = []) { return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0; }

export async function trackRealTradeOutcomes(strategyType = "DEFENSIVE_EXIT", limit = 600) {
  const { data, error } = await supabase.from("adaptive_learning_memory").select("*").eq("strategy_type", strategyType).order("created_at", { ascending: false }).limit(limit);
  if (error) return [];
  return data || [];
}

export function trackExitTimingAccuracy(outcomes = []) {
  if (!outcomes.length) return 0.5;
  const vals = outcomes.map((o) => Number(o.exit_quality || 0));
  return Number(clamp(mean(vals), 0, 1).toFixed(6));
}

export function trackProfitCapture(outcomes = []) {
  return Number(clamp(mean(outcomes.map((o) => Number(o.unrealized_profit_captured || 0))), 0, 1).toFixed(6));
}

export function trackDrawdownAvoidance(outcomes = []) {
  const vals = outcomes.map((o) => Number(o.downside_avoided || 0));
  return Number(clamp(mean(vals) / 0.2, 0, 1).toFixed(6));
}

export function trackRegimePerformance(outcomes = []) {
  const map = {};
  for (const row of outcomes) {
    const key = row.regime || "UNKNOWN";
    if (!map[key]) map[key] = [];
    map[key].push(Number(row.prediction_accuracy || row.historical_accuracy || 0));
  }
  return Object.fromEntries(Object.entries(map).map(([k, v]) => [k, Number(clamp(mean(v), 0, 1).toFixed(6))]));
}

export function calculateRollingStrategyPerformance(outcomes = [], window = 30) {
  const series = [];
  for (let i = window; i <= outcomes.length; i += 1) {
    const slice = outcomes.slice(i - window, i);
    series.push(Number(clamp(mean(slice.map((r) => Number(r.prediction_accuracy || r.historical_accuracy || 0))), 0, 1).toFixed(6)));
  }
  return series;
}

export function detectStrategyDegradation(rolling = []) {
  if (rolling.length < 4) return { degraded: false, slope: 0 };
  const latest = mean(rolling.slice(-4));
  const prior = mean(rolling.slice(-8, -4));
  const slope = latest - prior;
  return { degraded: slope < -0.06, slope: Number(slope.toFixed(6)) };
}

export function autoSuppressFailingStrategies({ degraded = false, reliability = 0.5 } = {}) {
  return degraded && reliability < 0.48;
}

export function learnOptimalAllocationBehavior(outcomes = []) {
  const gain = trackProfitCapture(outcomes);
  const dd = trackDrawdownAvoidance(outcomes);
  return Number(clamp(0.55 * gain + 0.45 * dd, 0, 1).toFixed(6));
}

export function learnOptimalExitBehavior(outcomes = []) {
  return Number(clamp(trackExitTimingAccuracy(outcomes) * 0.7 + trackDrawdownAvoidance(outcomes) * 0.3, 0, 1).toFixed(6));
}

export function adaptConfidenceScaling({ baseConfidence = 0.75, reliability = 0.6, degradationSlope = 0, volatilityRegimePenalty = 0 } = {}) {
  const adjusted = baseConfidence * (0.45 + reliability * 0.55) * (1 - Math.max(0, -degradationSlope)) * (1 - clamp(volatilityRegimePenalty, 0, 0.35));
  return Number(clamp(adjusted, 0.12, 0.96).toFixed(6));
}

export function adaptRiskTolerance({ reliability = 0.6, tailRisk = 0.05 } = {}) {
  return Number(clamp(0.25 + reliability * 0.45 - tailRisk * 1.8, 0.08, 0.6).toFixed(6));
}

export function adaptPositionSizing({ baseSize = 1, reliability = 0.6, degradation = false } = {}) {
  const score = baseSize * (0.5 + reliability * 0.6) * (degradation ? 0.7 : 1);
  return Number(clamp(score, 0.2, 1.5).toFixed(6));
}

let _adaptiveSchemaMissingColumns = new Set();

export async function storeDecisionOutcome(outcome = {}) {
  const baseRow = {
    strategy_type: outcome.strategyType || "DEFENSIVE_EXIT",
    regime: outcome.regime || "UNKNOWN",
    confidence_score: Number(outcome.confidenceScore || 0),
    historical_accuracy: Number(outcome.predictionAccuracy || 0),
    recalibrated_weight: Number(outcome.recalibratedWeight || 0),
    prediction_accuracy: Number(outcome.predictionAccuracy || 0),
    exit_quality: Number(outcome.exitQuality || 0),
    unrealized_profit_captured: Number(outcome.unrealizedProfitCaptured || 0),
    downside_avoided: Number(outcome.downsideAvoided || 0),
    sector: outcome.sector || "UNKNOWN",
    volatility_regime: outcome.volatilityRegime || "UNKNOWN"
  };

  // Conditionally include trend_state only if column is known to exist
  const row = _adaptiveSchemaMissingColumns.has("trend_state")
    ? baseRow
    : { ...baseRow, trend_state: outcome.trendState || "UNKNOWN" };

  const { error } = await supabase.from("adaptive_learning_memory").insert(row);

  if (error) {
    // Detect missing column schema errors and retry without that column
    const msg = String(error.message || "").toLowerCase();
    if (msg.includes("trend_state") && msg.includes("column")) {
      if (!_adaptiveSchemaMissingColumns.has("trend_state")) {
        console.warn("[ADAPTIVE] trend_state column missing — applying schema fallback. Run migration to add it.");
        _adaptiveSchemaMissingColumns.add("trend_state");
      }
      // Retry without the missing column
      const { error: retryErr } = await supabase.from("adaptive_learning_memory").insert(baseRow);
      if (retryErr) console.warn("[ADAPTIVE] storeDecisionOutcome retry failed:", retryErr.message);
      return baseRow;
    }
    console.warn("[ADAPTIVE] storeDecisionOutcome failed:", error.message);
  }

  return row;
}

export async function loadHistoricalDecisionOutcomes({ strategyType = "DEFENSIVE_EXIT", limit = 400 } = {}) {
  return trackRealTradeOutcomes(strategyType, limit);
}

export async function recalibrateStrategyState({ strategyType = "DEFENSIVE_EXIT", regime = "UNKNOWN", volatilityRegime = "UNKNOWN", baseConfidence = 0.75 } = {}) {
  const outcomes = await trackRealTradeOutcomes(strategyType, 500);
  const reliability = Number(clamp(mean(outcomes.map((o) => Number(o.prediction_accuracy || o.historical_accuracy || 0))), 0, 1).toFixed(6));
  const rolling = calculateRollingStrategyPerformance(outcomes, 30);
  const degradation = detectStrategyDegradation(rolling);

  const regimePerf = trackRegimePerformance(outcomes);
  const regimeAccuracy = Number(regimePerf[regime] || reliability || 0.5);
  const volPenalty = volatilityRegime === "HIGH" ? 0.14 : volatilityRegime === "EXTREME" ? 0.22 : 0.05;

  const exitPerformance = learnOptimalExitBehavior(outcomes);
  const allocationPerformance = learnOptimalAllocationBehavior(outcomes);

  return {
    reliability,
    strategyWeight: adaptPositionSizing({ baseSize: 1, reliability, degradation: degradation.degraded }),
    confidence: adaptConfidenceScaling({ baseConfidence, reliability: (reliability * 0.7 + regimeAccuracy * 0.3), degradationSlope: degradation.slope, volatilityRegimePenalty: volPenalty }),
    riskTolerance: adaptRiskTolerance({ reliability, tailRisk: 1 - allocationPerformance }),
    positionSizing: adaptPositionSizing({ baseSize: 1, reliability, degradation: degradation.degraded }),
    exitPerformance: { score: exitPerformance },
    allocationPerformance: { score: allocationPerformance },
    regimeAdaptation: { regime, accuracy: regimeAccuracy },
    degradation,
    suppressed: autoSuppressFailingStrategies({ degraded: degradation.degraded, reliability })
  };
}

function clamp(v, min = 0, max = 1) { return Math.min(Math.max(Number(v) || 0, min), max); }
function mean(values = []) { return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0; }

export function calculateHistoricalPredictionAccuracy(outcomes = []) {
  if (!outcomes.length) return 0.5;
  return Number(clamp(mean(outcomes.map((o) => Number(o.prediction_accuracy || o.historical_accuracy || 0))), 0, 1).toFixed(6));
}

export function calculatePredictionReliability(outcomes = []) {
  if (!outcomes.length) return 0.5;
  const quality = outcomes.map((o) => Number(o.exit_quality || 0));
  const accuracy = calculateHistoricalPredictionAccuracy(outcomes);
  return Number(clamp(accuracy * 0.65 + mean(quality) * 0.35, 0, 1).toFixed(6));
}

export function calculateConfidenceDecay(outcomes = []) {
  if (outcomes.length < 20) return 0;
  const recent = mean(outcomes.slice(0, 10).map((o) => Number(o.prediction_accuracy || 0.5)));
  const prior = mean(outcomes.slice(10, 20).map((o) => Number(o.prediction_accuracy || 0.5)));
  return Number(clamp(prior - recent, 0, 0.45).toFixed(6));
}

export function calculateRegimeSpecificAccuracy(outcomes = [], regime = "UNKNOWN") {
  const rows = outcomes.filter((o) => (o.regime || "UNKNOWN") === regime);
  if (!rows.length) return 0.5;
  return calculateHistoricalPredictionAccuracy(rows);
}

export function calculateVolatilityAdjustedConfidence(confidence = 0.7, volatility = 0.2) {
  const penalty = clamp((volatility - 0.18) / 0.28, 0, 0.5);
  return Number(clamp(confidence * (1 - penalty), 0.1, 0.95).toFixed(6));
}

export function generateProbabilisticConfidenceIntervals(point = 0.7, reliability = 0.6) {
  const spread = clamp((1 - reliability) * 0.25, 0.03, 0.25);
  return {
    low: Number(clamp(point - spread, 0.05, 0.98).toFixed(6)),
    mid: Number(clamp(point, 0.05, 0.98).toFixed(6)),
    high: Number(clamp(point + spread, 0.05, 0.98).toFixed(6))
  };
}

export function bayesianConfidenceCalibration({ wins = 1, losses = 1, priorAlpha = 3, priorBeta = 2 } = {}) {
  const alpha = priorAlpha + wins;
  const beta = priorBeta + losses;
  return Number(clamp(alpha / Math.max(alpha + beta, 1), 0.1, 0.95).toFixed(6));
}

export function recalibrateConfidence({ baseConfidence = 0.7, outcomes = [], regime = "UNKNOWN", volatility = 0.2 } = {}) {
  const reliability = calculatePredictionReliability(outcomes);
  const regimeAccuracy = calculateRegimeSpecificAccuracy(outcomes, regime);
  const decay = calculateConfidenceDecay(outcomes);
  const wins = outcomes.filter((o) => Number(o.exit_quality || 0) >= 0.6).length;
  const losses = Math.max(0, outcomes.length - wins);
  const bayes = bayesianConfidenceCalibration({ wins, losses });

  let score = baseConfidence * (0.25 + reliability * 0.35 + regimeAccuracy * 0.2 + bayes * 0.2) * (1 - decay);
  score = calculateVolatilityAdjustedConfidence(score, volatility);
  const interval = generateProbabilisticConfidenceIntervals(score, reliability);
  return Number(interval.mid.toFixed(6));
}

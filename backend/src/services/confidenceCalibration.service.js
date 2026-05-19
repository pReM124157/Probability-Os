function clamp(value, min = 0, max = 1) {
  return Math.min(Math.max(Number(value) || 0, min), max);
}

function betaPosteriorMean(alpha, beta) {
  return alpha / Math.max(alpha + beta, 1);
}

export function calculatePredictionConsistency(outcomes = []) {
  if (outcomes.length < 2) return 0.5;
  const errors = outcomes.map((o) => Math.abs(Number(o.error || (1 - Number(o.prediction_accuracy || 0.5)))));
  const avgErr = errors.reduce((a, b) => a + b, 0) / errors.length;
  return Number(clamp(1 - avgErr, 0, 1).toFixed(4));
}

export function calculateHistoricalReliability(outcomes = []) {
  if (!outcomes.length) return 0.5;
  const hitRate = outcomes.filter((o) => Number(o.exit_quality || 0) >= 0.6).length / outcomes.length;
  const consistency = calculatePredictionConsistency(outcomes);
  return Number(clamp(hitRate * 0.65 + consistency * 0.35, 0, 1).toFixed(4));
}

export function calculateRegimeSpecificAccuracy(outcomes = [], regime = "UNKNOWN") {
  const rows = outcomes.filter((o) => (o.regime || "UNKNOWN") === regime);
  if (!rows.length) return 0.5;
  return Number((rows.reduce((a, r) => a + Number(r.prediction_accuracy || r.historical_accuracy || 0), 0) / rows.length).toFixed(4));
}

export function calculateVolatilityAdjustedConfidence(confidence = 0.7, volatility = 0.2) {
  const penalty = clamp((volatility - 0.18) / 0.35, 0, 0.45);
  return Number(clamp(confidence * (1 - penalty), 0.1, 0.95).toFixed(4));
}

export function calculateConfidenceDecay(outcomes = []) {
  if (outcomes.length < 10) return 0;
  const latest = outcomes.slice(0, 5);
  const prior = outcomes.slice(5, 10);
  const l = calculateHistoricalReliability(latest);
  const p = calculateHistoricalReliability(prior);
  return Number(clamp(p - l, 0, 0.5).toFixed(4));
}

export function calculateBayesianConfidence({ wins = 1, losses = 1, priorAlpha = 3, priorBeta = 2 } = {}) {
  const alpha = priorAlpha + wins;
  const beta = priorBeta + losses;
  return Number(clamp(betaPosteriorMean(alpha, beta), 0.1, 0.95).toFixed(4));
}

export function recalibrateConfidence({ baseConfidence = 0.7, outcomes = [], regime = "UNKNOWN", volatility = 0.2 } = {}) {
  const reliability = calculateHistoricalReliability(outcomes);
  const regimeAcc = calculateRegimeSpecificAccuracy(outcomes, regime);
  const decay = calculateConfidenceDecay(outcomes);
  const wins = outcomes.filter((o) => Number(o.exit_quality || 0) >= 0.6).length;
  const losses = Math.max(0, outcomes.length - wins);
  const bayes = calculateBayesianConfidence({ wins, losses });

  let c = baseConfidence * (0.35 + reliability * 0.25 + regimeAcc * 0.2 + bayes * 0.2) * (1 - decay);
  c = calculateVolatilityAdjustedConfidence(c, volatility);
  return Number(clamp(c, 0.1, 0.95).toFixed(4));
}

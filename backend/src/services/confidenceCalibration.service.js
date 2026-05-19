function clamp(value, min = 0, max = 1) {
  return Math.min(Math.max(Number(value) || 0, min), max);
}

export function trackPredictionConsistency(predictions = []) {
  if (!predictions.length) return 0;
  const avgError = predictions.reduce((acc, p) => acc + Math.abs(Number(p.error || 0)), 0) / predictions.length;
  return Number(clamp(1 - avgError, 0, 1).toFixed(4));
}

export function calculateConfidenceReliability(predictions = []) {
  if (!predictions.length) return 0.5;
  const hitRate = predictions.filter((p) => p.correct).length / predictions.length;
  const consistency = trackPredictionConsistency(predictions);
  return Number(clamp(hitRate * 0.65 + consistency * 0.35, 0, 1).toFixed(4));
}

export function adjustConfidenceByRegime(confidence = 0.7, regime = "SIDEWAYS", regimeReliability = 0.6) {
  const stressPenalty = ["VOLATILITY_PANIC", "RISK_OFF", "LIQUIDITY_STRESS"].includes(regime) ? 0.15 : 0;
  return Number(clamp(confidence * (0.65 + regimeReliability * 0.35) * (1 - stressPenalty), 0.1, 0.95).toFixed(4));
}

export function adjustConfidenceByVolatility(confidence = 0.7, volatility = 0.2) {
  const penalty = clamp((volatility - 0.18) / 0.4, 0, 0.4);
  return Number(clamp(confidence * (1 - penalty), 0.1, 0.95).toFixed(4));
}

export function calculateConfidenceDecay(predictions = []) {
  if (predictions.length < 8) return 0;
  const recent = predictions.slice(0, 4).filter((p) => p.correct).length / 4;
  const prior = predictions.slice(4, 8).filter((p) => p.correct).length / 4;
  return Number(clamp(prior - recent, 0, 0.5).toFixed(4));
}

export function recalibrateConfidence({ baseConfidence = 0.8, predictions = [], regime = "SIDEWAYS", volatility = 0.2, regimeReliability = 0.6 } = {}) {
  const reliability = calculateConfidenceReliability(predictions);
  const decay = calculateConfidenceDecay(predictions);
  let calibrated = baseConfidence * (0.55 + reliability * 0.45) * (1 - decay);
  calibrated = adjustConfidenceByRegime(calibrated, regime, regimeReliability);
  calibrated = adjustConfidenceByVolatility(calibrated, volatility);
  return Number(clamp(calibrated, 0.1, 0.95).toFixed(4));
}

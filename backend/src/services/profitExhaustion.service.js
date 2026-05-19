import { calculateVolatilityExpansion } from "./portfolioMath.service.js";

function clamp(value, min = 0, max = 1) {
  return Math.min(Math.max(Number(value) || 0, min), max);
}

export function predictMomentumDecay({ momentum = 0, momentumSlope = 0, acceleration = 0 } = {}) {
  const score = clamp(((-momentumSlope) * 0.45) + ((-acceleration) * 0.35) + (Math.max(0, momentum - 1) * 0.2), 0, 1);
  return Number(score.toFixed(4));
}

export function calculateTrendExhaustion({ trendExtension = 0, rsi = 50, momentumDecay = 0 } = {}) {
  const extensionScore = clamp((Number(trendExtension) || 0) / 0.25, 0, 1);
  const rsiScore = clamp((Number(rsi) - 55) / 30, 0, 1);
  const score = clamp(extensionScore * 0.45 + rsiScore * 0.3 + clamp(momentumDecay, 0, 1) * 0.25, 0, 1);
  return Number(score.toFixed(4));
}

export function detectVolumeDivergence({ priceTrend = 0, volumeTrend = 0 } = {}) {
  const divergence = Number(priceTrend) - Number(volumeTrend);
  const severity = clamp(divergence / 2, 0, 1);
  return {
    detected: divergence > 0.6,
    severity: Number(severity.toFixed(4))
  };
}

export function estimateCorrectionProbability({
  trendExhaustion = 0,
  volumeDivergence = 0,
  institutionalSellingProbability = 0,
  volatilityExpansion = 0
} = {}) {
  const volStress = clamp((Number(volatilityExpansion) || 0) / 40, 0, 1);
  const probability = clamp(
    (clamp(trendExhaustion, 0, 1) * 0.35) +
    (clamp(volumeDivergence, 0, 1) * 0.2) +
    (clamp(institutionalSellingProbability, 0, 1) * 0.25) +
    (volStress * 0.2),
    0,
    1
  );
  return Number(probability.toFixed(4));
}

export function detectProfitExhaustion(metrics = {}) {
  const momentumDecay = predictMomentumDecay(metrics);
  const trendExhaustion = calculateTrendExhaustion({
    trendExtension: metrics.trendExtension,
    rsi: metrics.rsi,
    momentumDecay
  });

  const volumeDivergence = detectVolumeDivergence({
    priceTrend: metrics.priceTrend,
    volumeTrend: metrics.volumeTrend
  });

  const volExpansion = calculateVolatilityExpansion(metrics.volatility, metrics.baselineVolatility);
  const correctionProbability = estimateCorrectionProbability({
    trendExhaustion,
    volumeDivergence: volumeDivergence.severity,
    institutionalSellingProbability: metrics.institutionalSellingProbability,
    volatilityExpansion: volExpansion
  });

  return {
    exhausted: correctionProbability >= 0.58,
    momentumDecay,
    trendExhaustion,
    volumeDivergence,
    correctionProbability,
    volatilityExpansionPct: volExpansion
  };
}

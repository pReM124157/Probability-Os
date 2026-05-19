function clamp(value, min = 0, max = 1) {
  return Math.min(Math.max(Number(value) || 0, min), max);
}

function safeDiv(numerator, denominator, fallback = 0) {
  const n = Number(numerator);
  const d = Number(denominator);
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return fallback;
  return n / d;
}

export function calculateProfitCapture(avgPrice, currentPrice) {
  return safeDiv((currentPrice - avgPrice) * 100, avgPrice, 0);
}

export function calculateRiskExposure({ weight = 0, beta = 1, volatility = 0.2, downsideProbability = 0.2 } = {}) {
  const normalizedVol = clamp(volatility / 0.6, 0, 2);
  return Number((
    (clamp(weight, 0, 1) * 0.35) +
    (clamp(beta / 2, 0, 2) * 0.25) +
    (normalizedVol * 0.2) +
    (clamp(downsideProbability, 0, 1) * 0.2)
  ).toFixed(4));
}

export function calculateExpectedDrawdown({ volatility = 0.2, beta = 1, downsideProbability = 0.2, trendDeterioration = 0.2 } = {}) {
  const dailyMove = (Number(volatility) || 0.2) * (Number(beta) || 1);
  const stressFactor = 1 + clamp(trendDeterioration, 0, 1);
  const drawdown = dailyMove * 2.2 * stressFactor * clamp(downsideProbability, 0, 1);
  return Number((drawdown * 100).toFixed(2));
}

export function calculateVolatilityExpansion(currentVol = 0.2, baselineVol = 0.18) {
  return Number((safeDiv(currentVol - baselineVol, baselineVol, 0) * 100).toFixed(2));
}

export function calculateRiskRewardDeterioration({ upsideRemaining = 0.08, expectedDownside = 0.05, previousUpside = 0.14, previousDownside = 0.04 } = {}) {
  const currentRR = safeDiv(upsideRemaining, Math.max(expectedDownside, 0.001), 0);
  const previousRR = safeDiv(previousUpside, Math.max(previousDownside, 0.001), 0);
  if (previousRR <= 0) return 0;
  return Number((((previousRR - currentRR) / previousRR) * 100).toFixed(2));
}

export function calculatePortfolioHeatReduction({ sellWeight = 0, positionVolatility = 0.2, positionBeta = 1 } = {}) {
  const reduction = clamp(sellWeight, 0, 1) * ((Number(positionVolatility) || 0.2) * 0.6 + (Number(positionBeta) || 1) * 0.4);
  return Number((reduction * 100).toFixed(2));
}

export function calculateCapitalProtectionEfficiency({ expectedDownside = 0.08, sellPercent = 0.25, slippage = 0.002 } = {}) {
  const protectedCapital = clamp(sellPercent, 0, 1) * Math.max(Number(expectedDownside) || 0, 0);
  return Number((Math.max(0, protectedCapital - (Number(slippage) || 0)) * 100).toFixed(2));
}

export function calculatePortfolioImprovementAfterExit({
  positionWeight = 0,
  sellPercent = 0,
  expectedDownside = 0.08,
  volatility = 0.2,
  portfolioVolatility = 0.24
} = {}) {
  const exitedWeight = clamp(positionWeight, 0, 1) * clamp(sellPercent, 0, 1);
  const downsideAvoided = exitedWeight * Math.max(Number(expectedDownside) || 0, 0);
  const volReduction = safeDiv(exitedWeight * (Number(volatility) || 0.2), Math.max(Number(portfolioVolatility) || 0.24, 0.01), 0);

  return {
    exitedWeight: Number(exitedWeight.toFixed(4)),
    downsideAvoidedPct: Number((downsideAvoided * 100).toFixed(2)),
    portfolioVolatilityReductionPct: Number((volReduction * 100).toFixed(2))
  };
}

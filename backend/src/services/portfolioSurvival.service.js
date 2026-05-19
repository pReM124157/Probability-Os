function clamp(v, min = 0, max = 1) { return Math.min(Math.max(Number(v) || 0, min), max); }
function mean(values = []) { return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0; }

function quantile(values = [], q = 0.5) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const idx = Math.floor((s.length - 1) * q);
  return s[idx];
}

export function calculatePortfolioVaR(returns = [], confidence = 0.95) {
  return Number(Math.abs(quantile(returns, 1 - confidence)).toFixed(6));
}

export function calculateConditionalVaR(returns = [], confidence = 0.95) {
  const threshold = -calculatePortfolioVaR(returns, confidence);
  const tail = returns.filter((r) => r <= threshold);
  return Number(Math.abs(mean(tail)).toFixed(6));
}

export function calculateExpectedShortfall(returns = [], confidence = 0.95) {
  return calculateConditionalVaR(returns, confidence);
}

export function calculateLiquiditySurvival({ volumeRatio = 1, spread = 0.002, redemptionPressure = 0.1 } = {}) {
  const liquidityStress = clamp((1 / Math.max(volumeRatio, 0.1)) * 0.45 + (spread / 0.01) * 0.35 + redemptionPressure * 0.2, 0, 1);
  return Number(clamp(1 - liquidityStress, 0.02, 0.99).toFixed(6));
}

export function calculateTailExposure({ var95 = 0.04, cvar95 = 0.06, expectedShortfall95 = 0.06 } = {}) {
  return Number(clamp(var95 * 2.2 + cvar95 * 2.0 + expectedShortfall95 * 1.7, 0, 1).toFixed(6));
}

export function calculatePortfolioFragility({ var95 = 0.04, cvar95 = 0.06, concentration = 0.2, corrFragility = 0.2 } = {}) {
  return Number(clamp(var95 * 0.3 * 4 + cvar95 * 0.3 * 3 + concentration * 0.2 + corrFragility * 0.2, 0, 1).toFixed(6));
}

export function calculateRiskOfRuin({ cvar95 = 0.06, cashReserve = 0.1, fragility = 0.3 } = {}) {
  return Number(clamp(cvar95 * 2.7 + fragility * 0.65 - cashReserve * 0.55, 0, 1).toFixed(6));
}

export function calculateRecoveryProbability({ riskOfRuin = 0.2, liquiditySurvival = 0.7, tailExposure = 0.3 } = {}) {
  return Number(clamp(0.65 * (1 - riskOfRuin) + 0.25 * liquiditySurvival + 0.1 * (1 - tailExposure), 0.01, 0.99).toFixed(6));
}

export function calculateCapitalPreservationEfficiency({ riskOfRuin = 0.2, survivalProbability = 0.8, drawdownControl = 0.7 } = {}) {
  return Number(clamp((1 - riskOfRuin) * 0.45 + survivalProbability * 0.35 + drawdownControl * 0.2, 0, 1).toFixed(6));
}

export function calculateLiquidityRisk({ volumeRatio = 1, spread = 0.002 } = {}) {
  return Number(clamp((1 / Math.max(volumeRatio, 0.1)) * 0.6 + (spread / 0.01) * 0.4, 0, 1).toFixed(6));
}

export function calculateTailRisk(returns = []) {
  return calculateExpectedShortfall(returns, 0.99);
}

export function calculateSurvivalProbability({ riskOfRuin = 0.2, liquidityRisk = 0.2, fragility = 0.2 } = {}) {
  return Number(clamp(1 - (riskOfRuin * 0.55 + liquidityRisk * 0.2 + fragility * 0.25), 0.02, 0.99).toFixed(6));
}

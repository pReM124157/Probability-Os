function clamp(value, min = 0, max = 1) {
  return Math.min(Math.max(Number(value) || 0, min), max);
}

function quantile(values, q) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const idx = Math.floor((s.length - 1) * q);
  return s[idx];
}

export function calculatePortfolioVaR(returns = [], confidence = 0.95) {
  const q = quantile(returns, 1 - confidence);
  return Number(Math.abs(q).toFixed(4));
}

export function calculateConditionalVaR(returns = [], confidence = 0.95) {
  const varValue = -calculatePortfolioVaR(returns, confidence);
  const tail = returns.filter((r) => r <= varValue);
  if (!tail.length) return 0;
  const cvar = Math.abs(tail.reduce((a, b) => a + b, 0) / tail.length);
  return Number(cvar.toFixed(4));
}

export function calculateTailRisk(returns = []) {
  return calculateConditionalVaR(returns, 0.99);
}

export function calculateLiquidityRisk({ volumeRatio = 1, spread = 0.002 } = {}) {
  const score = clamp((1 / Math.max(volumeRatio, 0.1)) * 0.6 + (spread / 0.01) * 0.4, 0, 1);
  return Number(score.toFixed(4));
}

export function calculatePortfolioFragility({ var95 = 0.04, cvar95 = 0.06, concentration = 0.2, corrFragility = 0.2 } = {}) {
  const score = clamp(var95 * 4 * 0.3 + cvar95 * 3 * 0.3 + concentration * 0.2 + corrFragility * 0.2, 0, 1);
  return Number(score.toFixed(4));
}

export function calculateRiskOfRuin({ cvar95 = 0.06, cashReserve = 0.1, fragility = 0.3 } = {}) {
  return Number(clamp(cvar95 * 2.8 + fragility * 0.6 - cashReserve * 0.5, 0, 1).toFixed(4));
}

export function calculateSurvivalProbability({ riskOfRuin = 0.2, liquidityRisk = 0.2, fragility = 0.2 } = {}) {
  return Number(clamp(1 - (riskOfRuin * 0.55 + liquidityRisk * 0.2 + fragility * 0.25), 0.02, 0.99).toFixed(4));
}

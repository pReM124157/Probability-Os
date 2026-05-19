function clamp(value, min = 0, max = 1) {
  return Math.min(Math.max(Number(value) || 0, min), max);
}

export function detectCatastrophicExposure({ concentration = 0.2, leverage = 0, liquidityStress = 0.2, correlationFragility = 0.2 } = {}) {
  const exposure = clamp(concentration * 0.35 + leverage * 0.2 + liquidityStress * 0.2 + correlationFragility * 0.25, 0, 1);
  return { catastrophic: exposure > 0.68, score: Number(exposure.toFixed(4)) };
}

export function calculateRiskOfRuin({ drawdown = 0.12, fragility = 0.25, cashReserve = 0.1 } = {}) {
  const ruin = clamp(drawdown * 1.8 + fragility * 0.5 - cashReserve * 0.35, 0, 1);
  return Number(ruin.toFixed(4));
}

export function detectPortfolioFragility({ concentration = 0.2, fragility = 0.25, stressTailRisk = 0.2 } = {}) {
  return Number(clamp(concentration * 0.35 + fragility * 0.4 + stressTailRisk * 0.25, 0, 1).toFixed(4));
}

export function calculateCapitalPreservationEfficiency({ downsideAvoided = 0.1, realizedProtection = 0.08 } = {}) {
  return Number(clamp(realizedProtection / Math.max(downsideAvoided, 0.01), 0, 1).toFixed(4));
}

export function calculatePortfolioSurvivalProbability({ riskOfRuin = 0.2, catastrophicScore = 0.2, fragility = 0.2 } = {}) {
  return Number(clamp(1 - (riskOfRuin * 0.5 + catastrophicScore * 0.3 + fragility * 0.2), 0.02, 0.99).toFixed(4));
}

export function generateSurvivalRecommendations({ survivalProbability = 0.7, riskOfRuin = 0.2, catastrophic = false } = {}) {
  const recs = [];
  if (catastrophic) recs.push("Immediate gross exposure reduction and emergency liquidity buffer increase");
  if (riskOfRuin > 0.35) recs.push("Raise defensive cash reserve and reduce correlated high-beta exposure");
  if (survivalProbability < 0.6) recs.push("Prioritize survival-first de-risking over return-seeking allocation");
  if (!recs.length) recs.push("Maintain defensive discipline with incremental optimization only");
  return recs;
}

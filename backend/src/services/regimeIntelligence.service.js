function clamp(value, min = 0, max = 1) {
  return Math.min(Math.max(Number(value) || 0, min), max);
}

export function detectVolatilityRegime({ vix = 18, volatilityTrend = 0 } = {}) {
  if (vix >= 35 || volatilityTrend > 1.6) return "VOLATILITY_PANIC";
  if (vix >= 28) return "RISK_OFF";
  if (vix >= 22) return "WEAKENING";
  if (vix >= 16) return "SIDEWAYS";
  return "HEALTHY_BULLISH";
}

export function detectLiquidityStress({ bidAskSpread = 0.002, marketDepthDrop = 0, fundingStress = 0 } = {}) {
  const stress = clamp((bidAskSpread * 100) * 0.4 + clamp(marketDepthDrop, 0, 1) * 0.35 + clamp(fundingStress, 0, 1) * 0.25, 0, 1);
  return {
    detected: stress >= 0.6,
    stressScore: Number(stress.toFixed(4))
  };
}

export function detectInstitutionalRiskOff({ breadth = 0.5, creditSpreadWidening = 0, defensiveOutperformance = 0 } = {}) {
  const score = clamp((1 - clamp(breadth, 0, 1)) * 0.4 + clamp(creditSpreadWidening, 0, 1) * 0.35 + clamp(defensiveOutperformance, 0, 1) * 0.25, 0, 1);
  return {
    detected: score >= 0.55,
    score: Number(score.toFixed(4))
  };
}

export function detectDefensiveRotation({ defensiveStrength = 0, cyclicalWeakness = 0 } = {}) {
  const score = clamp(clamp(defensiveStrength, 0, 1) * 0.55 + clamp(cyclicalWeakness, 0, 1) * 0.45, 0, 1);
  return {
    detected: score >= 0.55,
    score: Number(score.toFixed(4))
  };
}

export function detectMarketRegime(snapshot = {}) {
  const volRegime = detectVolatilityRegime(snapshot);
  const liquidity = detectLiquidityStress(snapshot);
  const riskOff = detectInstitutionalRiskOff(snapshot);
  const rotation = detectDefensiveRotation(snapshot);

  const trend = Number(snapshot.indexTrend) || 0;
  const breadth = Number(snapshot.breadth) || 0.5;

  let state = "SIDEWAYS";
  if (liquidity.detected) state = "LIQUIDITY_STRESS";
  else if (volRegime === "VOLATILITY_PANIC") state = "VOLATILITY_PANIC";
  else if (riskOff.detected && volRegime !== "HEALTHY_BULLISH") state = "RISK_OFF";
  else if (trend > 0.8 && breadth > 0.6 && volRegime === "HEALTHY_BULLISH") state = "BULLISH_EXPANSION";
  else if (trend > 0.4 && breadth > 0.55) state = "HEALTHY_BULLISH";
  else if (trend < -0.4 || breadth < 0.42 || rotation.detected) state = "WEAKENING";

  const danger = clamp(
    (liquidity.stressScore * 0.3) +
    ((riskOff.score || 0) * 0.25) +
    ((rotation.score || 0) * 0.15) +
    (volRegime === "VOLATILITY_PANIC" ? 0.3 : volRegime === "RISK_OFF" ? 0.2 : 0.1),
    0,
    1
  );

  return {
    state,
    volatilityRegime: volRegime,
    liquidityStress: liquidity,
    institutionalRiskOff: riskOff,
    defensiveRotation: rotation,
    dangerScore: Number(danger.toFixed(4))
  };
}

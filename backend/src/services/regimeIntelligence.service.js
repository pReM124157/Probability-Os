function clamp(value, min = 0, max = 1) {
  return Math.min(Math.max(Number(value) || 0, min), max);
}

export function detectRegimeUsingBreadth({ breadth = 0.5 } = {}) {
  if (breadth > 0.62) return "BULLISH_EXPANSION";
  if (breadth > 0.54) return "HEALTHY_BULLISH";
  if (breadth > 0.45) return "SIDEWAYS";
  return "WEAKENING";
}

export function detectRegimeUsingVolatility({ vix = 20, volatilityExpansion = 0 } = {}) {
  if (vix > 35 || volatilityExpansion > 0.65) return "VOLATILITY_PANIC";
  if (vix > 28) return "RISK_OFF";
  if (vix > 22) return "WEAKENING";
  return "HEALTHY_BULLISH";
}

export function detectRegimeUsingLiquidity({ spread = 0.002, depthDrop = 0.1 } = {}) {
  const stress = clamp((spread / 0.01) * 0.6 + depthDrop * 0.4, 0, 1);
  return { state: stress > 0.65 ? "LIQUIDITY_STRESS" : "NORMAL", stress };
}

export function detectRegimeUsingMacroPressure({ usdStrength = 0.5, ratesPressure = 0.5, creditStress = 0.4 } = {}) {
  return Number(clamp(usdStrength * 0.3 + ratesPressure * 0.35 + creditStress * 0.35, 0, 1).toFixed(4));
}

export function detectRiskOffTransition({ volatilityRegime = "HEALTHY_BULLISH", breadthRegime = "HEALTHY_BULLISH", liquidityState = "NORMAL" } = {}) {
  const riskOff = ["VOLATILITY_PANIC", "RISK_OFF", "WEAKENING"].includes(volatilityRegime)
    && ["SIDEWAYS", "WEAKENING"].includes(breadthRegime);
  return riskOff || liquidityState === "LIQUIDITY_STRESS";
}

export function detectInstitutionalRotation({ defensiveOutperformance = 0.5, cyclicalWeakness = 0.5 } = {}) {
  const score = clamp(defensiveOutperformance * 0.55 + cyclicalWeakness * 0.45, 0, 1);
  return { detected: score > 0.58, score: Number(score.toFixed(4)) };
}

export function detectMarketRegime(snapshot = {}) {
  const breadthRegime = detectRegimeUsingBreadth(snapshot);
  const volatilityRegime = detectRegimeUsingVolatility(snapshot);
  const liquidity = detectRegimeUsingLiquidity(snapshot);
  const macroPressure = detectRegimeUsingMacroPressure(snapshot);
  const rotation = detectInstitutionalRotation(snapshot);
  const riskOff = detectRiskOffTransition({
    volatilityRegime,
    breadthRegime,
    liquidityState: liquidity.state
  });

  let state = breadthRegime;
  if (liquidity.state === "LIQUIDITY_STRESS") state = "LIQUIDITY_STRESS";
  else if (volatilityRegime === "VOLATILITY_PANIC") state = "VOLATILITY_PANIC";
  else if (riskOff) state = "RISK_OFF";

  const dangerScore = clamp(
    (state === "VOLATILITY_PANIC" ? 0.35 : state === "RISK_OFF" ? 0.25 : 0.1) +
    liquidity.stress * 0.25 +
    macroPressure * 0.2 +
    rotation.score * 0.2,
    0,
    1
  );

  return {
    state,
    breadthRegime,
    volatilityRegime,
    liquidityStress: liquidity,
    macroPressure,
    institutionalRotation: rotation,
    dangerScore: Number(dangerScore.toFixed(4))
  };
}

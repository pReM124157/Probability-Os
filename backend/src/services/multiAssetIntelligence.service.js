function clamp(value, min = 0, max = 1) {
  return Math.min(Math.max(Number(value) || 0, min), max);
}

export function detectCryptoVolatilityRegime(asset = {}) {
  const vol = Number(asset.volatility || 0.4);
  if (vol > 0.75) return "EXTREME";
  if (vol > 0.55) return "HIGH";
  if (vol > 0.35) return "ELEVATED";
  return "NORMAL";
}

export function detectForexMacroPressure(asset = {}) {
  const dxySensitivity = Number(asset.dxySensitivity || 0.5);
  const ratesSensitivity = Number(asset.ratesSensitivity || 0.5);
  return Number(clamp(dxySensitivity * 0.55 + ratesSensitivity * 0.45, 0, 1).toFixed(4));
}

export function detectCommodityShockRisk(asset = {}) {
  const supplyShock = Number(asset.supplyShock || 0.3);
  const geopolitics = Number(asset.geopolitics || 0.3);
  return Number(clamp(supplyShock * 0.6 + geopolitics * 0.4, 0, 1).toFixed(4));
}

export function detectAssetClassBehavior(asset = {}) {
  const klass = (asset.assetClass || "EQUITY").toUpperCase();
  if (klass === "CRYPTO") return { behavior: "HIGH_BETA_VOL", regime: detectCryptoVolatilityRegime(asset) };
  if (klass === "FOREX") return { behavior: "MACRO_SENSITIVE", regime: detectForexMacroPressure(asset) };
  if (klass === "COMMODITY") return { behavior: "SHOCK_DRIVEN", regime: detectCommodityShockRisk(asset) };
  if (klass === "ETF") return { behavior: "BASKET_BETA", regime: "DIVERSIFIED" };
  return { behavior: "EQUITY_TREND", regime: "STANDARD" };
}

export function calculateCrossAssetRisk(assets = []) {
  if (!assets.length) return 0;
  const risk = assets.reduce((acc, a) => acc + Number(a.riskScore || 0.4) * Number(a.weight || 0), 0);
  return Number(clamp(risk, 0, 1).toFixed(4));
}

export function calculateCrossMarketContagion(assets = []) {
  const highBeta = assets.filter((a) => Number(a.beta || 1) > 1.25).reduce((acc, a) => acc + Number(a.weight || 0), 0);
  const cryptoWeight = assets.filter((a) => (a.assetClass || "").toUpperCase() === "CRYPTO").reduce((acc, a) => acc + Number(a.weight || 0), 0);
  return Number(clamp(highBeta * 0.6 + cryptoWeight * 0.4, 0, 1).toFixed(4));
}

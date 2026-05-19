function clamp(value, min = 0, max = 1) {
  return Math.min(Math.max(Number(value) || 0, min), max);
}

export function detectResistanceClusters({ resistanceLevels = [], currentPrice = 0 } = {}) {
  const levels = Array.isArray(resistanceLevels) ? resistanceLevels.filter((v) => Number(v) > 0).sort((a, b) => a - b) : [];
  const nearby = levels.filter((level) => level >= currentPrice && level <= currentPrice * 1.15);
  return {
    count: nearby.length,
    clusters: nearby,
    clusterDensity: Number(clamp(nearby.length / 4, 0, 1).toFixed(4))
  };
}

export function estimateUpsideProbability({ momentum = 0.5, breadth = 0.5, regimeDanger = 0.2, resistanceDensity = 0.2 } = {}) {
  const probability = clamp(
    (clamp(momentum, 0, 1) * 0.4) +
    (clamp(breadth, 0, 1) * 0.2) +
    ((1 - clamp(regimeDanger, 0, 1)) * 0.25) +
    ((1 - clamp(resistanceDensity, 0, 1)) * 0.15),
    0,
    1
  );
  return Number(probability.toFixed(4));
}

export function calculateOptimalProfitZone({ currentPrice = 0, atr = 0, trendExhaustion = 0, resistanceClusters = [] } = {}) {
  const atrValue = Number(atr) || (Number(currentPrice) * 0.03);
  const exhaustionHaircut = 1 - clamp(trendExhaustion, 0, 0.6);
  const rawUpper = Number(currentPrice) + (atrValue * 2.2 * exhaustionHaircut);
  const rawLower = Number(currentPrice) + (atrValue * 1.1 * exhaustionHaircut);

  const nearestResistance = resistanceClusters.find((r) => r > currentPrice) || rawUpper;
  const upper = Math.min(rawUpper, nearestResistance);

  return {
    lower: Number(rawLower.toFixed(2)),
    upper: Number(upper.toFixed(2))
  };
}

export function projectTargetRange({
  currentPrice = 0,
  atr = 0,
  resistanceLevels = [],
  trendExhaustion = 0,
  momentum = 0.5,
  breadth = 0.5,
  regimeDanger = 0.2
} = {}) {
  const resistance = detectResistanceClusters({ resistanceLevels, currentPrice });
  const upsideProbability = estimateUpsideProbability({
    momentum,
    breadth,
    regimeDanger,
    resistanceDensity: resistance.clusterDensity
  });
  const optimalZone = calculateOptimalProfitZone({
    currentPrice,
    atr,
    trendExhaustion,
    resistanceClusters: resistance.clusters
  });

  const upsideRemainingPct = Number((((optimalZone.upper - currentPrice) / Math.max(currentPrice, 0.01)) * 100).toFixed(2));
  const asymmetryDeterioration = Number((clamp(trendExhaustion, 0, 1) * 50 + resistance.clusterDensity * 35 + (1 - upsideProbability) * 15).toFixed(2));

  return {
    targetRange: optimalZone,
    realisticUpsideRemainingPct: Math.max(0, upsideRemainingPct),
    institutionalResistance: resistance,
    upsideProbability,
    exhaustionZones: {
      early: Number((optimalZone.lower * 0.99).toFixed(2)),
      late: optimalZone.upper
    },
    asymmetryDeterioration
  };
}

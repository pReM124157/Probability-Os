function clamp(value, min = 0, max = 1) {
  return Math.min(Math.max(Number(value) || 0, min), max);
}

export function generatePriceProbabilityDistribution({ currentPrice = 100, drift = 0.06, volatility = 0.25 } = {}) {
  const sigma = Number(volatility) || 0.25;
  const mu = Number(drift) || 0.06;
  const bands = [-2, -1, 0, 1, 2].map((z) => ({
    z,
    price: Number((currentPrice * (1 + mu + z * sigma * 0.35)).toFixed(2)),
    probability: z === 0 ? 0.32 : Math.abs(z) === 1 ? 0.24 : 0.1
  }));
  return bands;
}

export function calculateConfidenceIntervals(distribution = []) {
  if (!distribution.length) return { low: 0, mid: 0, high: 0 };
  const sorted = [...distribution].sort((a, b) => a.price - b.price);
  return {
    low: sorted[1]?.price ?? sorted[0].price,
    mid: sorted[2]?.price ?? sorted[Math.floor(sorted.length / 2)].price,
    high: sorted[3]?.price ?? sorted[sorted.length - 1].price
  };
}

export function estimateUpsideProbability(distribution = [], targetPrice = 0) {
  const p = distribution.filter((d) => d.price >= targetPrice).reduce((acc, d) => acc + d.probability, 0);
  return Number(clamp(p, 0, 1).toFixed(4));
}

export function estimateDownsideProbability(distribution = [], floorPrice = 0) {
  const p = distribution.filter((d) => d.price <= floorPrice).reduce((acc, d) => acc + d.probability, 0);
  return Number(clamp(p, 0, 1).toFixed(4));
}

export function generateScenarioTree({ currentPrice = 100, upside = 1.08, base = 1.02, downside = 0.92 } = {}) {
  return {
    bullish: { price: Number((currentPrice * upside).toFixed(2)), probability: 0.35 },
    base: { price: Number((currentPrice * base).toFixed(2)), probability: 0.47 },
    bearish: { price: Number((currentPrice * downside).toFixed(2)), probability: 0.18 }
  };
}

export function calculateExpectedValue(distribution = []) {
  const ev = distribution.reduce((acc, d) => acc + d.price * d.probability, 0);
  return Number(ev.toFixed(2));
}

export function projectMultiScenarioTargets({ currentPrice = 100, volatility = 0.25, drift = 0.06 } = {}) {
  const distribution = generatePriceProbabilityDistribution({ currentPrice, volatility, drift });
  const scenarioTree = generateScenarioTree({ currentPrice, upside: 1 + drift + volatility * 0.4, base: 1 + drift * 0.5, downside: 1 - volatility * 0.45 });
  return { distribution, scenarioTree, expectedValue: calculateExpectedValue(distribution) };
}

export function generateProbabilisticOutlook({ currentPrice = 100, targetPrice = 110, correctionLevel = 94, volatility = 0.25, drift = 0.06 } = {}) {
  const { distribution, scenarioTree, expectedValue } = projectMultiScenarioTargets({ currentPrice, volatility, drift });
  const ci = calculateConfidenceIntervals(distribution);
  const upsideProb = estimateUpsideProbability(distribution, targetPrice);
  const downsideProb = estimateDownsideProbability(distribution, correctionLevel);

  return {
    distribution,
    scenarioTree,
    confidenceInterval: ci,
    upsideProbability: upsideProb,
    downsideProbability: downsideProb,
    expectedValue,
    asymmetryDeterioration: Number(clamp(downsideProb - upsideProb + 0.5, 0, 1).toFixed(4))
  };
}

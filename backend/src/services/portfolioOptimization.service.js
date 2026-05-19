function clamp(value, min = 0, max = 1) {
  return Math.min(Math.max(Number(value) || 0, min), max);
}

function invertMatrix2x2(m) {
  const det = m[0][0] * m[1][1] - m[0][1] * m[1][0];
  if (Math.abs(det) < 1e-10) return null;
  return [
    [m[1][1] / det, -m[0][1] / det],
    [-m[1][0] / det, m[0][0] / det]
  ];
}

export function calculateEfficientFrontier(positions = []) {
  return positions
    .map((p) => ({
      ticker: p.ticker,
      expectedReturn: Number(p.expectedReturn || 0),
      risk: Number(p.volatility || 0.2),
      sharpe: Number((Number(p.expectedReturn || 0) / Math.max(Number(p.volatility || 0.2), 0.01)).toFixed(4))
    }))
    .sort((a, b) => b.sharpe - a.sharpe);
}

export function performMeanVarianceOptimization(positions = []) {
  if (positions.length === 2) {
    const p0 = positions[0];
    const p1 = positions[1];
    const cov = Number(p0.cov12 || p1.cov12 || 0.01);
    const C = [[p0.volatility ** 2, cov], [cov, p1.volatility ** 2]];
    const inv = invertMatrix2x2(C);
    if (inv) {
      const mu = [p0.expectedReturn, p1.expectedReturn];
      const raw0 = inv[0][0] * mu[0] + inv[0][1] * mu[1];
      const raw1 = inv[1][0] * mu[0] + inv[1][1] * mu[1];
      const total = Math.max(raw0 + raw1, 1e-9);
      return [
        { ticker: p0.ticker, weight: Number(clamp(raw0 / total, 0, 1).toFixed(4)) },
        { ticker: p1.ticker, weight: Number(clamp(raw1 / total, 0, 1).toFixed(4)) }
      ];
    }
  }

  const frontier = calculateEfficientFrontier(positions);
  const scoreSum = frontier.reduce((a, p) => a + Math.max(p.sharpe, 0.001), 0) || 1;
  return frontier.map((p) => ({ ticker: p.ticker, weight: Number((Math.max(p.sharpe, 0.001) / scoreSum).toFixed(4)) }));
}

export function calculateSharpeOptimizedAllocation(positions = []) {
  return performMeanVarianceOptimization(positions);
}

export function calculateVolatilityTargetedAllocation(positions = [], targetVol = 0.18) {
  const invVol = positions.map((p) => ({ ticker: p.ticker, score: targetVol / Math.max(Number(p.volatility || 0.2), 0.01) }));
  const sum = invVol.reduce((a, p) => a + p.score, 0) || 1;
  return invVol.map((p) => ({ ticker: p.ticker, weight: Number((p.score / sum).toFixed(4)) }));
}

export function calculateRiskParityAllocation(positions = []) {
  const invVol = positions.map((p) => ({ ticker: p.ticker, score: 1 / Math.max(Number(p.volatility || 0.2), 0.01) }));
  const sum = invVol.reduce((a, p) => a + p.score, 0) || 1;
  return invVol.map((p) => ({ ticker: p.ticker, weight: Number((p.score / sum).toFixed(4)) }));
}

export function calculateMaximumDrawdownOptimization(positions = []) {
  const scores = positions.map((p) => ({ ticker: p.ticker, score: 1 / Math.max(Math.abs(Number(p.maxDrawdown || 0.12)), 0.02) }));
  const sum = scores.reduce((a, p) => a + p.score, 0) || 1;
  return scores.map((p) => ({ ticker: p.ticker, weight: Number((p.score / sum).toFixed(4)) }));
}

export function calculateCovarianceAwareSizing(positions = [], covarianceMatrix = {}) {
  const raw = positions.map((p) => {
    const row = covarianceMatrix[p.ticker] || {};
    const dependency = Object.values(row).reduce((a, b) => a + Math.abs(Number(b || 0)), 0) || 1;
    return { ticker: p.ticker, score: 1 / dependency };
  });
  const sum = raw.reduce((a, p) => a + p.score, 0) || 1;
  return raw.map((p) => ({ ticker: p.ticker, weight: Number((p.score / sum).toFixed(4)) }));
}

export function calculateOptimalAllocation(positions = [], { covarianceMatrix = {} } = {}) {
  return {
    efficientFrontier: calculateEfficientFrontier(positions),
    meanVariance: performMeanVarianceOptimization(positions),
    sharpeOptimized: calculateSharpeOptimizedAllocation(positions),
    volatilityTargeted: calculateVolatilityTargetedAllocation(positions),
    riskParity: calculateRiskParityAllocation(positions),
    drawdownOptimized: calculateMaximumDrawdownOptimization(positions),
    covarianceAwareSizing: calculateCovarianceAwareSizing(positions, covarianceMatrix)
  };
}

function clamp(v, min = 0, max = 1) { return Math.min(Math.max(Number(v) || 0, min), max); }

function normalizeWeights(rows = []) {
  const sum = rows.reduce((a, r) => a + Math.max(0, Number(r.weight || 0)), 0) || 1;
  return rows.map((r) => ({ ...r, weight: Number((Math.max(0, Number(r.weight || 0)) / sum).toFixed(6)) }));
}

export function performMeanVarianceOptimization(positions = [], covarianceMatrix = {}) {
  const raw = positions.map((p) => {
    const er = Number(p.expectedReturn || 0.08);
    const selfVar = Math.abs(Number(covarianceMatrix[p.ticker]?.[p.ticker] || p.volatility ** 2 || 0.04));
    const tailPenalty = Number(p.tailRisk || 0.03) * 0.8;
    const score = Math.max(0.0001, er / Math.max(0.0001, selfVar + tailPenalty));
    return { ticker: p.ticker, weight: score };
  });
  return normalizeWeights(raw);
}

export function calculateMaximumSharpePortfolio(positions = []) {
  const rf = 0.04;
  return normalizeWeights(positions.map((p) => ({
    ticker: p.ticker,
    weight: Math.max(0.0001, (Number(p.expectedReturn || 0) - rf) / Math.max(0.01, Number(p.volatility || 0.2)))
  })));
}

export function calculateMinimumVariancePortfolio(positions = [], covarianceMatrix = {}) {
  return normalizeWeights(positions.map((p) => {
    const v = Math.abs(Number(covarianceMatrix[p.ticker]?.[p.ticker] || p.volatility ** 2 || 0.04));
    return { ticker: p.ticker, weight: 1 / Math.max(v, 0.0001) };
  }));
}

export function calculateRiskParityAllocation(positions = [], covarianceMatrix = {}) {
  const mvp = calculateMinimumVariancePortfolio(positions, covarianceMatrix);
  return normalizeWeights(mvp.map((x) => ({ ticker: x.ticker, weight: Math.sqrt(x.weight) })));
}

export function calculateBlackLittermanPortfolio(positions = [], covarianceMatrix = {}, views = {}) {
  const base = performMeanVarianceOptimization(positions, covarianceMatrix);
  return normalizeWeights(base.map((w) => {
    const viewAdj = Number(views[w.ticker] || 0);
    return { ticker: w.ticker, weight: w.weight * (1 + viewAdj) };
  }));
}

export function calculateKellySizing({ expectedReturn = 0.1, variance = 0.04, cap = 0.25 } = {}) {
  const k = expectedReturn / Math.max(variance, 1e-6);
  return Number(clamp(k, 0, cap).toFixed(6));
}

export function calculateDrawdownAwareAllocation(positions = [], drawdownLimit = 0.2) {
  return normalizeWeights(positions.map((p) => {
    const dd = Math.abs(Number(p.maxDrawdown || 0.1));
    return { ticker: p.ticker, weight: Math.max(0.0001, (drawdownLimit / Math.max(dd, 0.01))) };
  }));
}

export function calculateDynamicCashReserve({ regimeDanger = 0.2, tailRisk = 0.05, liquidityRisk = 0.2 } = {}) {
  return Number(clamp(regimeDanger * 0.45 + tailRisk * 2.5 * 0.35 + liquidityRisk * 0.2, 0.05, 0.45).toFixed(6));
}

export function calculateEfficientFrontier(positions = [], covarianceMatrix = {}) {
  const frontier = [];
  for (let riskTarget = 0.08; riskTarget <= 0.32; riskTarget += 0.02) {
    const weights = normalizeWeights(positions.map((p) => ({
      ticker: p.ticker,
      weight: Math.max(0.0001, (Number(p.expectedReturn || 0.08) / Math.max(0.01, Number(p.volatility || 0.2))) * (riskTarget / Math.max(0.01, Number(p.volatility || 0.2))))
    })));
    const expectedReturn = weights.reduce((acc, w) => acc + (Number(positions.find((p) => p.ticker === w.ticker)?.expectedReturn || 0) * w.weight), 0);
    frontier.push({ riskTarget: Number(riskTarget.toFixed(4)), expectedReturn: Number(expectedReturn.toFixed(6)), weights });
  }
  return frontier;
}

export function calculateOptimalAllocation(positions = [], { covarianceMatrix = {}, views = {}, regimeDanger = 0.2, tailRisk = 0.05, liquidityRisk = 0.2 } = {}) {
  const mvo = performMeanVarianceOptimization(positions, covarianceMatrix);
  const sharpe = calculateMaximumSharpePortfolio(positions);
  const minVar = calculateMinimumVariancePortfolio(positions, covarianceMatrix);
  const riskParity = calculateRiskParityAllocation(positions, covarianceMatrix);
  const bl = calculateBlackLittermanPortfolio(positions, covarianceMatrix, views);
  const drawdownAware = calculateDrawdownAwareAllocation(positions, 0.2);

  const kelly = Object.fromEntries(positions.map((p) => [
    p.ticker,
    calculateKellySizing({ expectedReturn: Number(p.expectedReturn || 0.08), variance: Math.max(0.0001, Number(covarianceMatrix[p.ticker]?.[p.ticker] || (p.volatility || 0.2) ** 2)) })
  ]));

  return {
    efficientFrontier: calculateEfficientFrontier(positions, covarianceMatrix),
    meanVariance: mvo,
    maximumSharpe: sharpe,
    minimumVariance: minVar,
    riskParity,
    blackLitterman: bl,
    drawdownAware,
    kellySizing: kelly,
    dynamicCashReserve: calculateDynamicCashReserve({ regimeDanger, tailRisk, liquidityRisk })
  };
}

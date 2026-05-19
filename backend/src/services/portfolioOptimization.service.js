function clamp(value, min = 0, max = 1) {
  return Math.min(Math.max(Number(value) || 0, min), max);
}

export function calculateVolatilityAdjustedSizing(position = {}) {
  const vol = Number(position.volatility || 0.2);
  const score = Number(position.qualityScore || 0.6);
  return Number(clamp((score * 0.12) / Math.max(vol, 0.08), 0.02, 0.22).toFixed(4));
}

export function optimizeRiskAdjustedReturns(positions = []) {
  return positions.map((p) => {
    const score = Number(p.expectedReturn || 0.08) / Math.max(Number(p.volatility || 0.2), 0.05);
    return { ticker: p.ticker, score: Number(score.toFixed(4)) };
  });
}

export function calculateEfficientFrontier(positions = []) {
  const ranked = optimizeRiskAdjustedReturns(positions).sort((a, b) => b.score - a.score);
  return ranked.slice(0, Math.min(10, ranked.length));
}

export function optimizeSectorWeights(positions = []) {
  const grouped = positions.reduce((acc, p) => {
    const sector = p.sector || "UNKNOWN";
    if (!acc[sector]) acc[sector] = [];
    acc[sector].push(p);
    return acc;
  }, {});

  return Object.entries(grouped).map(([sector, rows]) => {
    const suggested = Math.min(0.32, rows.reduce((acc, r) => acc + calculateVolatilityAdjustedSizing(r), 0));
    return { sector, suggestedWeight: Number(suggested.toFixed(4)) };
  });
}

export function calculateAdaptiveCashReserve({ regimeDanger = 0.2, stressDrawdown = 8, fragility = 20 } = {}) {
  const reserve = clamp(0.05 + regimeDanger * 0.25 + (stressDrawdown / 100) * 0.4 + (fragility / 100) * 0.3, 0.05, 0.5);
  return Number(reserve.toFixed(4));
}

export function optimizeDefensivePositioning(positions = [], context = {}) {
  const reserve = calculateAdaptiveCashReserve(context);
  const targetInvested = 1 - reserve;
  const allocations = positions.map((p) => ({ ticker: p.ticker, targetWeight: calculateVolatilityAdjustedSizing(p) }));
  const sum = allocations.reduce((a, b) => a + b.targetWeight, 0) || 1;
  return allocations.map((a) => ({ ...a, targetWeight: Number(((a.targetWeight / sum) * targetInvested).toFixed(4)) }));
}

export function calculateCapitalEfficiency({ expectedReturn = 0.08, downsideRisk = 0.06, turnoverCost = 0.004 } = {}) {
  return Number(Math.max(0, expectedReturn - downsideRisk - turnoverCost).toFixed(4));
}

export function calculateOptimalAllocation(positions = [], context = {}) {
  const frontier = calculateEfficientFrontier(positions);
  const defensive = optimizeDefensivePositioning(positions, context);
  const sectorWeights = optimizeSectorWeights(positions);

  return {
    efficientFrontier: frontier,
    sectorWeights,
    allocations: defensive,
    cashReserve: calculateAdaptiveCashReserve(context),
    capitalEfficiency: calculateCapitalEfficiency({
      expectedReturn: context.expectedReturn || 0.08,
      downsideRisk: context.downsideRisk || 0.06,
      turnoverCost: context.turnoverCost || 0.004
    })
  };
}

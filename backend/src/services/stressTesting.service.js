function clamp(value, min = 0, max = 1) {
  return Math.min(Math.max(Number(value) || 0, min), max);
}

function applyShock(positions = [], multipliers = {}) {
  return positions.map((p) => {
    const w = Number(p.weight || 0);
    const beta = Number(p.beta || 1);
    const vol = Number(p.volatility || 0.2);
    const shock = Number(multipliers.market || -0.08) * beta;
    const volShock = vol * (1 + Number(multipliers.vol || 0.4));
    const liqPenalty = Number(multipliers.liquidity || 0);
    const projectedLoss = Math.abs(w * (shock - liqPenalty));
    return {
      ticker: p.ticker,
      projectedLossPct: Number((projectedLoss * 100).toFixed(2)),
      volatilityProjection: Number((volShock * 100).toFixed(2))
    };
  });
}

export function replayHistoricalCrashes(positions = []) {
  return {
    CRASH_2008: applyShock(positions, { market: -0.11, vol: 1.0, liquidity: 0.02 }),
    COVID_2020: applyShock(positions, { market: -0.13, vol: 1.2, liquidity: 0.018 }),
    TECH_COLLAPSE: applyShock(positions, { market: -0.09, vol: 0.9, liquidity: 0.012 }),
    VOLATILITY_PANIC: applyShock(positions, { market: -0.07, vol: 1.4, liquidity: 0.01 }),
    LIQUIDITY_CRISIS: applyShock(positions, { market: -0.08, vol: 1.1, liquidity: 0.03 })
  };
}

export function simulateVolatilityShock(positions = []) { return applyShock(positions, { market: -0.06, vol: 1.3, liquidity: 0.01 }); }
export function simulateLiquidityCollapse(positions = []) { return applyShock(positions, { market: -0.07, vol: 0.8, liquidity: 0.03 }); }
export function simulateCorrelationBreakdown(positions = []) { return applyShock(positions, { market: -0.09, vol: 0.9, liquidity: 0.015 }); }
export function simulateTailRiskEvents(positions = []) { return applyShock(positions, { market: -0.15, vol: 1.5, liquidity: 0.025 }); }
export function simulateSectorCollapse(positions = [], sector = "TECH") {
  return positions.map((p) => {
    const multiplier = String(p.sector || "").toUpperCase().includes(String(sector).toUpperCase()) ? 1.8 : 0.8;
    return applyShock([{ ...p, weight: Number(p.weight || 0) * multiplier }], { market: -0.09, vol: 1.0, liquidity: 0.02 })[0];
  });
}
export function simulateRegimeTransitions(positions = []) { return applyShock(positions, { market: -0.085, vol: 0.95, liquidity: 0.016 }); }

export function calculateHistoricalWorstCase(scenarios = {}) {
  const items = Object.entries(scenarios).map(([name, rows]) => ({
    name,
    drawdown: Number(rows.reduce((a, r) => a + Number(r.projectedLossPct || 0), 0).toFixed(2)),
    rows
  }));
  return items.sort((a, b) => b.drawdown - a.drawdown)[0] || { name: "N/A", drawdown: 0, rows: [] };
}

export function generateStressScenarioReport(positions = []) {
  const historical = replayHistoricalCrashes(positions);
  const synthetic = {
    VOL_SHOCK: simulateVolatilityShock(positions),
    LIQ_COLLAPSE: simulateLiquidityCollapse(positions),
    CORR_BREAKDOWN: simulateCorrelationBreakdown(positions),
    TAIL_EVENT: simulateTailRiskEvents(positions),
    REGIME_TRANSITION: simulateRegimeTransitions(positions)
  };

  const all = { ...historical, ...synthetic };
  const worst = calculateHistoricalWorstCase(all);
  const damage = worst.drawdown;
  const survival = Number(clamp(1 - damage / 100, 0.02, 0.99).toFixed(4));

  return {
    scenarios: all,
    worstScenario: worst.name,
    expectedDrawdown: damage,
    drawdownProbability: Number(clamp(damage / 40, 0, 1).toFixed(4)),
    sectorCollapseExposure: simulateSectorCollapse(positions, "TECH"),
    survivalProbability: survival,
    weakestPositions: worst.rows.sort((a, b) => b.projectedLossPct - a.projectedLossPct).slice(0, 5)
  };
}

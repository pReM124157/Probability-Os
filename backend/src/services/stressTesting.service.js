function clamp(value, min = 0, max = 1) {
  return Math.min(Math.max(Number(value) || 0, min), max);
}

function scenarioImpact(positions = [], { marketShock = 0, betaMultiplier = 1, volShock = 0, sector = null } = {}) {
  return positions.map((p) => {
    const baseBeta = Number(p.beta || 1);
    const weight = Number(p.weight || 0);
    const sectorHit = sector && String(p.sector || "").toUpperCase().includes(String(sector).toUpperCase()) ? 1.5 : 1;
    const projected = weight * marketShock * baseBeta * betaMultiplier * sectorHit;
    return {
      ticker: p.ticker,
      projectedLossPct: Number((Math.abs(projected) * 100).toFixed(2)),
      volatilityProjection: Number((((Number(p.volatility || 0.2) + volShock) * 100)).toFixed(2))
    };
  });
}

export function simulateMarketCrash(positions = []) { return scenarioImpact(positions, { marketShock: -0.08, betaMultiplier: 1.1, volShock: 0.12 }); }
export function simulateVolatilityExplosion(positions = []) { return scenarioImpact(positions, { marketShock: -0.05, betaMultiplier: 1.3, volShock: 0.25 }); }
export function simulateLiquidityCollapse(positions = []) { return scenarioImpact(positions, { marketShock: -0.06, betaMultiplier: 1.2, volShock: 0.2 }); }
export function simulateCorrelationBreakdown(positions = []) { return scenarioImpact(positions, { marketShock: -0.07, betaMultiplier: 1.25, volShock: 0.18 }); }
export function simulateSectorCrash(positions = [], sector = "AI") { return scenarioImpact(positions, { marketShock: -0.09, betaMultiplier: 1.2, volShock: 0.22, sector }); }

export function calculateWorstCaseDrawdown(results = []) {
  const total = results.reduce((acc, r) => acc + Number(r.projectedLossPct || 0), 0);
  return Number(total.toFixed(2));
}

export function calculateTailRisk(results = []) {
  const worst = [...results].sort((a, b) => b.projectedLossPct - a.projectedLossPct).slice(0, 3);
  const avgWorst = worst.length ? worst.reduce((acc, r) => acc + r.projectedLossPct, 0) / worst.length : 0;
  return Number(clamp(avgWorst / 18, 0, 1).toFixed(4));
}

export function runPortfolioStressMatrix(positions = []) {
  const scenarios = {
    MARKET_CRASH_8: simulateMarketCrash(positions),
    NASDAQ_CRASH: scenarioImpact(positions, { marketShock: -0.1, betaMultiplier: 1.25, volShock: 0.2 }),
    AI_SECTOR_COLLAPSE: simulateSectorCrash(positions, "AI"),
    VOLATILITY_SPIKE: simulateVolatilityExplosion(positions),
    LIQUIDITY_FREEZE: simulateLiquidityCollapse(positions),
    RECESSIONARY_SHOCK: scenarioImpact(positions, { marketShock: -0.12, betaMultiplier: 1.15, volShock: 0.16 }),
    RISK_OFF_PANIC: scenarioImpact(positions, { marketShock: -0.09, betaMultiplier: 1.35, volShock: 0.24 }),
    INTEREST_RATE_SHOCK: scenarioImpact(positions, { marketShock: -0.07, betaMultiplier: 1.1, volShock: 0.14 })
  };

  return Object.entries(scenarios).map(([scenario, rows]) => ({
    scenario,
    rows,
    expectedDrawdown: calculateWorstCaseDrawdown(rows),
    tailRisk: calculateTailRisk(rows)
  }));
}

export function generateStressScenarioReport(positions = []) {
  const matrix = runPortfolioStressMatrix(positions);
  const worst = matrix.sort((a, b) => b.expectedDrawdown - a.expectedDrawdown)[0] || { expectedDrawdown: 0, scenario: "N/A", rows: [] };
  const survivalProbability = Number((Math.max(0.05, 1 - worst.expectedDrawdown / 100)).toFixed(4));

  return {
    matrix,
    worstScenario: worst.scenario,
    expectedDrawdown: worst.expectedDrawdown,
    capitalDestructionProbability: Number(clamp(worst.expectedDrawdown / 45, 0, 1).toFixed(4)),
    weakestPositions: worst.rows.sort((a, b) => b.projectedLossPct - a.projectedLossPct).slice(0, 5),
    survivalProbability
  };
}

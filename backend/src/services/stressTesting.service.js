function clamp(v, min = 0, max = 1) { return Math.min(Math.max(Number(v) || 0, min), max); }

function runScenario(positions = [], cfg = {}) {
  return positions.map((p) => {
    const w = Number(p.weight || 0);
    const beta = Number(p.beta || 1);
    const vol = Number(p.volatility || 0.2);
    const corr = Number(p.correlationRisk || 0.3);
    const liquidity = Number(cfg.liquidityPenalty || 0.01);
    const marketShock = Number(cfg.marketShock || -0.1) * beta;
    const volShock = vol * (1 + Number(cfg.volSpike || 1));
    const contagion = Number(cfg.contagion || 0.2) * corr;
    const projectedLoss = Math.abs(w * (marketShock - liquidity - contagion));
    return {
      ticker: p.ticker,
      projectedLossPct: Number((projectedLoss * 100).toFixed(4)),
      stressedVolatilityPct: Number((volShock * 100).toFixed(4)),
      liquidityDrainPct: Number((liquidity * 100).toFixed(4))
    };
  });
}

export const replay2008FinancialCrisis = (positions = []) => runScenario(positions, { marketShock: -0.18, volSpike: 1.7, liquidityPenalty: 0.04, contagion: 0.35 });
export const replayCovidCrash = (positions = []) => runScenario(positions, { marketShock: -0.15, volSpike: 2.0, liquidityPenalty: 0.03, contagion: 0.32 });
export const replayFlashCrash = (positions = []) => runScenario(positions, { marketShock: -0.12, volSpike: 2.4, liquidityPenalty: 0.02, contagion: 0.3 });
export const simulateLiquidityFreeze = (positions = []) => runScenario(positions, { marketShock: -0.1, volSpike: 1.4, liquidityPenalty: 0.05, contagion: 0.28 });
export const simulateVolatilityExplosion = (positions = []) => runScenario(positions, { marketShock: -0.11, volSpike: 2.5, liquidityPenalty: 0.02, contagion: 0.26 });
export const simulateCorrelationSpike = (positions = []) => runScenario(positions, { marketShock: -0.13, volSpike: 1.6, liquidityPenalty: 0.02, contagion: 0.45 });
export const simulateCrossSectorContagion = (positions = []) => runScenario(positions, { marketShock: -0.14, volSpike: 1.5, liquidityPenalty: 0.03, contagion: 0.5 });
export const simulateCapitalDestruction = (positions = []) => runScenario(positions, { marketShock: -0.22, volSpike: 2.1, liquidityPenalty: 0.05, contagion: 0.55 });
export const simulateSystemicFailure = (positions = []) => runScenario(positions, { marketShock: -0.28, volSpike: 2.8, liquidityPenalty: 0.06, contagion: 0.62 });

export function simulateRecoveryTimeline(scenarioRows = []) {
  const avgLoss = scenarioRows.reduce((a, r) => a + Number(r.projectedLossPct || 0), 0) / Math.max(1, scenarioRows.length);
  const months = Math.max(1, Math.ceil(avgLoss / 4.5));
  return { expectedRecoveryMonths: months, halfRecoveryMonths: Math.max(1, Math.floor(months * 0.6)) };
}

function summarizeScenario(rows = []) {
  const totalLoss = rows.reduce((a, r) => a + Number(r.projectedLossPct || 0), 0);
  const liquidity = rows.reduce((a, r) => a + Number(r.liquidityDrainPct || 0), 0);
  const avgVol = rows.reduce((a, r) => a + Number(r.stressedVolatilityPct || 0), 0) / Math.max(rows.length, 1);
  return { totalLossPct: Number(totalLoss.toFixed(4)), liquidityDrainPct: Number(liquidity.toFixed(4)), avgVolatilityPct: Number(avgVol.toFixed(4)) };
}

export function generateStressScenarioReport(positions = []) {
  const scenarios = {
    CRISIS_2008: replay2008FinancialCrisis(positions),
    CRASH_COVID: replayCovidCrash(positions),
    FLASH_CRASH: replayFlashCrash(positions),
    LIQUIDITY_FREEZE: simulateLiquidityFreeze(positions),
    VOL_EXPLOSION: simulateVolatilityExplosion(positions),
    CORRELATION_SPIKE: simulateCorrelationSpike(positions),
    CROSS_SECTOR_CONTAGION: simulateCrossSectorContagion(positions),
    CAPITAL_DESTRUCTION: simulateCapitalDestruction(positions),
    SYSTEMIC_FAILURE: simulateSystemicFailure(positions)
  };

  const summary = Object.fromEntries(Object.entries(scenarios).map(([k, rows]) => [k, summarizeScenario(rows)]));
  const worst = Object.entries(summary).sort((a, b) => b[1].totalLossPct - a[1].totalLossPct)[0];
  const worstRows = scenarios[worst?.[0] || "SYSTEMIC_FAILURE"] || [];
  const recovery = simulateRecoveryTimeline(worstRows);

  const expectedDrawdown = Number((worst?.[1]?.totalLossPct || 0).toFixed(4));
  const capitalSurvivalProbability = Number(clamp(1 - expectedDrawdown / 100, 0.01, 0.99).toFixed(6));

  return {
    scenarios,
    scenarioSummary: summary,
    worstScenario: worst?.[0] || "N/A",
    expectedDrawdown,
    liquidityExhaustion: Number(clamp((worst?.[1]?.liquidityDrainPct || 0) / 35, 0, 1).toFixed(6)),
    systemicFragility: Number(clamp((worst?.[1]?.avgVolatilityPct || 0) / 95, 0, 1).toFixed(6)),
    tailAmplification: Number(clamp(expectedDrawdown / 40, 0, 1).toFixed(6)),
    contagionPropagation: Number(clamp((summary.CROSS_SECTOR_CONTAGION?.totalLossPct || 0) / 35, 0, 1).toFixed(6)),
    capitalSurvivalProbability,
    recoveryTimeline: recovery,
    weakestPositions: [...worstRows].sort((a, b) => b.projectedLossPct - a.projectedLossPct).slice(0, 5)
  };
}

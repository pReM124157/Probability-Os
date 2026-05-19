import {
  calculateCapitalProtectionEfficiency,
  calculateExpectedDrawdown,
  calculatePortfolioHeatReduction,
  calculatePortfolioImprovementAfterExit,
  calculateProfitCapture,
  calculateRiskRewardDeterioration,
  calculateVolatilityExpansion
} from "./portfolioMath.service.js";
import { detectProfitExhaustion } from "./profitExhaustion.service.js";
import { projectTargetRange } from "./targetProjection.service.js";

function clamp(value, min = 0, max = 1) {
  return Math.min(Math.max(Number(value) || 0, min), max);
}

export function calculateInstitutionalDistributionProbability({
  priceTrend = 0,
  volumeTrend = 0,
  volatility = 0.2,
  liquidityStress = 0.2
} = {}) {
  const score = clamp(
    clamp((0.2 - priceTrend) / 0.8, 0, 1) * 0.35 +
    clamp((0 - volumeTrend) / 0.8, 0, 1) * 0.3 +
    clamp(volatility / 0.6, 0, 1) * 0.2 +
    clamp(liquidityStress, 0, 1) * 0.15,
    0,
    1
  );
  return Number(score.toFixed(4));
}

export function calculateMomentumDecayCurve({ momentumSeries = [] } = {}) {
  if (momentumSeries.length < 3) return 0;
  const x0 = Number(momentumSeries[momentumSeries.length - 3] || 0);
  const x1 = Number(momentumSeries[momentumSeries.length - 2] || 0);
  const x2 = Number(momentumSeries[momentumSeries.length - 1] || 0);
  const decay = (x0 - x1) + (x1 - x2);
  return Number(decay.toFixed(4));
}

export function calculateTrendExhaustionProbability({ trendMaturityScore = 0, momentumDecay = 0, volatilityExpansion = 0 } = {}) {
  const p = clamp(
    clamp(trendMaturityScore, 0, 1) * 0.45 +
    clamp(momentumDecay, 0, 1) * 0.3 +
    clamp(volatilityExpansion / 40, 0, 1) * 0.25,
    0,
    1
  );
  return Number(p.toFixed(4));
}

export function calculateDynamicProfitLocking({ unrealizedProfitPct = 0, drawdownRisk = 0.2, concentrationRisk = 0.2 } = {}) {
  const lock = clamp(
    clamp(unrealizedProfitPct / 40, 0, 1) * 0.45 +
    clamp(drawdownRisk, 0, 1) * 0.35 +
    clamp(concentrationRisk, 0, 1) * 0.2,
    0,
    1
  );
  return Number(lock.toFixed(4));
}

export function calculateOptimalExitPath({ sellPercent = 0, liquidityRisk = 0.2 } = {}) {
  if (sellPercent >= 0.95) return "FULL_EXIT";
  if (sellPercent >= 0.45) return liquidityRisk > 0.6 ? "STAGGERED_DEFENSIVE_EXIT" : "DEFENSIVE_EXIT";
  if (sellPercent >= 0.25) return "PARTIAL_EXIT";
  if (sellPercent >= 0.1) return "TRIM";
  return "HOLD";
}

export function detectTrendFailure(holding = {}) {
  const trend = Number(holding.trendQuality) || 0;
  const supportFailure = Boolean(holding.supportFailure);
  const momentum = Number(holding.momentum) || 0;
  const failed = supportFailure || trend < 0.28 || momentum < 0.25;
  return {
    failed,
    severity: Number(clamp((supportFailure ? 0.5 : 0) + (0.4 - trend) + (0.3 - momentum), 0, 1).toFixed(4))
  };
}

export function detectStructuralWeakness(holding = {}, regime = {}) {
  const breakdownRisk = clamp(holding.breakdownRisk ?? 0, 0, 1);
  const downsideAsymmetry = clamp(holding.downsideAsymmetry ?? 0, 0, 1);
  const regimeStress = clamp(regime.dangerScore ?? 0, 0, 1);
  const weakness = clamp((breakdownRisk * 0.4) + (downsideAsymmetry * 0.35) + (regimeStress * 0.25), 0, 1);
  return {
    weak: weakness >= 0.6,
    score: Number(weakness.toFixed(4))
  };
}

export function calculateDynamicSellAllocation(context = {}) {
  const weakness = clamp(context.weaknessScore ?? 0.2, 0, 1);
  const profit = clamp((context.unrealizedProfitPct ?? 0) / 30, 0, 1);
  const regime = clamp(context.regimeDanger ?? 0.2, 0, 1);
  const correlation = clamp(context.correlationRisk ?? 0.2, 0, 1);

  const raw = clamp(weakness * 0.45 + profit * 0.15 + regime * 0.2 + correlation * 0.2, 0, 1);

  if (context.structuralBreakdown) return 1;
  if (context.distributionDetected) return Math.max(0.4, Math.min(0.6, raw));
  if (context.trendMaturing) return Math.max(0.25, Math.min(0.35, raw));
  if (weakness > 0.28) return Math.max(0.1, Math.min(0.15, raw));

  return 0;
}

export function calculateProfitLockingAllocation(metrics = {}) {
  const profit = Number(metrics.unrealizedProfitPct) || 0;
  if (profit >= 35) return 0.35;
  if (profit >= 25) return 0.25;
  if (profit >= 15) return 0.15;
  return 0.1;
}

export function calculateDefensiveReduction({ regimeDanger = 0.2, correlationRisk = 0.2, concentrationRisk = 0.2 } = {}) {
  return Number(clamp((regimeDanger * 0.45) + (correlationRisk * 0.3) + (concentrationRisk * 0.25), 0, 0.6).toFixed(4));
}

export function calculateOptimalExit(holding = {}, regime = {}, threat = {}) {
  const unrealizedProfitPct = calculateProfitCapture(holding.avgPrice, holding.currentPrice);
  const volatilityIncreasePct = calculateVolatilityExpansion(holding.volatility, holding.baselineVolatility || 0.18);
  const distributionProbability = calculateInstitutionalDistributionProbability({
    priceTrend: holding.priceTrend,
    volumeTrend: holding.volumeTrend,
    volatility: holding.volatility,
    liquidityStress: regime.liquidityStress?.stress || 0
  });
  const momentumDecay = calculateMomentumDecayCurve({
    momentumSeries: holding.momentumSeries || [holding.momentum || 0, holding.momentumSlope || 0, holding.momentumAcceleration || 0]
  });
  const trendExhaustionProbability = calculateTrendExhaustionProbability({
    trendMaturityScore: holding.trendMaturityScore,
    momentumDecay,
    volatilityExpansion: volatilityIncreasePct
  });

  const weaknessScore = clamp(
    (Number(holding.trendMaturityScore) || 0) * 0.3 +
    distributionProbability * 0.3 +
    (Number(holding.downsideAsymmetry) || 0) * 0.2 +
    (Number(regime.dangerScore) || 0) * 0.2,
    0,
    1
  );

  const sellPercent = calculateDynamicSellAllocation({
    weaknessScore,
    unrealizedProfitPct,
    regimeDanger: regime.dangerScore,
    correlationRisk: holding.correlationRisk,
    structuralBreakdown: holding.state === "EXIT_NOW" || holding.state === "BREAKDOWN_RISK",
    distributionDetected: distributionProbability >= 0.62,
    trendMaturing: holding.state === "TREND_MATURING" || holding.state === "OVEREXTENDED"
  });
  const profitLocking = calculateDynamicProfitLocking({
    unrealizedProfitPct,
    drawdownRisk: (threat.downsideProbability || 0.2),
    concentrationRisk: threat.concentrationRisk || 0.2
  });
  const adjustedSellPercent = clamp(Math.max(sellPercent, profitLocking * 0.5 + trendExhaustionProbability * 0.5), 0, 1);

  const exitQty = Math.floor((Number(holding.quantity) || 0) * adjustedSellPercent);
  const expectedDownsidePct = calculateExpectedDrawdown({
    volatility: holding.volatility,
    beta: holding.beta,
    downsideProbability: threat.downsideProbability || holding.downsideAsymmetry || 0.2,
    trendDeterioration: weaknessScore
  });

  const rrDeteriorationPct = calculateRiskRewardDeterioration({
    upsideRemaining: (holding.upsideRemainingPct || 6) / 100,
    expectedDownside: expectedDownsidePct / 100,
    previousUpside: 0.14,
    previousDownside: 0.04
  });

  const action = calculateOptimalExitPath({
    sellPercent: adjustedSellPercent,
    liquidityRisk: regime.liquidityStress?.stress || 0
  });

  return {
    action,
    sellPercent: Number((adjustedSellPercent * 100).toFixed(2)),
    quantity: exitQty,
    unrealizedProfitPct: Number(unrealizedProfitPct.toFixed(2)),
    expectedDownsidePct,
    volatilityIncreasePct,
    distributionProbability,
    trendExhaustionProbability,
    momentumDecay,
    rrDeteriorationPct,
    concentrationRiskReductionPct: Number((calculatePortfolioHeatReduction({
      sellWeight: (holding.weight || 0) * adjustedSellPercent,
      positionVolatility: holding.volatility,
      positionBeta: holding.beta
    })).toFixed(2)),
    portfolioImprovement: calculatePortfolioImprovementAfterExit({
      positionWeight: holding.weight,
      sellPercent: adjustedSellPercent,
      expectedDownside: expectedDownsidePct / 100,
      volatility: holding.volatility,
      portfolioVolatility: threat.portfolioVolatility || 0.24
    }),
    capitalProtectionBenefitPct: calculateCapitalProtectionEfficiency({
      expectedDownside: expectedDownsidePct / 100,
      sellPercent: adjustedSellPercent
    })
  };
}

export function generateExitReasoning({ holding, regime, exhaustion, trendFailure, structuralWeakness, optimalExit }) {
  const statements = [];

  if (exhaustion.exhausted) {
    statements.push("Momentum expansion is fading while correction probability is rising toward exhaustion territory");
  }
  if (trendFailure.failed) {
    statements.push("trend structure has degraded through weakening support behavior and reduced impulse quality");
  }
  if (structuralWeakness.weak) {
    statements.push("downside asymmetry is dominating upside continuation under elevated systemic stress");
  }
  if ((holding.distributionProbability || 0) > 0.55) {
    statements.push("institutional distribution probability has moved above defensive tolerance");
  }
  if ((regime.dangerScore || 0) > 0.55) {
    statements.push("market regime risk has deteriorated enough that capital preservation now outranks incremental upside capture");
  }

  if (statements.length === 0) {
    statements.push("risk-reward remains acceptable relative to current regime; no forced de-risking is mathematically required");
  }

  return `${statements.join(", ")}. Recommended action: ${optimalExit.action} ${optimalExit.sellPercent}% to protect capital efficiency.`;
}

export function analyzeExitOpportunity(holding = {}, regime = {}, threat = {}) {
  const exhaustion = detectProfitExhaustion({
    momentum: holding.momentum,
    momentumSlope: holding.momentumSlope,
    acceleration: holding.momentumAcceleration,
    trendExtension: holding.trendExtension,
    rsi: holding.rsi,
    priceTrend: holding.priceTrend,
    volumeTrend: holding.volumeTrend,
    institutionalSellingProbability: holding.distributionProbability,
    volatility: holding.volatility,
    baselineVolatility: holding.baselineVolatility
  });

  const projection = projectTargetRange({
    currentPrice: holding.currentPrice,
    atr: holding.atr,
    resistanceLevels: holding.resistanceLevels,
    trendExhaustion: exhaustion.trendExhaustion,
    momentum: holding.momentum,
    breadth: threat.marketBreadth,
    regimeDanger: regime.dangerScore
  });

  const trendFailure = detectTrendFailure({
    ...holding,
    trendQuality: holding.trendQuality,
    momentum: holding.momentum,
    supportFailure: holding.supportFailure
  });

  const structuralWeakness = detectStructuralWeakness(holding, regime);

  const optimalExit = calculateOptimalExit(
    {
      ...holding,
      upsideRemainingPct: projection.realisticUpsideRemainingPct,
      trendMaturityScore: holding.trendMaturityScore
    },
    regime,
    threat
  );

  const reasoning = generateExitReasoning({
    holding,
    regime,
    exhaustion,
    trendFailure,
    structuralWeakness,
    optimalExit
  });

  return {
    ...optimalExit,
    targetProjection: projection,
    profitExhaustion: exhaustion,
    trendFailure,
    structuralWeakness,
    reasoning,
    confidence: Number((Math.min(0.95, 0.45 + (optimalExit.sellPercent / 100) * 0.5)).toFixed(2))
  };
}

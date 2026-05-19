import { analyzeExitOpportunity } from "../services/exitIntelligence.service.js";
import {
  detectUrgentPortfolioChanges,
  monitorPortfolioEvery10Minutes,
  schedulePortfolioSurveillance,
  startPortfolioMonitoring
} from "../services/portfolioSurveillance.service.js";
import { generatePortfolioDefensePlan, rankPortfolioThreats } from "../services/portfolioAlert.service.js";
import { generateCorrelationIntel } from "../services/quantCorrelation.service.js";
import { generateStressScenarioReport } from "../services/stressTesting.service.js";
import { generateProbabilisticOutlook } from "../services/probabilisticForecast.service.js";
import { loadHistoricalDecisionOutcomes, recalibrateStrategyState, storeDecisionOutcome } from "../services/adaptiveLearning.service.js";
import { calculateOptimalAllocation } from "../services/portfolioOptimization.service.js";
import { recalibrateConfidence } from "../services/confidenceCalibration.service.js";
import {
  calculateConditionalVaR,
  calculateLiquidityRisk,
  calculatePortfolioFragility,
  calculatePortfolioVaR,
  calculateRiskOfRuin,
  calculateSurvivalProbability,
  calculateTailRisk
} from "../services/portfolioSurvival.service.js";
import { storeDecisionReasoning } from "../services/reasoningAudit.service.js";
import {
  buildHistoricalFactorSnapshot,
  fetchHistoricalCorrelationData,
  persistHistoricalMarketReturns
} from "../services/historicalMarketData.service.js";
import { enqueueQuantJob } from "../services/quantWorkerQueue.service.js";

function buildReturnMap(historicalRows = []) {
  return historicalRows.reduce((acc, row) => {
    acc[row.ticker] = row.returns || [];
    return acc;
  }, {});
}

function portfolioReturns(holdings = [], returnMap = {}) {
  if (!holdings.length) return [];
  const minLen = Math.min(...holdings.map((h) => (returnMap[h.ticker] || []).length).filter((x) => x > 0));
  if (!Number.isFinite(minLen) || minLen < 2) return [];
  const out = [];
  for (let i = 0; i < minLen; i += 1) {
    let r = 0;
    for (const h of holdings) {
      const w = Number(h.weight || 0);
      r += w * Number(returnMap[h.ticker][i] || 0);
    }
    out.push(r);
  }
  return out;
}

export async function runPortfolioDefenseCycle() {
  const surveillance = await monitorPortfolioEvery10Minutes();
  const holdings = surveillance.holdings || [];

  const factorSnapshots = await Promise.all(holdings.map((h) => buildHistoricalFactorSnapshot(h.ticker)));
  await persistHistoricalMarketReturns(factorSnapshots.map((s) => ({
    ticker: s.ticker,
    timeframe: "1Y",
    returns: s.returns,
    volatility: s.volatility,
    beta: s.beta
  })));

  const histRows = await fetchHistoricalCorrelationData(holdings.map((h) => h.ticker), "1Y");
  const returnMap = buildReturnMap(histRows);

  const correlationJob = await enqueueQuantJob("correlation", { holdings, returnMap }, async () => generateCorrelationIntel({
    positions: holdings.map((h) => ({ ticker: h.ticker, weight: h.weight, beta: h.beta, sector: h.sector })),
    returnMap
  }));
  const correlation = correlationJob.result;

  const stressJob = await enqueueQuantJob("stress", { holdings }, async () => generateStressScenarioReport(holdings));
  const stress = stressJob.result;

  const outlookByTicker = await Promise.all(
    factorSnapshots.map(async (s) => {
      const mc = await enqueueQuantJob("monte_carlo", { ticker: s.ticker }, async () => generateProbabilisticOutlook({
        ticker: s.ticker,
        currentPrice: s.currentPrice,
        historicalReturns: s.returns,
        regimeDanger: surveillance.regime?.dangerScore || 0.2,
        horizonDays: 21,
        paths: 1200
      }));
      return { ticker: s.ticker, forecast: mc.result };
    })
  );

  const adaptive = await recalibrateStrategyState({
    strategyType: "DEFENSIVE_EXIT",
    regime: surveillance.regime?.state || "UNKNOWN",
    volatilityRegime: surveillance.regime?.volatilityRegime || "UNKNOWN",
    baseConfidence: 0.78
  });

  const outcomes = await loadHistoricalDecisionOutcomes({ strategyType: "DEFENSIVE_EXIT", limit: 120 });
  const calibratedConfidence = recalibrateConfidence({
    baseConfidence: adaptive.confidence,
    outcomes,
    regime: surveillance.regime?.state || "UNKNOWN",
    volatility: surveillance.threat?.portfolioVolatility || 0.22
  });

  const optimized = calculateOptimalAllocation(
    holdings.map((h) => {
      const snap = factorSnapshots.find((s) => s.ticker === h.ticker);
      return {
        ticker: h.ticker,
        sector: h.sector,
        volatility: snap?.volatility || h.volatility,
        expectedReturn: (snap?.returns?.reduce((a, b) => a + b, 0) || 0) * (252 / Math.max((snap?.returns?.length || 1), 1)),
        maxDrawdown: Math.abs((snap?.drawdowns?.maxDrawdown || -12) / 100)
      };
    }),
    { covarianceMatrix: correlation?.covarianceMatrix || {} }
  );

  const pReturns = portfolioReturns(holdings, returnMap);
  const var95 = calculatePortfolioVaR(pReturns, 0.95);
  const cvar95 = calculateConditionalVaR(pReturns, 0.95);
  const tailRisk = calculateTailRisk(pReturns);
  const liquidityRisk = calculateLiquidityRisk({
    volumeRatio: factorSnapshots.reduce((a, s) => a + (s.volume?.volumeRatio || 1), 0) / Math.max(factorSnapshots.length, 1),
    spread: 0.002
  });
  const fragility = calculatePortfolioFragility({
    var95,
    cvar95,
    concentration: surveillance.threat?.concentrationRisk || 0.2,
    corrFragility: (correlation?.portfolioFragilityScore || 20) / 100
  });
  const riskOfRuin = calculateRiskOfRuin({ cvar95, cashReserve: 0.12, fragility });
  const survivalProbability = calculateSurvivalProbability({ riskOfRuin, liquidityRisk, fragility });

  const exitIntelligence = holdings.map((h) => {
    const outlook = outlookByTicker.find((o) => o.ticker === h.ticker)?.forecast;
    return analyzeExitOpportunity(
      {
        ...h,
        upsideRemainingPct: outlook ? ((outlook.intervals.high - h.currentPrice) / Math.max(h.currentPrice, 0.01)) * 100 : h.upsideRemainingPct,
        momentumSeries: (returnMap[h.ticker] || []).slice(-3)
      },
      surveillance.regime,
      {
        ...surveillance.threat,
        concentrationRisk: surveillance.threat?.concentrationRisk || 0.2,
        downsideProbability: outlook?.probabilities?.downsideProbability || surveillance.threat?.downsideProbability || 0.2
      }
    );
  });

  const rankedThreats = rankPortfolioThreats(surveillance.alerts || []);
  const urgent = detectUrgentPortfolioChanges(rankedThreats);
  const defensePlan = generatePortfolioDefensePlan(rankedThreats);

  await storeDecisionReasoning({
    userId: "system",
    decisionType: "PORTFOLIO_DEFENSE_V2_QUANT",
    reasoning: "Historical covariance, Monte Carlo distributions, stress replay, and survival metrics indicate current defensive posture.",
    mathematicalBasis: `VaR95=${var95}, CVaR95=${cvar95}, Tail=${tailRisk}, Fragility=${fragility}, Survival=${survivalProbability}`,
    confidence: calibratedConfidence,
    regimeAssumptions: surveillance.regime,
    modelAssumptions: {
      covarianceBased: true,
      monteCarloPaths: 1200,
      stressReplay: stress?.worstScenario || "N/A"
    }
  });

  await storeDecisionOutcome({
    strategyType: "DEFENSIVE_EXIT",
    regime: surveillance.regime?.state || "UNKNOWN",
    confidenceScore: calibratedConfidence,
    predictionAccuracy: adaptive.reliability,
    exitQuality: 1 - (surveillance.threat?.portfolioThreatScore || 0.3),
    unrealizedProfitCaptured: exitIntelligence.reduce((a, e) => a + Number(e.unrealizedProfitPct > 0 ? 1 : 0), 0) / Math.max(exitIntelligence.length, 1),
    downsideAvoided: Number((var95 + cvar95).toFixed(4)),
    trendState: "MIXED",
    sector: surveillance.threat?.sectorOverexposure?.sector || "UNKNOWN",
    volatilityRegime: surveillance.regime?.volatilityRegime || "UNKNOWN",
    recalibratedWeight: adaptive.strategyWeight
  });

  return {
    flow: {
      fetchHistoricalData: true,
      buildReturnSeries: true,
      buildCovarianceMatrix: true,
      detectCorrelationClusters: true,
      runMonteCarloSimulations: true,
      runHistoricalStressTests: true,
      runRegimeAnalysis: true,
      runAdaptiveLearningValidation: true,
      optimizePortfolio: true,
      calculateSurvivalProbability: true,
      generateExitIntelligence: true,
      generateDefensiveAlerts: urgent.hasUrgentChanges
    },
    confidence: calibratedConfidence,
    health: surveillance.health,
    threat: surveillance.threat,
    regime: surveillance.regime,
    correlation,
    stress,
    probabilisticOutlook: outlookByTicker,
    adaptive,
    optimization: optimized,
    survival: { var95, cvar95, tailRisk, liquidityRisk, fragility, riskOfRuin, survivalProbability },
    alerts: rankedThreats,
    defensePlan,
    urgent
  };
}

export async function runPortfolioDefenseForHolding(holding, regime, threat) {
  return analyzeExitOpportunity(holding, regime, threat);
}

export function initializePortfolioDefenseAgent() {
  schedulePortfolioSurveillance();
}

export { startPortfolioMonitoring };

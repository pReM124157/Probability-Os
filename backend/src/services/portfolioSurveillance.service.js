import cron from "node-cron";
import supabase from "./supabase.service.js";
import { getLiveMarketData } from "./marketData.service.js";
import { detectMarketRegime } from "./regimeIntelligence.service.js";
import { analyzeExitOpportunity } from "./exitIntelligence.service.js";
import {
  calculateExpectedDrawdown,
  calculateProfitCapture,
  calculateRiskExposure,
  calculateVolatilityExpansion
} from "./portfolioMath.service.js";
import {
  generatePortfolioAlert,
  persistPortfolioAlerts,
  rankPortfolioThreats,
  sendUrgentExitAlert
} from "./portfolioAlert.service.js";

function clamp(value, min = 0, max = 1) {
  return Math.min(Math.max(Number(value) || 0, min), max);
}

function toNum(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function calculateTrendMaturity(holding = {}) {
  const trendAge = clamp((holding.trendAgeDays || 30) / 120, 0, 1);
  const extension = clamp(holding.trendExtension || 0, 0, 1);
  const momentumDecay = clamp(holding.momentumDecay || 0, 0, 1);
  return Number((trendAge * 0.35 + extension * 0.35 + momentumDecay * 0.3).toFixed(4));
}

export function detectInstitutionalDistribution(holding = {}) {
  const priceWeakness = clamp((0.5 - (holding.priceTrend || 0)) / 1.2, 0, 1);
  const volumePressure = clamp((holding.volumeTrend || 0) < 0 ? Math.abs(holding.volumeTrend) : 0, 0, 1);
  const volExpansion = clamp((holding.volatilityExpansion || 0) / 40, 0, 1);
  const probability = clamp(priceWeakness * 0.35 + volumePressure * 0.4 + volExpansion * 0.25, 0, 1);
  return Number(probability.toFixed(4));
}

export function detectWeakMomentum(holding = {}) {
  const momentum = clamp(holding.momentum || 0, 0, 1.5);
  const slope = Number(holding.momentumSlope) || 0;
  const rsi = Number(holding.rsi) || 50;
  const weak = momentum < 0.45 || slope < -0.1 || rsi < 46;
  const score = clamp((0.6 - momentum) * 0.5 + (Math.max(0, -slope) * 0.3) + ((50 - rsi) / 50) * 0.2, 0, 1);
  return { weak, score: Number(score.toFixed(4)) };
}

export function classifyPositionState(holding = {}) {
  const maturity = calculateTrendMaturity(holding);
  const distribution = detectInstitutionalDistribution(holding);
  const weakMomentum = detectWeakMomentum(holding);
  const supportFailure = Boolean(holding.supportFailure);
  const downside = clamp(holding.downsideAsymmetry || 0, 0, 1);

  if (supportFailure && distribution > 0.75) return "EXIT_NOW";
  if (supportFailure || downside > 0.7) return "BREAKDOWN_RISK";
  if (distribution > 0.7) return "DISTRIBUTION";
  if (downside > 0.62 || weakMomentum.score > 0.65) return "HIGH_RISK";
  if (maturity > 0.75) return "OVEREXTENDED";
  if (maturity > 0.58) return "TREND_MATURING";
  if (holding.trendQuality > 0.62 && !weakMomentum.weak) return "HEALTHY_TREND";
  return "ACCUMULATION";
}

export function detectConcentrationRisk(holdings = []) {
  const total = holdings.reduce((acc, h) => acc + (h.marketValue || 0), 0) || 1;
  const maxWeight = Math.max(...holdings.map((h) => (h.marketValue || 0) / total), 0);
  return Number(clamp(maxWeight / 0.35, 0, 1).toFixed(4));
}

export function detectCorrelationClusters(holdings = []) {
  const cluster = holdings.filter((h) => (h.correlationRisk || 0) > 0.65).length;
  return {
    count: cluster,
    score: Number(clamp(cluster / Math.max(1, holdings.length * 0.4), 0, 1).toFixed(4))
  };
}

export function detectSectorOverexposure(holdings = []) {
  const total = holdings.reduce((acc, h) => acc + (h.marketValue || 0), 0) || 1;
  const sectorWeights = holdings.reduce((acc, h) => {
    const sector = (h.sector || "UNKNOWN").toUpperCase();
    acc[sector] = (acc[sector] || 0) + (h.marketValue || 0);
    return acc;
  }, {});

  const dominant = Object.entries(sectorWeights).sort((a, b) => b[1] - a[1])[0] || ["UNKNOWN", 0];
  const weight = dominant[1] / total;
  return {
    sector: dominant[0],
    weight: Number(weight.toFixed(4)),
    score: Number(clamp(weight / 0.4, 0, 1).toFixed(4))
  };
}

export function detectBetaExpansion(holdings = []) {
  const avgBeta = holdings.reduce((acc, h) => acc + (Number(h.beta) || 1), 0) / Math.max(holdings.length, 1);
  return Number(clamp((avgBeta - 1) / 0.8, 0, 1).toFixed(4));
}

export function detectVolatilityThreat(holdings = []) {
  const avgVol = holdings.reduce((acc, h) => acc + (Number(h.volatility) || 0.2), 0) / Math.max(holdings.length, 1);
  return Number(clamp((avgVol - 0.22) / 0.25, 0, 1).toFixed(4));
}

export function calculatePortfolioThreatScore({ concentrationRisk, correlationClusters, sectorOverexposure, betaExpansion, volatilityThreat, regimeDanger }) {
  return Number(clamp(
    concentrationRisk * 0.22 +
    correlationClusters.score * 0.2 +
    sectorOverexposure.score * 0.16 +
    betaExpansion * 0.14 +
    volatilityThreat * 0.13 +
    regimeDanger * 0.15,
    0,
    1
  ).toFixed(4));
}

async function fetchPortfolioPositions() {
  const { data, error } = await supabase
    .from("portfolio_positions")
    .select("*");

  if (error) {
    console.warn("[PORTFOLIO SURVEILLANCE] Failed to fetch portfolio_positions:", error.message);
    return [];
  }

  return data || [];
}

async function fetchHoldingTelemetry(ticker) {
  const live = await getLiveMarketData(ticker).catch(() => ({}));
  const price = toNum(live.currentPrice, 0);
  const previous = toNum(live.previousClose || live.previousclose, price || 1);
  const change = previous > 0 ? (price - previous) / previous : 0;

  const volatility = clamp(Math.abs(change) * 4 + 0.16, 0.05, 0.8);
  const momentum = clamp((change * 4) + 0.55, 0, 1.5);
  const volumeTrend = clamp(toNum(live.volumeRatio, 1) - 1, -1, 1);

  return {
    currentPrice: price,
    volatility,
    trendQuality: clamp((change + 0.04) / 0.08, 0, 1),
    momentum,
    volumeTrend,
    priceTrend: clamp(change * 8, -1, 1),
    rsi: clamp(50 + change * 120, 20, 85),
    supportFailure: change < -0.035,
    downsideAsymmetry: clamp((volatility * 0.6) + (change < 0 ? Math.abs(change) * 4 : 0), 0, 1),
    momentumSlope: change * 2,
    momentumAcceleration: change,
    trendExtension: clamp((price - toNum(live.sma50, price)) / Math.max(price, 1), -0.3, 0.5),
    atr: Math.max(0.01, price * volatility * 0.4),
    resistanceLevels: [price * 1.03, price * 1.06, price * 1.1]
  };
}

function determineUrgency(action, dangerScore) {
  if (action === "FULL_EXIT" || dangerScore > 0.78) return "CRITICAL";
  if (action === "DEFENSIVE_EXIT" || dangerScore > 0.6) return "HIGH_PRIORITY";
  if (action === "PARTIAL_EXIT" || action === "TRIM") return "WARNING";
  return "INFO";
}

export function evaluatePortfolioHealth(enrichedHoldings = [], regime = {}) {
  if (!enrichedHoldings.length) {
    return {
      portfolioHealthScore: 0,
      dangerScore: 0,
      trendMaturityScore: 0,
      defensiveActionScore: 0
    };
  }

  const avgTrend = enrichedHoldings.reduce((acc, h) => acc + (h.trendQuality || 0), 0) / enrichedHoldings.length;
  const avgMaturity = enrichedHoldings.reduce((acc, h) => acc + (h.trendMaturityScore || 0), 0) / enrichedHoldings.length;
  const avgDownside = enrichedHoldings.reduce((acc, h) => acc + (h.downsideAsymmetry || 0), 0) / enrichedHoldings.length;
  const avgDistribution = enrichedHoldings.reduce((acc, h) => acc + (h.distributionProbability || 0), 0) / enrichedHoldings.length;

  const health = clamp(avgTrend * 0.5 + (1 - avgDownside) * 0.3 + (1 - avgDistribution) * 0.2, 0, 1);
  const danger = clamp((1 - health) * 0.55 + avgMaturity * 0.2 + avgDownside * 0.15 + (regime.dangerScore || 0) * 0.1, 0, 1);
  const defensiveScore = clamp(danger * 0.6 + (regime.dangerScore || 0) * 0.4, 0, 1);

  return {
    portfolioHealthScore: Number((health * 100).toFixed(2)),
    dangerScore: Number((danger * 100).toFixed(2)),
    trendMaturityScore: Number((avgMaturity * 100).toFixed(2)),
    defensiveActionScore: Number((defensiveScore * 100).toFixed(2))
  };
}

export function detectUrgentPortfolioChanges(alerts = []) {
  const urgent = alerts.filter((a) => a.urgency === "CRITICAL" || a.urgency === "HIGH_PRIORITY");
  return {
    urgent,
    hasUrgentChanges: urgent.length > 0
  };
}

async function persistPortfolioHistory(snapshot = {}) {
  const { error } = await supabase.from("portfolio_history").insert({
    portfolio_value: snapshot.portfolioValue,
    drawdown: snapshot.drawdown,
    volatility: snapshot.volatility,
    concentration: snapshot.concentration,
    heat_score: snapshot.heatScore,
    created_at: new Date().toISOString()
  });

  if (error) {
    console.warn("[PORTFOLIO SURVEILLANCE] Failed to persist history:", error.message);
  }
}

async function updatePortfolioPositions(holdings = []) {
  if (!holdings.length) return;

  const rows = holdings.map((h) => ({
    ticker: h.ticker,
    quantity: h.quantity,
    avg_price: h.avgPrice,
    current_price: h.currentPrice,
    unrealized_pnl: h.unrealizedPnL,
    sector: h.sector,
    beta: h.beta,
    volatility: h.volatility,
    trend_state: h.state,
    risk_score: h.riskScore
  }));

  const { error } = await supabase
    .from("portfolio_positions")
    .upsert(rows, { onConflict: "ticker" });

  if (error) {
    console.warn("[PORTFOLIO SURVEILLANCE] Failed to upsert positions:", error.message);
  }
}

export async function monitorPortfolioEvery10Minutes() {
  const positions = await fetchPortfolioPositions();
  if (!positions.length) {
    return {
      holdings: [],
      alerts: [],
      health: evaluatePortfolioHealth([])
    };
  }

  const regime = detectMarketRegime({
    breadth: 0.52,
    indexTrend: 0.1,
    vix: 20,
    volatilityTrend: 0.9,
    defensiveStrength: 0.45,
    cyclicalWeakness: 0.4,
    bidAskSpread: 0.002
  });

  const enriched = await Promise.all(positions.map(async (raw) => {
    const ticker = raw.ticker;
    const telemetry = await fetchHoldingTelemetry(ticker);
    const marketValue = toNum(telemetry.currentPrice) * toNum(raw.quantity);
    const unrealizedPnL = (toNum(telemetry.currentPrice) - toNum(raw.avg_price)) * toNum(raw.quantity);
    const volatilityExpansion = calculateVolatilityExpansion(telemetry.volatility, toNum(raw.volatility, 0.18));

    const base = {
      ticker,
      quantity: toNum(raw.quantity),
      avgPrice: toNum(raw.avg_price),
      baselineVolatility: toNum(raw.volatility, 0.18),
      sector: raw.sector || "UNKNOWN",
      beta: toNum(raw.beta, 1),
      correlationRisk: clamp(toNum(raw.correlation_risk, 0.35), 0, 1),
      ...telemetry,
      volatilityExpansion,
      marketValue,
      unrealizedPnL,
      unrealizedProfitPct: calculateProfitCapture(toNum(raw.avg_price), telemetry.currentPrice)
    };

    const distributionProbability = detectInstitutionalDistribution(base);
    const trendMaturityScore = calculateTrendMaturity(base);
    const state = classifyPositionState({
      ...base,
      distributionProbability,
      trendMaturityScore
    });
    const riskScore = calculateRiskExposure({
      weight: 0.1,
      beta: base.beta,
      volatility: base.volatility,
      downsideProbability: base.downsideAsymmetry
    });

    return {
      ...base,
      distributionProbability,
      trendMaturityScore,
      state,
      riskScore
    };
  }));

  const totalValue = enriched.reduce((acc, h) => acc + h.marketValue, 0) || 1;
  const enrichedWithWeights = enriched.map((h) => ({ ...h, weight: h.marketValue / totalValue }));

  const concentrationRisk = detectConcentrationRisk(enrichedWithWeights);
  const correlationClusters = detectCorrelationClusters(enrichedWithWeights);
  const sectorOverexposure = detectSectorOverexposure(enrichedWithWeights);
  const betaExpansion = detectBetaExpansion(enrichedWithWeights);
  const volatilityThreat = detectVolatilityThreat(enrichedWithWeights);

  const threatScore = calculatePortfolioThreatScore({
    concentrationRisk,
    correlationClusters,
    sectorOverexposure,
    betaExpansion,
    volatilityThreat,
    regimeDanger: regime.dangerScore
  });

  const threat = {
    portfolioThreatScore: threatScore,
    concentrationRisk,
    correlationClusters,
    sectorOverexposure,
    betaExpansion,
    volatilityThreat,
    marketBreadth: 0.52,
    portfolioVolatility: enrichedWithWeights.reduce((acc, h) => acc + h.volatility * h.weight, 0),
    downsideProbability: clamp(threatScore * 0.9, 0, 1)
  };

  const exitDecisions = enrichedWithWeights.map((holding) => analyzeExitOpportunity(holding, regime, threat));

  const alerts = exitDecisions.map((exit, idx) => {
    const holding = enrichedWithWeights[idx];
    const urgency = determineUrgency(exit.action, threatScore);

    return generatePortfolioAlert({
      ticker: holding.ticker,
      action: exit.action,
      sellQuantity: exit.quantity,
      urgency,
      confidence: exit.confidence,
      trendState: holding.state,
      mathematicalReasoning: exit.reasoning,
      portfolioImpact: `Heat -${exit.concentrationRiskReductionPct}% | Vol -${exit.portfolioImprovement.portfolioVolatilityReductionPct}%`,
      marketRegime: regime.state,
      downsideProbability: threat.downsideProbability,
      expectedCorrection: exit.expectedDownsidePct,
      capitalProtectionBenefit: exit.capitalProtectionBenefitPct,
      dangerScore: threatScore
    });
  });

  const rankedAlerts = rankPortfolioThreats(alerts);

  await updatePortfolioPositions(enrichedWithWeights);
  await persistPortfolioAlerts(rankedAlerts);
  await persistPortfolioHistory({
    portfolioValue: Number(totalValue.toFixed(2)),
    drawdown: Number((threat.downsideProbability * 100).toFixed(2)),
    volatility: Number((threat.portfolioVolatility * 100).toFixed(2)),
    concentration: Number((concentrationRisk * 100).toFixed(2)),
    heatScore: Number((threatScore * 100).toFixed(2))
  });

  const urgent = detectUrgentPortfolioChanges(rankedAlerts);
  if (urgent.hasUrgentChanges) {
    await Promise.all(urgent.urgent.map((a) => sendUrgentExitAlert(a)));
  }

  return {
    regime,
    threat,
    holdings: enrichedWithWeights,
    alerts: rankedAlerts,
    health: evaluatePortfolioHealth(enrichedWithWeights, regime)
  };
}

export async function startPortfolioMonitoring() {
  return monitorPortfolioEvery10Minutes();
}

export function schedulePortfolioSurveillance() {
  cron.schedule("*/10 * * * *", async () => {
    await monitorPortfolioEvery10Minutes().catch((error) => {
      console.error("[PORTFOLIO SURVEILLANCE] cycle failed:", error?.message || error);
    });
  }, {
    timezone: "Asia/Kolkata"
  });
}

import {
  buildTickerThesis,
  classifyConviction,
  computeConvictionScore,
  computeFundamentalsScore,
  computeNewsScore,
  computeRelativeStrengthScore,
  computeSectorScore,
  normalizeSector,
  toNumber
} from "./convictionEngine.js";
import { buildVolatilitySetup } from "./volatilityEngine.js";

function inferRelativeStrength(stockAnalysis = {}) {
  const reason = String(stockAnalysis?.decision?.reason || "").toUpperCase();
  if (reason.includes("OUTPERFORM") || reason.includes("STRONG")) return "OUTPERFORM";
  if (reason.includes("UNDERPERFORM") || reason.includes("WEAK")) return "UNDERPERFORM";
  return "NEUTRAL";
}

function inferInvestorType({ convictionScore, rr, volatilityBand }) {
  if (convictionScore >= 8 && rr >= 2) return "SWING";
  if (volatilityBand === "HIGH") return "TACTICAL";
  return "POSITIONAL";
}

export function buildRankedStock({
  ticker,
  companyData,
  analysis,
  newsIntel,
  sectorBias = "NEUTRAL"
}) {
  const technical = analysis?.technical || {};
  const currentPrice = Number(analysis?.entryTiming?.currentPrice || technical?.currentPrice || 0);
  const fundamentalsScore = computeFundamentalsScore(companyData);
  const relativeStrength = inferRelativeStrength(analysis);
  const relativeStrengthScore = computeRelativeStrengthScore(relativeStrength);
  const newsScore = computeNewsScore(newsIntel?.sentiment);
  const sectorScore = computeSectorScore(sectorBias);
  const volatilitySetup = buildVolatilitySetup({
    ticker,
    currentPrice,
    technicalData: technical
  });

  const convictionScore = computeConvictionScore({
    trend: technical?.trend || "NEUTRAL",
    rsi: technical?.rsi || 50,
    volumeRatio: technical?.volumeRatio || 1,
    sectorScore,
    fundamentalsScore,
    newsScore,
    relativeStrengthScore
  });

  const ranked = {
    ticker,
    convictionScore,
    conviction: classifyConviction(convictionScore),
    trend: technical?.trend || "NEUTRAL",
    sector: normalizeSector(companyData?.Sector),
    currentPrice: Number(currentPrice.toFixed(2)),
    rsi: Number(technical?.rsi || 50),
    volumeRatio: Number(toNumber(technical?.volumeRatio || 1).toFixed(2)),
    relativeStrength,
    stopLoss: volatilitySetup.stopLoss,
    target1: volatilitySetup.target1,
    target2: volatilitySetup.target2,
    rr: volatilitySetup.rr,
    newsSentiment: newsIntel?.sentiment || "NEUTRAL",
    catalysts: newsIntel?.catalysts || [],
    thesis: "",
    investorType: inferInvestorType({
      convictionScore,
      rr: volatilitySetup.rr,
      volatilityBand: volatilitySetup.volatilityBand
    }),
    riskLevel: analysis?.risk?.riskLevel || "MEDIUM",
    volatilityBand: volatilitySetup.volatilityBand,
    idealEntryZone: volatilitySetup.idealEntryZone,
    entryUrgency: analysis?.entryTiming?.entryUrgency || "LOW",
    decision: analysis?.decision?.finalDecision || "HOLD",
    fundamentalsScore,
    sectorScore,
    newsScore,
    relativeStrengthScore
  };

  ranked.thesis = buildTickerThesis(ranked);
  return ranked;
}

export function rankAndDiversifyStocks(stocks = [], { limit = 5, maxPerSector = 2 } = {}) {
  const sorted = [...stocks].sort((a, b) => {
    if (b.convictionScore !== a.convictionScore) return b.convictionScore - a.convictionScore;
    if (b.rr !== a.rr) return b.rr - a.rr;
    return b.fundamentalsScore - a.fundamentalsScore;
  });

  const sectorCounts = new Map();
  const selected = [];

  for (const stock of sorted) {
    if (stock.convictionScore < 5) continue;
    const count = sectorCounts.get(stock.sector) || 0;
    if (count >= maxPerSector) continue;
    selected.push(stock);
    sectorCounts.set(stock.sector, count + 1);
    if (selected.length >= limit) break;
  }

  return selected;
}

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

import { increment } from "../services/telemetryAggregator.service.js";

function inferRelativeStrength(stockAnalysis = {}) {
  const reason = String(stockAnalysis?.decision?.reason || "").toUpperCase();
  if (reason.includes("OUTPERFORM") || reason.includes("STRONG")) return "OUTPERFORM";
  if (reason.includes("UNDERPERFORM") || reason.includes("WEAK")) return "UNDERPERFORM";
  return "NEUTRAL";
}

function inferInvestorType({ convictionScore, rr, volatilityBand }) {
  if (convictionScore >= 80 && rr >= 2) return "SWING";
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
  if (!volatilitySetup) {
    increment('scanner.rejected.bad_volatility');
    return null;
  }

  // ─── PURIFICATION FILTERS (PHASE 8 & PHASE 1) ───────────────────────────────────
  // 1. Invalid Price Reject
  if (currentPrice <= 0 || isNaN(currentPrice)) {
    increment('scanner.rejected.invalid_price');
    return null;
  }

  // 2. Hard Minimum R/R Filter (relaxed for weaker/sideways regimes)
  if (volatilitySetup.rr < 1.1) {
    increment('scanner.rejected.low_rr');
    return null;
  }

  // 3. Thin Liquidity (NSE large-caps can still be actionable below 1.0x)
  const volRatio = Number(toNumber(technical?.volumeRatio || 1).toFixed(2));
  if (volRatio < 0.85) {
    increment('scanner.rejected.bad_volatility');
    return null;
  }

  // 4. Broken Trend Structure - reject only very weak asymmetry in bearish regime
  if (technical?.trend === "BEARISH" && volatilitySetup.rr < 1.35) {
    increment('scanner.rejected.low_conviction');
    return null;
  }

  // 5. Excessive ATR stop widths (stop loss is >8% away from currentPrice)
  const stopDistance = currentPrice - volatilitySetup.stopLoss;
  if (stopDistance / currentPrice > 0.08) {
    increment('scanner.rejected.bad_volatility');
    return null;
  }

  // 6. Weak Sector Momentum (sectorScore < 5.0)
  if (sectorScore < 5.0) {
    increment('scanner.rejected.weak_sector');
    return null;
  }

  // ─── REBALANCED WEIGHT MODEL (PHASE 3) ──────────────────────────────────────────
  // finalScore = (rrScore * 0.30) + (trendScore * 0.20) + (institutionalFlowScore * 0.15) + (sectorStrength * 0.10) + (volumeExpansion * 0.10) + (volatilityQuality * 0.10) + (newsCatalyst * 0.05)
  
  // 1. R/R Score (30%)
  const rr = volatilitySetup.rr;
  let rrScore = 50;
  if (rr >= 3.0) rrScore = 100;
  else if (rr >= 2.5) rrScore = 90;
  else if (rr >= 2.0) rrScore = 80;
  else if (rr >= 1.5) rrScore = 70;
  else rrScore = rr * 30;

  // 2. Trend Score (20%)
  let trendScore = 50;
  const ts = volatilitySetup.trendStrength || 5;
  const trend = technical?.trend || "NEUTRAL";
  if (trend === "BULLISH") {
    trendScore = 60 + ts * 4;
  } else if (trend === "BEARISH") {
    trendScore = 30 - ts * 2;
  } else {
    trendScore = 50;
  }
  trendScore = Math.min(100, Math.max(0, trendScore));

  // 3. Institutional Flow Score (15%)
  let institutionalFlowScore = 60;
  if (relativeStrength === "OUTPERFORM") institutionalFlowScore += 20;
  if (relativeStrength === "UNDERPERFORM") institutionalFlowScore -= 20;
  if (volRatio >= 1.5) institutionalFlowScore += 15;
  if (volRatio >= 1.2) institutionalFlowScore += 5;
  institutionalFlowScore = Math.min(100, Math.max(0, institutionalFlowScore));

  // 4. Sector Strength Score (10%)
  const sectorStrength = sectorScore * 10;

  // 5. Volume Expansion Score (10%)
  let volumeExpansion = 50;
  if (volRatio >= 1.8) volumeExpansion = 100;
  else if (volRatio >= 1.5) volumeExpansion = 90;
  else if (volRatio >= 1.2) volumeExpansion = 80;
  else if (volRatio >= 1.0) volumeExpansion = 70;
  else volumeExpansion = volRatio * 60;
  volumeExpansion = Math.min(100, Math.max(0, volumeExpansion));

  // 6. Volatility Quality Score (10%)
  let volatilityQuality = 70;
  if (volatilitySetup.atrCompression) volatilityQuality = 85;
  if (volatilitySetup.volatilityBand === "MEDIUM") volatilityQuality = 80;
  if (volatilitySetup.volatilityBand === "HIGH") volatilityQuality = 60;
  if (volatilitySetup.volatilityBand === "LOW") volatilityQuality = 75;

  // 7. News Catalyst Score (5%)
  const newsCatalyst = newsScore * 10;

  const convictionScore = Math.round(
    (rrScore * 0.30) +
    (trendScore * 0.20) +
    (institutionalFlowScore * 0.15) +
    (sectorStrength * 0.10) +
    (volumeExpansion * 0.10) +
    (volatilityQuality * 0.10) +
    (newsCatalyst * 0.05)
  );

  // 7. Low Conviction Reject
  if (convictionScore < 40) {
    increment('scanner.rejected.low_conviction');
    return null;
  }

  // ─── TRADE QUALITY CLASSIFICATION (PHASE 4) ─────────────────────────────────────
  let tradeQuality = "AVOID";
  if (rr >= 3 && convictionScore >= 80) {
    tradeQuality = "INSTITUTIONAL";
  } else if (rr >= 2) {
    tradeQuality = "HIGH_QUALITY";
  } else if (rr >= 1.5) {
    tradeQuality = "SPECULATIVE";
  } else {
    tradeQuality = "AVOID";
  }

  // AVOID trades NEVER shown
  if (tradeQuality === "AVOID") {
    return null;
  }

  // ─── EXPLAINABILITY ENGINE (PHASE 7) ─────────────────────────────────────────────
  const whyThisTradeRanked = [];
  if (relativeStrength === "OUTPERFORM") {
    whyThisTradeRanked.push("High relative strength breakout");
  }
  if (volRatio >= 1.5) {
    whyThisTradeRanked.push("Strong institutional accumulation");
  }
  if (sectorScore >= 7.4) {
    whyThisTradeRanked.push("Sector momentum ranked top 3");
  }
  if (volatilitySetup.rr >= 2.5) {
    whyThisTradeRanked.push("Excellent asymmetrical structure");
  }
  if (volatilitySetup.atrCompression) {
    whyThisTradeRanked.push("Volatility compression squeeze");
  } else if (volatilitySetup.volatilityBand === "LOW" || volatilitySetup.volatilityBand === "MEDIUM") {
    whyThisTradeRanked.push("Healthy volatility expansion");
  }
  if (technical?.trend === "BULLISH" && ts >= 7) {
    whyThisTradeRanked.push("Strong multi-TF bullish alignment");
  }
  
  if (whyThisTradeRanked.length === 0) {
    whyThisTradeRanked.push("Constructive technical setup");
    whyThisTradeRanked.push("Positive reward-to-risk profile");
  }

  const ranked = {
    ticker,
    convictionScore: convictionScore,
    convictionScore10: Number((convictionScore / 10).toFixed(1)),
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
    target3: volatilitySetup.target3,
    rr: volatilitySetup.rr,
    trendStrength: ts,
    approved: true,
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
    strategy: analysis?.entryTiming?.strategy || "",
    momentumConfirmed: Boolean(analysis?.entryTiming?.momentumConfirmed ?? volatilitySetup.momentumConfirmed),
    allocation: String(analysis?.allocation || "0%"),
    decision: analysis?.decision?.finalDecision || "HOLD",
    fundamentalsScore,
    sectorScore,
    newsScore,
    relativeStrengthScore,
    
    // Engine breakdown components
    rrScore,
    trendScore,
    institutionalFlowScore,
    sectorStrength,
    volumeExpansion,
    volatilityQuality,
    newsCatalyst,
    tradeQuality,
    whyThisTradeRanked,

    // Layout extra items
    multiTfAlignment: technical?.trend === "BULLISH" ? "YES" : "NO",
    momentumState: technical?.rsi >= 60 ? "ACCELERATING" : technical?.rsi >= 50 ? "STABLE" : "CONSOLIDATING",
    smartMoneyBias: relativeStrength === "OUTPERFORM" ? "BULLISH" : "NEUTRAL",
    deliveryStrength: volRatio >= 1.5 ? "HIGH" : "MODERATE",
    volumeExpansionPct: Math.round((volRatio - 1) * 100),
    sectorRank: sectorScore >= 8 ? "#1" : sectorScore >= 7 ? "#2" : sectorScore >= 6 ? "#3" : "#4",
    sectorMomentum: sectorBias === "STRONG_BULLISH" ? "STRONG" : sectorBias === "BULLISH" ? "MODERATE" : "STABLE",
    atrStructure: volatilitySetup.volatilityBand === "HIGH" ? "ELEVATED" : "HEALTHY",
    compressionExpansion: volatilitySetup.atrCompression ? "COMPRESSION" : "BREAKOUT",
    riskState: volatilitySetup.volatilityBand === "HIGH" ? "MONITORED" : "CONTROLLED",
    catalystBias: newsScore >= 7 ? "POSITIVE" : newsScore >= 5 ? "NEUTRAL" : "NEGATIVE",
    macroCorrelation: sectorBias === "STRONG_BULLISH" ? "SUPPORTIVE" : "BALANCED",
    capitalEfficiency: volatilitySetup.rr >= 2 ? "HIGH" : "MEDIUM",
    asymmetryRating: volatilitySetup.rr >= 2.5 ? "STRONG" : "FAVORABLE",
    institutionalGrade: tradeQuality === "INSTITUTIONAL" ? "YES" : "NO",
    finalVerdict: tradeQuality === "INSTITUTIONAL"
      ? "HIGH PROBABILITY CONTINUATION SETUP"
      : tradeQuality === "HIGH_QUALITY"
      ? "ASYMMETRIC BREAKOUT CONFIRMED"
      : "TACTICAL SWING ENTRY"
  };

  ranked.thesis = buildTickerThesis(ranked);
  return ranked;
}

export function rankAndDiversifyStocks(stocks = [], { limit = 5, maxPerSector = 2 } = {}) {
  const sorted = [...stocks].sort((a, b) => {
    if ((b.convictionScore || 0) !== (a.convictionScore || 0)) return (b.convictionScore || 0) - (a.convictionScore || 0);
    if (b.rr !== a.rr) return b.rr - a.rr;
    return b.fundamentalsScore - a.fundamentalsScore;
  });

  const sectorCounts = new Map();
  const selected = [];

  for (const stock of sorted) {
    if (!stock) continue;
    if ((stock.convictionScore || 0) < 50) continue;
    const count = sectorCounts.get(stock.sector) || 0;
    if (count >= maxPerSector) continue;
    selected.push(stock);
    sectorCounts.set(stock.sector, count + 1);
    if (selected.length >= limit) break;
  }

  return selected;
}

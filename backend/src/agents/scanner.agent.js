import supabase from "../services/supabase.service.js";
import { masterAgent } from "./master.agent.js";
import { getMarketOverview } from "../scanner/marketOverview.js";
import { buildTickerNewsIntel } from "../scanner/newsEngine.js";
import { buildSectorRotation } from "../scanner/sectorRotation.js";
import { buildInstitutionalFlows } from "../scanner/institutionalFlows.js";
import { buildWatchlists } from "../scanner/watchlistEngine.js";
import { buildRankedStock, rankAndDiversifyStocks } from "../scanner/stockRanker.js";
import { formatMorningScannerReport } from "../scanner/scannerFormatter.js";
import { shouldRejectSignal, validateSignal } from "../scanner/signalGuards.js";
import { normalizeSector } from "../scanner/convictionEngine.js";
import { buildAnalysisContext } from "../core/analysisContext.js";
import { getHistoricalCandles, getLiveMarketData } from "../services/marketData.service.js";
import { logEvent } from "../services/telemetry.service.js";
import { safeArray, safeObject } from "../utils/safeArray.js";
import {
  recordScannerStageFailure,
  recordScannerSuccess,
  recordNoActionableSetups
} from "../services/telemetryAggregator.service.js";

const STOCK_UNIVERSE = [
  "ADANIENT", "ADANIPORTS", "APOLLOHOSP", "ASIANPAINT", "AXISBANK",
  "BAJAJ-AUTO", "BAJFINANCE", "BAJAJFINSV", "BHARTIARTL", "BPCL",
  "BRITANNIA", "CIPLA", "COALINDIA", "DIVISLAB", "DRREDDY",
  "EICHERMOT", "GRASIM", "HCLTECH", "HDFCBANK", "HDFCLIFE",
  "HEROMOTOCO", "HINDALCO", "HINDUNILVR", "ICICIBANK", "INDUSINDBK",
  "INFY", "ITC", "JSWSTEEL", "KOTAKBANK", "LT",
  "LTIM", "M&M", "MARUTI", "NESTLEIND", "NTPC",
  "ONGC", "POWERGRID", "RELIANCE", "SBILIFE", "SBIN",
  "SHRIRAMFIN", "SUNPHARMA", "TATACONSUM", "TATAMOTORS", "TATASTEEL",
  "TCS", "TECHM", "TITAN", "ULTRACEMCO", "WIPRO"
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function mapWithConcurrency(items, worker, maxConcurrency = 3) {
  const safeItems = Array.isArray(items) ? items : [];
  if (safeItems.length === 0) return [];
  const results = [];
  let cursor = 0;
  const runners = Array.from({ length: Math.min(maxConcurrency, safeItems.length) }).map(async () => {
    while (cursor < safeItems.length) {
      const index = cursor++;
      results[index] = await worker(safeItems[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

/**
 * Layer 1: Cheap Pre-Filter (No Groq/AI)
 * Uses market data to score stocks and shortlist candidates
 */
async function getShortlistedStocks(limit = 10) {
  console.log(`📊 Layer 1: Pre-filtering ${STOCK_UNIVERSE.length} stocks...`);
  const candidates = [];

  await mapWithConcurrency(STOCK_UNIVERSE, async (symbol) => {
    try {
      await sleep(Math.floor(Math.random() * 180) + 60);
      const [marketData, history] = await Promise.all([
        getLiveMarketData(symbol),
        getHistoricalCandles(symbol, { days: 260, interval: "1d" })
      ]);
      console.log("=== MARKET DATA RECEIVED ===");
      console.log(symbol, marketData?.currentPrice ?? marketData?.price ?? null);
      if (!Array.isArray(history) || history.length < 50 || !marketData?.currentPrice) return;

      const prices = history.map((candle) => Number(candle?.close || 0)).filter((value) => value > 0);
      const highs = history.map((candle) => Number(candle?.high || 0)).filter((value) => value > 0);
      const volumes = history.map((candle) => Number(candle?.volume || 0)).filter((value) => value > 0);
      if (!prices.length || !highs.length) return;

      const currentPrice = Number(marketData.currentPrice || prices[prices.length - 1] || 0);
      const fiftyTwoWeekHigh = Math.max(...highs);
      const averageDailyVolume3Month = volumes.slice(-60).reduce((sum, value) => sum + value, 0) / Math.max(volumes.slice(-60).length, 1);
      const regularMarketVolume = Number(history[history.length - 1]?.volume || 0);
      const fiftyDayAverage = prices.slice(-50).reduce((sum, value) => sum + value, 0) / Math.max(prices.slice(-50).length, 1);
      const twoHundredDayAverage = prices.slice(-200).reduce((sum, value) => sum + value, 0) / Math.max(prices.slice(-200).length, 1);
      const previousClose = Number(marketData.previousClose || prices[prices.length - 2] || currentPrice);
      const changePercent = previousClose > 0
        ? ((currentPrice - previousClose) / previousClose) * 100
        : Number(marketData.change || 0);
      
      let score = 0;

      if (fiftyTwoWeekHigh > 0) {
        const proximity = currentPrice / fiftyTwoWeekHigh;
        if (proximity > 0.98) score += 25;
        else if (proximity > 0.95) score += 15;
      }

      if (averageDailyVolume3Month > 0) {
        const volRatio = regularMarketVolume / averageDailyVolume3Month;
        if (volRatio > 1.2) score += 25;
        else if (volRatio > 1.0) score += 15;
      }

      if (fiftyDayAverage > 0 && currentPrice > fiftyDayAverage) score += 10;
      if (twoHundredDayAverage > 0 && currentPrice > twoHundredDayAverage) score += 15;
      if (changePercent > 2) score += 15;
      else if (changePercent > 0) score += 5;

      candidates.push({ symbol, score, price: currentPrice });
    } catch (err) {
      // Skip failed quotes
    }
  }, 3);

  return candidates
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function adaptRankedStockToLegacyFormat(stock) {
  if (!stock) return {};
  const validation = validateSignal({
    rewardRiskRatio: stock.rr,
    confidenceScore: stock.convictionScore,
    decision: stock.decision,
    volumeRatio: stock.volumeRatio,
    rsi: stock.rsi,
    currentPrice: stock.currentPrice,
    stopLoss: stock.stopLoss,
    idealEntryZone: stock.idealEntryZone,
    trend: stock.trend,
    momentumConfirmed: stock.momentumConfirmed,
    allocation: stock.allocation,
    strategy: stock.strategy
  });
  return {
    stock: stock.ticker || "Unknown",
    sector: stock.sector || "Unknown",
    decision: stock.decision || "HOLD",
    confidenceScore: stock.convictionScore ?? 0,
    confidenceScore10: stock.convictionScore10 ?? Number(((stock.convictionScore || 0) / 10).toFixed(1)),
    priorityLevel: stock.conviction || "LOW",
    allocation: stock.allocation || "0%",
    entrySignal: stock.conviction === "HIGH" ? "STRONG ENTRY" : stock.conviction === "MEDIUM" ? "CAUTIOUS ENTRY" : "AVOID ENTRY",
    entryUrgency: stock.entryUrgency || "LOW",
    currentPrice: stock.currentPrice ?? 0,
    idealEntryZone: stock.idealEntryZone || "NA",
    stopLoss: stock.stopLoss ? (Number.isFinite(Number(stock.stopLoss)) ? `₹${Math.round(stock.stopLoss)}` : stock.stopLoss) : "NA",
    initialTarget: stock.target1 ? (Number.isFinite(Number(stock.target1)) ? `₹${Math.round(stock.target1)}` : stock.target1) : "NA",
    target2: stock.target2 ? (Number.isFinite(Number(stock.target2)) ? `₹${Math.round(stock.target2)}` : stock.target2) : "NA",
    target3: stock.target3 ? (Number.isFinite(Number(stock.target3)) ? `₹${Math.round(stock.target3)}` : stock.target3) : "NA",
    rewardRiskRatio: stock.rr ?? 0,
    volumeRatio: stock.volumeRatio ?? 0,
    rsi: stock.rsi ?? 50,
    trend: stock.trend || "NEUTRAL",
    momentumConfirmed: Boolean(stock.momentumConfirmed),
    strategy: stock.strategy || "",
    approved: validation.approved,
    rejectionReasons: validation.reasons,
    entryReasoning: stock.thesis || "",
    finalExecutionAdvice:
      stock.conviction === "HIGH"
        ? `Focus on ${stock.idealEntryZone || "NA"} with defined risk below ₹${Math.round(stock.stopLoss || 0)}.`
        : stock.conviction === "MEDIUM"
        ? `Scale in selectively and respect volatility at current levels.`
        : `Keep on watchlist only until setup quality improves.`,
    decisionReasoning: stock.thesis || "",
    recommendedAction:
      stock.conviction === "HIGH"
        ? "Build position gradually"
        : stock.conviction === "MEDIUM"
        ? "Start partial accumulation"
        : "Monitor and wait",
    newsSentiment: stock.newsSentiment || "NEUTRAL",
    catalysts: Array.isArray(stock.catalysts) ? stock.catalysts : [],
    investorType: stock.investorType || "RETAIL",
    
    // Institutional parameters carried through
    tradeQuality: stock.tradeQuality,
    whyThisTradeRanked: stock.whyThisTradeRanked,
    rrScore: stock.rrScore,
    trendScore: stock.trendScore,
    multiTfAlignment: stock.multiTfAlignment,
    momentumState: stock.momentumState,
    smartMoneyBias: stock.smartMoneyBias,
    deliveryStrength: stock.deliveryStrength,
    volumeExpansionPct: stock.volumeExpansionPct,
    sectorRank: stock.sectorRank,
    sectorMomentum: stock.sectorMomentum,
    atrStructure: stock.atrStructure,
    compressionExpansion: stock.compressionExpansion,
    riskState: stock.riskState,
    catalystBias: stock.catalystBias,
    macroCorrelation: stock.macroCorrelation,
    capitalEfficiency: stock.capitalEfficiency,
    asymmetryRating: stock.asymmetryRating,
    institutionalGrade: stock.institutionalGrade,
    finalVerdict: stock.finalVerdict
  };
}

export async function runMorningScannerPipeline(limit = 5) {
  console.log("=== SCANNER RUNNING ===");
  console.log("Time:", new Date().toISOString());
  console.log("🔍 Running Institutional Morning Intelligence Pipeline...");

  const marketOverview = await getMarketOverview();
  const shortlisted = await getShortlistedStocks(10) || [];
  console.log(`✅ Shortlisted: ${(Array.isArray(shortlisted) ? shortlisted : []).map((s) => s.symbol).join(", ")} (Count: ${shortlisted?.length || 0})`);

  const rawCandidates = [];
  const rankedCandidates = [];

  const safeShortlisted = Array.isArray(shortlisted) ? shortlisted : [];
  for (const item of safeShortlisted) {
    try {
      console.log(`🧠 Deep Scanning: ${item.symbol}`);
      const { stockData: companyData } = await buildAnalysisContext(item.symbol);
      const analysis = await masterAgent(companyData);
      console.log("=== AI ANALYSIS COMPLETE ===");
      console.log(analysis);
      const newsIntel = await buildTickerNewsIntel({
        ticker: item.symbol,
        companyName: companyData?.Name
      });

      if (!analysis?.validation?.approved) {
        console.log(
          "[FILTERED REJECTED SIGNAL]",
          item.symbol,
          analysis?.validation?.reason || "validation_not_approved"
        );
        continue;
      }

      const rankedStock = buildRankedStock({
        ticker: item.symbol,
        companyData,
        analysis,
        newsIntel
      });

      if (rankedStock) {
        const rankedValidation = validateSignal({
          rewardRiskRatio: rankedStock.rr,
          confidenceScore: rankedStock.convictionScore,
          decision: rankedStock.decision,
          volumeRatio: rankedStock.volumeRatio,
          rsi: rankedStock.rsi,
          currentPrice: rankedStock.currentPrice,
          stopLoss: rankedStock.stopLoss,
          idealEntryZone: rankedStock.idealEntryZone,
          trend: rankedStock.trend,
          trendStrength: rankedStock.trendStrength,
          momentumConfirmed: rankedStock.momentumConfirmed,
          allocation: rankedStock.allocation,
          strategy: rankedStock.strategy
        });
        if (!rankedValidation.approved) {
          console.log("[FILTERED REJECTED SIGNAL]", item.symbol, rankedValidation.reasons.join(","));
          continue;
        }
        rawCandidates.push({
          ticker: item.symbol,
          companyData,
          analysis,
          newsIntel
        });
        rankedCandidates.push(rankedStock);
      } else {
        console.log(`⚠️ Deep Scan candidate ${item.symbol} rejected/filtered by institutional rules.`);
      }
    } catch (error) {
      console.log(`Deep scan failed for ${item.symbol}:`, error.message);
    }
  }

  let sectorRotation = [];
  try {
    sectorRotation = await buildSectorRotation({
      rankedStocks: rankedCandidates,
      marketSectorSnapshot: marketOverview?.sectors || {}
    }) || [];
  } catch (sectorErr) {
    console.error("[SCANNER] Sector rotation stage failed:", sectorErr.message);
    logEvent("scanner.stage.failure", { stage: "sector_rotation", error: sectorErr.message });
  }

  const sectorBiasMap = new Map(
    (Array.isArray(sectorRotation) ? sectorRotation : []).map((sector) => [sector?.sector, sector?.bias])
  );

  const rescoredCandidates = (Array.isArray(rawCandidates) ? rawCandidates : [])
    .map((candidate) =>
      buildRankedStock({
        ticker: candidate.ticker,
        companyData: candidate.companyData,
        analysis: candidate.analysis,
        newsIntel: candidate.newsIntel,
        sectorBias: sectorBiasMap.get(normalizeSector(candidate.companyData?.Sector)) || "NEUTRAL"
      })
    )
    .filter(Boolean);

  let rankedStocks = [];
  try {
    rankedStocks = rankAndDiversifyStocks(rescoredCandidates, {
      limit,
      maxPerSector: 2
    }) || [];
  } catch (rankErr) {
    console.error("[SCANNER] Ranking stage failed:", rankErr.message);
    logEvent("scanner.stage.failure", { stage: "ranking", error: rankErr.message });
    recordScannerStageFailure("ranking", rankErr.message);
  }

  let watchlists = { highRiskWatchlist: [], weakSetupWatchlist: [] };
  try {
    watchlists = buildWatchlists(rescoredCandidates) || watchlists;
  } catch (wlErr) {
    logEvent("scanner.stage.failure", { stage: "watchlists", error: wlErr.message });
    recordScannerStageFailure("watchlists", wlErr.message);
  }

  let institutionalFlows = { flowBias: "BALANCED", note: "" };
  try {
    institutionalFlows = buildInstitutionalFlows({
      marketOverview,
      sectorRotation,
      rankedStocks
    }) || institutionalFlows;
  } catch (flowErr) {
    logEvent("scanner.stage.failure", { stage: "institutional_flows", error: flowErr.message });
    recordScannerStageFailure("institutional_flows", flowErr.message);
  }

  const hasValidSetups = Array.isArray(rankedStocks) && rankedStocks.length > 0;
  if (!hasValidSetups) {
    logEvent("scanner.no_actionable_setups", { scope: "morning_pipeline" });
    recordNoActionableSetups();
    return {
      status: "NO_ACTIONABLE_SETUPS",
      recommendations: [],
      suppressed: true,
      generatedAt: new Date().toISOString(),
      marketOverview,
      sectorRotation: Array.isArray(sectorRotation) ? sectorRotation : [],
      institutionalFlows,
      rankedStocks: [],
      watchlists,
      report: "FinSight Morning Market Intelligence\nNo actionable opportunities identified today."
    };
  }

  let report;
  try {
    report = formatMorningScannerReport({
      generatedAt: new Date().toISOString(),
      marketOverview,
      sectorRotation,
      institutionalFlows,
      rankedStocks,
      watchlists
    });
  } catch (fmtErr) {
    console.error("[SCANNER FORMATTER FAILURE]", fmtErr);
    logEvent("scanner.stage.failure", { stage: "formatter", error: fmtErr.message });
    return {
      status: "FORMATTER_FAILURE",
      recommendations: [],
      suppressed: true,
      error: fmtErr.message,
      generatedAt: new Date().toISOString(),
      marketOverview,
      sectorRotation: safeArray(sectorRotation),
      institutionalFlows: safeObject(institutionalFlows),
      rankedStocks: safeArray(rankedStocks),
      watchlists: safeObject(watchlists),
      report: "FinSight Morning Market Intelligence\n[Formatter error — raw data available]"
    };
  }

  recordScannerSuccess();
  return {
    generatedAt: new Date().toISOString(),
    marketOverview,
    sectorRotation,
    institutionalFlows,
    rankedStocks,
    watchlists,
    report
  };
}


/**
 * Layer 2: Deep AI Analysis (Groq)
 * Runs full agentic analysis only on shortlisted candidates
 */
async function getLastSignalFromDB() {
  try {
    const { data } = await supabase
      .from("recommendation_audit")
      .select("recommendation_id,symbol,action,confidence,rr_ratio,entry_price,stop_loss,target_price,created_at,ai_summary")
      .eq("action", "BUY")
      .order("created_at", { ascending: false })
      .limit(1);
    return data && data.length > 0 ? data[0] : null;
  } catch {
    return null;
  }
}

function isMarketOpen() {
  const now = new Date();
  const ist = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const hours = ist.getHours();
  const minutes = ist.getMinutes();
  const day = ist.getDay();
  if (day === 0 || day === 6) return false;
  const timeInMinutes = hours * 60 + minutes;
  return timeInMinutes >= 555 && timeInMinutes <= 930; // 9:15am to 3:30pm IST
}

export async function scannerAgent() {
  try {
    const morningPacket = await runMorningScannerPipeline(5);
    if (morningPacket?.status === "NO_ACTIONABLE_SETUPS") {
      logEvent("scanner.no_actionable_setups", { scope: "scanner_agent_empty_packet" });

      // Post-market fallback: return last signal from DB
      if (!isMarketOpen()) {
        const lastSignal = await getLastSignalFromDB();
        if (lastSignal) {
          const signalAge = Math.round((Date.now() - new Date(lastSignal.created_at).getTime()) / (1000 * 60 * 60));
          return {
            status: "POST_MARKET_CONTEXT",
            recommendations: [lastSignal],
            suppressed: false,
            message: `Market closed. Last signal from ${signalAge}h ago.`,
            lastSignal
          };
        }
      }

      return {
        status: "NO_ACTIONABLE_SETUPS",
        recommendations: [],
        suppressed: true
      };
    }
    const targetStocks = morningPacket?.rankedStocks || morningPacket?.report?.rankedStocks || [];
    const legacyResults = (Array.isArray(targetStocks) ? targetStocks : []).map(adaptRankedStockToLegacyFormat);
    const approvedResults = legacyResults.filter((result) => !shouldRejectSignal(result));
    console.log("[FINAL APPROVED RESULTS]", approvedResults.map((r) => ({
      stock: r.stock,
      rr: r.rewardRiskRatio,
      decision: r.decision
    })));
    console.log("FINAL SCANNER RESULTS:", approvedResults);
    if (approvedResults.length === 0) {
      logEvent("scanner.no_actionable_setups", { scope: "scanner_agent_empty_legacy" });
      return [
        {
          status: "NO_VALID_SETUPS",
          message: "No institutional-grade opportunities found today."
        }
      ];
    }
    return approvedResults;
  } catch (error) {
    console.log("Scanner Agent Error:", error.message);
    logEvent("scanner.no_actionable_setups", { scope: "scanner_agent_error", error: error.message });
    return {
      status: "NO_ACTIONABLE_SETUPS",
      recommendations: [],
      suppressed: true
    };
  }
}

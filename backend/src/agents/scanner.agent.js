import { masterAgent } from "./master.agent.js";
import { getMarketOverview } from "../scanner/marketOverview.js";
import { buildTickerNewsIntel } from "../scanner/newsEngine.js";
import { buildSectorRotation } from "../scanner/sectorRotation.js";
import { buildInstitutionalFlows } from "../scanner/institutionalFlows.js";
import { buildWatchlists } from "../scanner/watchlistEngine.js";
import { buildRankedStock, rankAndDiversifyStocks } from "../scanner/stockRanker.js";
import { formatMorningScannerReport } from "../scanner/scannerFormatter.js";
import { normalizeSector } from "../scanner/convictionEngine.js";
import { buildAnalysisContext } from "../core/analysisContext.js";
import { getHistoricalCandles, getLiveMarketData } from "../services/marketData.service.js";

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
  const results = [];
  let cursor = 0;
  const runners = Array.from({ length: Math.min(maxConcurrency, items.length) }).map(async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
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
        if (volRatio > 2.0) score += 25;
        else if (volRatio > 1.5) score += 15;
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
  return {
    stock: stock.ticker,
    sector: stock.sector,
    decision: stock.decision,
    confidenceScore: stock.convictionScore,
    priorityLevel: stock.conviction,
    allocation: "0%",
    entrySignal: stock.conviction === "HIGH" ? "STRONG ENTRY" : stock.conviction === "MEDIUM" ? "CAUTIOUS ENTRY" : "AVOID ENTRY",
    entryUrgency: stock.entryUrgency,
    currentPrice: stock.currentPrice,
    idealEntryZone: stock.idealEntryZone,
    stopLoss: `₹${Math.round(stock.stopLoss)}`,
    initialTarget: `₹${Math.round(stock.target1)}`,
    rewardRiskRatio: stock.rr,
    entryReasoning: stock.thesis,
    finalExecutionAdvice:
      stock.conviction === "HIGH"
        ? `Focus on ${stock.idealEntryZone} with defined risk below ₹${Math.round(stock.stopLoss)}.`
        : stock.conviction === "MEDIUM"
        ? `Scale in selectively and respect volatility at current levels.`
        : `Keep on watchlist only until setup quality improves.`,
    decisionReasoning: stock.thesis,
    recommendedAction:
      stock.conviction === "HIGH"
        ? "Build position gradually"
        : stock.conviction === "MEDIUM"
        ? "Start partial accumulation"
        : "Monitor and wait",
    newsSentiment: stock.newsSentiment,
    catalysts: stock.catalysts,
    investorType: stock.investorType
  };
}

export async function runMorningScannerPipeline(limit = 5) {
  console.log("🔍 Running Institutional Morning Intelligence Pipeline...");

  const marketOverview = await getMarketOverview();
  const shortlisted = await getShortlistedStocks(10);
  console.log(`✅ Shortlisted: ${shortlisted.map((s) => s.symbol).join(", ")} (Count: ${shortlisted.length})`);

  const rawCandidates = [];
  const rankedCandidates = [];

  for (const item of shortlisted) {
    try {
      console.log(`🧠 Deep Scanning: ${item.symbol}`);
      const { stockData: companyData } = await buildAnalysisContext(item.symbol);
      const analysis = await masterAgent(companyData);
      const newsIntel = await buildTickerNewsIntel({
        ticker: item.symbol,
        companyName: companyData?.Name
      });

      const rankedStock = buildRankedStock({
        ticker: item.symbol,
        companyData,
        analysis,
        newsIntel
      });

      rawCandidates.push({
        ticker: item.symbol,
        companyData,
        analysis,
        newsIntel
      });
      rankedCandidates.push(rankedStock);
    } catch (error) {
      console.log(`Deep scan failed for ${item.symbol}:`, error.message);
    }
  }

  const sectorRotation = await buildSectorRotation({
    rankedStocks: rankedCandidates,
    marketSectorSnapshot: marketOverview.sectors
  });

  const sectorBiasMap = new Map(
    sectorRotation.map((sector) => [sector.sector, sector.bias])
  );

  const rescoredCandidates = rawCandidates.map((candidate) =>
    buildRankedStock({
      ticker: candidate.ticker,
      companyData: candidate.companyData,
      analysis: candidate.analysis,
      newsIntel: candidate.newsIntel,
      sectorBias: sectorBiasMap.get(normalizeSector(candidate.companyData?.Sector)) || "NEUTRAL"
    })
  );

  const rankedStocks = rankAndDiversifyStocks(rescoredCandidates, {
    limit,
    maxPerSector: 2
  });
  const watchlists = buildWatchlists(rescoredCandidates);
  const institutionalFlows = buildInstitutionalFlows({
    marketOverview,
    sectorRotation,
    rankedStocks
  });

  const report = formatMorningScannerReport({
    generatedAt: new Date().toISOString(),
    marketOverview,
    sectorRotation,
    institutionalFlows,
    rankedStocks,
    watchlists
  });

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
export async function scannerAgent() {
  try {
    const morningPacket = await runMorningScannerPipeline(5);
    const legacyResults = morningPacket.report.rankedStocks.map(adaptRankedStockToLegacyFormat);
    console.log("FINAL SCANNER RESULTS:", legacyResults);
    return legacyResults;
  } catch (error) {
    console.log("Scanner Agent Error:", error.message);
    return [];
  }
}

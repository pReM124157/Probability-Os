import { masterAgent } from "./master.agent.js";
import { getCompanyOverview } from "../services/marketData.service.js";
import YahooFinance from "yahoo-finance2";
import { getMarketOverview } from "../scanner/marketOverview.js";
import { buildTickerNewsIntel } from "../scanner/newsEngine.js";
import { buildSectorRotation } from "../scanner/sectorRotation.js";
import { buildInstitutionalFlows } from "../scanner/institutionalFlows.js";
import { buildWatchlists } from "../scanner/watchlistEngine.js";
import { buildRankedStock, rankAndDiversifyStocks } from "../scanner/stockRanker.js";
import { formatMorningScannerReport } from "../scanner/scannerFormatter.js";
import { normalizeSector } from "../scanner/convictionEngine.js";

const yahooFinance = new YahooFinance();

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

/**
 * Layer 1: Cheap Pre-Filter (No Groq/AI)
 * Uses market data to score stocks and shortlist candidates
 */
async function getShortlistedStocks(limit = 10) {
  console.log(`📊 Layer 1: Pre-filtering ${STOCK_UNIVERSE.length} stocks...`);
  const candidates = [];

  // Process in small batches to be polite to Yahoo Finance
  const batchSize = 10;
  for (let i = 0; i < STOCK_UNIVERSE.length; i += batchSize) {
    const batch = STOCK_UNIVERSE.slice(i, i + batchSize);
    
    await Promise.all(batch.map(async (symbol) => {
      try {
        const fetchSymbol = symbol.includes(".") ? symbol : `${symbol}.NS`;
        const quote = await yahooFinance.quote(fetchSymbol);
        
        let score = 0;

        // 1. Breakout Strength (Proximity to 52w High)
        if (quote.fiftyTwoWeekHigh > 0) {
          const proximity = quote.regularMarketPrice / quote.fiftyTwoWeekHigh;
          if (proximity > 0.98) score += 25; // Imminent breakout
          else if (proximity > 0.95) score += 15;
        }

        // 2. Volume Strength (Relative to 3M Average)
        if (quote.averageDailyVolume3Month > 0) {
          const volRatio = quote.regularMarketVolume / quote.averageDailyVolume3Month;
          if (volRatio > 2.0) score += 25;
          else if (volRatio > 1.5) score += 15;
        }

        // 3. Trend Strength (Moving Averages)
        if (quote.fiftyDayAverage > 0 && quote.regularMarketPrice > quote.fiftyDayAverage) {
          score += 10;
        }
        if (quote.twoHundredDayAverage > 0 && quote.regularMarketPrice > quote.twoHundredDayAverage) {
          score += 15;
        }

        // 4. Price Momentum (Day Change %)
        const changePercent = quote.regularMarketChangePercent || 0;
        if (changePercent > 2) score += 15;
        else if (changePercent > 0) score += 5;

        candidates.push({ symbol, score, price: quote.regularMarketPrice });
      } catch (err) {
        // Skip failed quotes
      }
    }));
  }

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
      const companyData = await getCompanyOverview(item.symbol);
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

  const sectorRotation = buildSectorRotation({
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

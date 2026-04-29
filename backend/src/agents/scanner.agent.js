import { masterAgent } from "./master.agent.js";
import { getCompanyOverview } from "../services/marketData.service.js";
import YahooFinance from "yahoo-finance2";

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

/**
 * Layer 2: Deep AI Analysis (Groq)
 * Runs full agentic analysis only on shortlisted candidates
 */
export async function scannerAgent() {
  try {
    console.log("🔍 Running 2-Layer Institutional Scanner...");
    
    // Step 1: Pre-filter (Layer 1)
    const shortlisted = await getShortlistedStocks(10);
    console.log(`✅ Shortlisted: ${shortlisted.map(s => s.symbol).join(", ")} (Count: ${shortlisted.length})`);

    console.log("SHORTLISTED STOCKS:", shortlisted.length);

    const results = [];

    // Step 2: Deep Analysis (Layer 2)
    for (const item of shortlisted) {
      try {
        console.log(`🧠 Deep Scanning: ${item.symbol}`);
        const stockData = await getCompanyOverview(item.symbol);
        const analysis = await masterAgent(stockData);

        if (analysis) {
          results.push({
            stock: item.symbol,
            decision: analysis?.decision?.finalDecision || "HOLD",
            confidenceScore: analysis?.decision?.finalConfidenceScore || 0,
            priorityLevel: analysis?.capital?.priorityLevel || "MEDIUM",
            allocation: analysis?.capital?.suggestedAllocation || "0%",
            entrySignal: analysis?.entryTiming?.strategy || "AVOID ENTRY",
            entryUrgency: analysis?.entryTiming?.entryUrgency || "LOW",
            currentPrice: analysis?.entryTiming?.currentPrice || item.price || 0,
            idealEntryZone: analysis?.entryTiming?.idealEntryZone || "N/A",
            stopLoss: analysis?.entryTiming?.stopLoss || "N/A",
            initialTarget: analysis?.entryTiming?.initialTarget || "N/A",
            rewardRiskRatio: analysis?.entryTiming?.rewardRiskRatio || "N/A",
            entryReasoning: analysis?.entryTiming?.reasoning || "N/A",
            finalExecutionAdvice: analysis?.entryTiming?.finalExecutionAdvice || "N/A",
            decisionReasoning: analysis?.decision?.reason || "N/A",
            recommendedAction: analysis?.rebalancing?.action || "N/A"
          });
        }
      } catch (error) {
        console.log(`Deep scan failed for ${item.symbol}:`, error.message);
      }
    }

    console.log(`📊 Deep Scan Results: ${results.length} stocks processed`);

    const sortedResults = results.sort(
      (a, b) => b.confidenceScore - a.confidenceScore
    );

    // Apply confidence threshold (User requested reducing from 7 to 5)
    const filteredResults = sortedResults.filter(r => r.confidenceScore >= 5);
    console.log(`🎯 Filtered Results (Confidence >= 5): ${filteredResults.length}`);

    console.log("FINAL SCANNER RESULTS:", filteredResults);
    return filteredResults.slice(0, 5);
  } catch (error) {
    console.log("Scanner Agent Error:", error.message);
    return [];
  }
}

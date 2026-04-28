import { masterAgent } from "./master.agent.js";
import { getCompanyOverview } from "../services/marketData.service.js";

const STOCK_UNIVERSE = [
  "RELIANCE",
  "TCS",
  "INFY",
  "HDFCBANK",
  "ICICIBANK",
  "AXISBANK",
  "SBIN",
  "LT",
  "ITC",
  "BHARTIARTL"
];

export async function scannerAgent() {
  try {
    console.log("🔍 Running Institutional Scanner...");
    const results = [];

    for (const symbol of STOCK_UNIVERSE) {
      try {
        console.log(`Scanning: ${symbol}`);
        const stockData = await getCompanyOverview(symbol);
        const analysis = await masterAgent(stockData);

        results.push({
          stock: symbol,
          decision: analysis?.decision?.finalDecision || "HOLD",
          confidenceScore:
            analysis?.decision?.finalConfidenceScore || 0,
          priorityLevel:
            analysis?.capital?.priorityLevel || "MEDIUM",
          allocation:
            analysis?.capital?.suggestedAllocation || "0%",
          entrySignal:
            analysis?.entryTiming?.strategy || "AVOID ENTRY",
          entryUrgency:
            analysis?.entryTiming?.entryUrgency || "LOW"
        });
      } catch (error) {
        console.log(`Scanner failed for ${symbol}:`, error.message);
      }
    }

    const sortedResults = results.sort(
      (a, b) => b.confidenceScore - a.confidenceScore
    );

    return sortedResults.slice(0, 5);
  } catch (error) {
    console.log("Scanner Agent Error:", error.message);
    return [];
  }
}

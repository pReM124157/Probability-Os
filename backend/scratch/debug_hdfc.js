import { getCompanyOverview, getLiveMarketData } from "../src/services/marketData.service.js";
import { masterAgent } from "../src/agents/master.agent.js";
import dotenv from "dotenv";

dotenv.config();

async function debugAnalysis(symbol) {
  console.log(`\n=== DEBUGGING ANALYSIS FOR ${symbol} ===`);
  
  try {
    const overview = await getCompanyOverview(symbol);
    console.log("DEBUG: getCompanyOverview returned:", JSON.stringify(overview, null, 2));
    
    const live = await getLiveMarketData(symbol);
    console.log("DEBUG: getLiveMarketData returned:", JSON.stringify(live, null, 2));
    
    console.log("\n--- TRIGGERING MASTER AGENT ---");
    const result = await masterAgent(overview);
    
    console.log("\n--- FINAL RESULT SUMMARY ---");
    console.log("Decision:", result.decision?.finalDecision);
    console.log("Confidence:", result.decision?.finalConfidenceScore);
    console.log("Price:", result.entryTiming?.currentPrice);
    console.log("Strategy:", result.entryTiming?.strategy);
    
  } catch (err) {
    console.error("DEBUG ERROR:", err.message);
  }
}

debugAnalysis("HDFCBANK");

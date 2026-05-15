import { getLiveMarketData, getCompanyOverview, checkSymbolExists } from './src/services/marketData.service.js';
import { checkSymbolExistence, checkMarketAvailability, EXISTENCE_STATE, MARKET_AVAILABILITY } from './src/core/tickerContracts.js';
import dotenv from 'dotenv';

dotenv.config();

async function runTests() {
  console.log("=========================================");
  console.log("🚀 PROVIDER RESILIENCE VERIFICATION TEST");
  console.log("=========================================\n");

  const testSymbols = ["TCS", "INFY", "RELIANCE", "HDFCBANK", "XYZABCINVALID"];

  for (const symbol of testSymbols) {
    console.log(`\n\n--- Testing Symbol: ${symbol} ---`);
    try {
      // 1. Layer 2 Test: Symbol Existence
      console.log(`[1] Testing Layer 2 (Existence) for ${symbol}...`);
      const existenceResult = await checkSymbolExistence(symbol, { getCompanyOverview });
      console.log(`  -> Existence State: ${existenceResult.state}`);
      if (existenceResult.name) console.log(`  -> Resolved Name: ${existenceResult.name}`);
      
      // 2. Layer 3 Test: Market Availability
      console.log(`\n[2] Testing Layer 3 (Market Availability) for ${symbol}...`);
      const marketResult = await checkMarketAvailability(symbol, { getLiveMarketData });
      console.log(`  -> Availability State: ${marketResult.availability}`);
      console.log(`  -> Price Source: ${marketResult.priceSource}`);
      console.log(`  -> Current Price: ₹${marketResult.currentPrice}`);
      
      // 3. Simulating Provider Outage (Fallback Test)
      // We can't easily break Yahoo globally, but if the above test shows Alpha or TwelveData 
      // due to a natural rate limit, we'll see it in the Price Source.
      if (marketResult.priceSource === "YAHOO") {
          console.log(`  ✅ Yahoo is healthy. (To test fallbacks, you can temporarily invalidate Yahoo in marketData.service.js)`);
      } else if (marketResult.priceSource !== "NONE" && marketResult.priceSource !== "ERROR") {
          console.log(`  ✅ Fallback provider (${marketResult.priceSource}) successfully recovered data!`);
      }

    } catch (e) {
      console.error(`❌ Test failed for ${symbol}:`, e.message);
    }
  }

  console.log("\n\n=========================================");
  console.log("✅ TESTS COMPLETE");
  console.log("=========================================");
  process.exit(0);
}

runTests();

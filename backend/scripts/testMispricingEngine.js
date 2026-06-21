import dotenv from "dotenv";
dotenv.config();

import { getAggregatedBtcPrice } from "../src/kalshi/data/cryptoPriceClient.js";
import { estimateBtcReachability } from "../src/kalshi/agents/reachabilityEngine.js";
import { calculateMispricing } from "../src/kalshi/agents/mispricingEngine.js";

async function main() {
  console.log("=== Probability OS Mispricing Test ===");

  const btc = await getAggregatedBtcPrice();

  if (!btc.ok) {
    console.log("BTC aggregator failed:");
    console.log(JSON.stringify(btc, null, 2));
    process.exit(1);
  }

  const current = btc.price;

  const reachability = estimateBtcReachability({
    currentPrice: current,
    targetPrice: current + 100,
    minutesRemaining: 15,
    annualizedVolatility: 0.55,
    momentumBps: 0,
    marketProbability: 20,
  });

  const mispricing = calculateMispricing({
    marketProbability: 20,
    modelProbability: reachability.modelProbability,
    yesBidPrice: 19,
    yesAskPrice: 21,
    noBidPrice: 78,
    noAskPrice: 81,
    feeBps: 20,
    minEdgePct: 5,
    strongEdgePct: 10,
    maxAllowedSpreadPct: 8,
  });

  console.log("\n[BTC REFERENCE]");
  console.log(JSON.stringify({
    price: current,
    providerCount: btc.providerCount,
    timestamp: btc.timestamp,
  }, null, 2));

  console.log("\n[REACHABILITY]");
  console.log(JSON.stringify(reachability, null, 2));

  console.log("\n[MISPRICING]");
  console.log(JSON.stringify(mispricing, null, 2));

  const scenarios = [
    {
      label: "Strong YES edge",
      marketProbability: 15,
      modelProbability: 32,
      yesBidPrice: 14,
      yesAskPrice: 16,
      noBidPrice: 83,
      noAskPrice: 86,
    },
    {
      label: "No edge",
      marketProbability: 30,
      modelProbability: 31,
      yesBidPrice: 29,
      yesAskPrice: 31,
      noBidPrice: 68,
      noAskPrice: 71,
    },
    {
      label: "Strong NO edge",
      marketProbability: 70,
      modelProbability: 45,
      yesBidPrice: 69,
      yesAskPrice: 71,
      noBidPrice: 28,
      noAskPrice: 31,
    },
    {
      label: "Spread too wide",
      marketProbability: 20,
      modelProbability: 40,
      yesBidPrice: 15,
      yesAskPrice: 30,
      noBidPrice: 70,
      noAskPrice: 85,
    },
  ];

  for (const scenario of scenarios) {
    console.log(`\n[SCENARIO] ${scenario.label}`);
    console.log(JSON.stringify(
      calculateMispricing({
        ...scenario,
        feeBps: 20,
        minEdgePct: 5,
        strongEdgePct: 10,
        maxAllowedSpreadPct: 8,
      }),
      null,
      2
    ));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

import dotenv from "dotenv";
dotenv.config();

import { getAggregatedBtcPrice } from "../src/kalshi/data/cryptoPriceClient.js";
import { estimateBtcReachability } from "../src/kalshi/agents/reachabilityEngine.js";

async function main() {
  console.log("=== Probability OS Reachability Test ===");

  const btc = await getAggregatedBtcPrice();

  if (!btc.ok) {
    console.log("BTC aggregator failed:");
    console.log(JSON.stringify(btc, null, 2));
    process.exit(1);
  }

  const current = btc.price;

  const scenarios = [
    {
      label: "Near upside target",
      targetPrice: current + 100,
      minutesRemaining: 15,
      marketProbability: 35,
    },
    {
      label: "Far upside target",
      targetPrice: current + 750,
      minutesRemaining: 15,
      marketProbability: 18,
    },
    {
      label: "Near downside target",
      targetPrice: current - 100,
      minutesRemaining: 15,
      marketProbability: 35,
    },
  ];

  console.log("\n[BTC REFERENCE]");
  console.log(JSON.stringify({
    price: current,
    providerCount: btc.providerCount,
    timestamp: btc.timestamp,
  }, null, 2));

  for (const scenario of scenarios) {
    const result = estimateBtcReachability({
      currentPrice: current,
      targetPrice: scenario.targetPrice,
      minutesRemaining: scenario.minutesRemaining,
      marketProbability: scenario.marketProbability,
      annualizedVolatility: 0.55,
      momentumBps: 0,
    });

    console.log(`\n[SCENARIO] ${scenario.label}`);
    console.log(JSON.stringify(result, null, 2));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

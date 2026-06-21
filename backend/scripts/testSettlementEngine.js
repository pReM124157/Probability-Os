import dotenv from "dotenv";
dotenv.config();

import { runPaperDecisionFlow } from "../src/kalshi/execution/paperDecisionFlow.js";
import {
  getPaperTrades,
  getPaperTradingStats,
} from "../src/kalshi/execution/paperTradingEngine.js";
import {
  settleOpenPaperTradesByBtcPrice,
} from "../src/kalshi/execution/settlementEngine.js";
import { getAggregatedBtcPrice } from "../src/kalshi/data/cryptoPriceClient.js";

async function main() {
  console.log("=== Probability OS Settlement Engine Test ===");

  const btc = await getAggregatedBtcPrice();

  if (!btc.ok) {
    console.log("BTC aggregator failed:");
    console.log(JSON.stringify(btc, null, 2));
    process.exit(1);
  }

  const current = btc.price;
  const target = current + 100;

  console.log("\n[CREATE OPEN PAPER TRADE]");
  const flow = await runPaperDecisionFlow({
    marketTicker: `DEMO-BTC-SETTLEMENT-${Date.now()}`,
    targetPrice: target,
    minutesRemaining: 15,

    marketProbability: 15,
    yesBidPrice: 14,
    yesAskPrice: 16,
    noBidPrice: 83,
    noAskPrice: 86,

    annualizedVolatility: 0.55,
    momentumBps: 0,
    feeBps: 20,
    minEdgePct: 5,
    strongEdgePct: 10,
    maxAllowedSpreadPct: 8,

    riskLimits: {
      paperTradingOnly: true,
      killSwitchEnabled: false,
      maxTradeSizeUsd: 250,
      maxOpenExposureUsd: 1000,
      maxDailyLossUsd: 250,
      maxTradesPerDay: 20,
      minAdjustedEdgePct: 5,
      minConfidenceScore: 60,
      allowLiveExecution: false,
    },

    notes: "Step 9 settlement test",
  });

  console.log(JSON.stringify({
    stage: flow.stage,
    action: flow.action,
    tradeId: flow.paperTrade?.trade?.id || null,
    side: flow.paperTrade?.trade?.side || null,
    targetPrice: flow.paperTrade?.trade?.targetPrice || null,
    entryBtcPrice: flow.paperTrade?.trade?.btcPrice || null,
  }, null, 2));

  console.log("\n[OPEN TRADES BEFORE SETTLEMENT]");
  console.log(JSON.stringify(getPaperTrades({ status: "OPEN", limit: 5 }), null, 2));

  const settlementPrice = target + 50;

  console.log("\n[SETTLEMENT]");
  const settlement = settleOpenPaperTradesByBtcPrice({
    settlementBtcPrice: settlementPrice,
    marketTicker: flow.paperTrade?.trade?.marketTicker,
  });

  console.log(JSON.stringify(settlement, null, 2));

  console.log("\n[STATS AFTER SETTLEMENT]");
  console.log(JSON.stringify(getPaperTradingStats(), null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

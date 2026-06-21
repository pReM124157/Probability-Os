import dotenv from "dotenv";
dotenv.config();

import { getAggregatedBtcPrice } from "../src/kalshi/data/cryptoPriceClient.js";
import { runPaperDecisionFlow } from "../src/kalshi/execution/paperDecisionFlow.js";
import {
  getPaperTrades,
  getPaperTradingStats,
} from "../src/kalshi/execution/paperTradingEngine.js";

async function main() {
  console.log("=== Probability OS Paper Decision Flow Test ===");

  const btc = await getAggregatedBtcPrice();

  if (!btc.ok) {
    console.log("BTC aggregator failed:");
    console.log(JSON.stringify(btc, null, 2));
    process.exit(1);
  }

  const current = btc.price;

  const result = await runPaperDecisionFlow({
    marketTicker: "DEMO-BTC-15MIN-RISK-GATED",
    targetPrice: current + 100,
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

    notes: "Step 8 risk-gated paper decision flow test",
  });

  console.log("\n[DECISION FLOW RESULT]");
  console.log(JSON.stringify({
    ok: result.ok,
    stage: result.stage,
    action: result.action,
    reason: result.reason,
    btcPrice: result.btc?.price,
    modelProbability: result.reachability?.modelProbability,
    marketProbability: result.mispricing?.marketProbability,
    bestSide: result.mispricing?.bestSide,
    bestAdjustedEdge: result.mispricing?.bestAdjustedEdge,
    riskStatus: result.risk?.status,
    riskReason: result.risk?.reason,
    paperTradeId: result.paperTrade?.trade?.id || null,
  }, null, 2));

  console.log("\n[FULL RISK RESULT]");
  console.log(JSON.stringify(result.risk, null, 2));

  console.log("\n[LATEST OPEN PAPER TRADES]");
  console.log(JSON.stringify(getPaperTrades({ status: "OPEN", limit: 5 }), null, 2));

  console.log("\n[PAPER TRADING STATS]");
  console.log(JSON.stringify(getPaperTradingStats(), null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

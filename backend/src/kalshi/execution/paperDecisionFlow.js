import { getAggregatedBtcPrice } from "../data/cryptoPriceClient.js";
import { estimateBtcReachability } from "../agents/reachabilityEngine.js";
import { calculateMispricing } from "../agents/mispricingEngine.js";
import {
  createPaperTrade,
  getPaperTrades,
} from "./paperTradingEngine.js";
import {
  evaluateKalshiTradeRisk,
  summarizePaperRiskState,
  defaultKalshiRiskLimits,
} from "../risk/kalshiRiskEngine.js";

function safeNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function getEntryProbabilityForSide({ side, mispricing }) {
  if (side === "YES") return mispricing?.yes?.ask;
  if (side === "NO") return mispricing?.no?.ask;
  return null;
}

export async function runPaperDecisionFlow({
  marketTicker,
  targetPrice,
  minutesRemaining = 15,
  marketProbability,
  yesBidPrice,
  yesAskPrice,
  noBidPrice,
  noAskPrice,
  annualizedVolatility = 0.55,
  momentumBps = 0,
  feeBps = 20,
  minEdgePct = 5,
  strongEdgePct = 10,
  maxAllowedSpreadPct = 8,
  riskLimits = defaultKalshiRiskLimits,
  notes = "",
} = {}) {
  const btc = await getAggregatedBtcPrice();

  if (!btc.ok) {
    return {
      ok: false,
      stage: "BTC_PRICE",
      reason: btc.reason || "BTC_PRICE_UNAVAILABLE",
      btc,
    };
  }

  const currentPrice = btc.price;
  const target = safeNumber(targetPrice);

  if (!marketTicker) {
    return {
      ok: false,
      stage: "INPUT_VALIDATION",
      reason: "MISSING_MARKET_TICKER",
    };
  }

  if (!target) {
    return {
      ok: false,
      stage: "INPUT_VALIDATION",
      reason: "MISSING_TARGET_PRICE",
    };
  }

  const reachability = estimateBtcReachability({
    currentPrice,
    targetPrice: target,
    minutesRemaining,
    annualizedVolatility,
    momentumBps,
    marketProbability,
  });

  if (!reachability.ok) {
    return {
      ok: false,
      stage: "REACHABILITY",
      reason: reachability.reason,
      btc,
      reachability,
    };
  }

  const mispricing = calculateMispricing({
    marketProbability,
    modelProbability: reachability.modelProbability,
    yesBidPrice,
    yesAskPrice,
    noBidPrice,
    noAskPrice,
    feeBps,
    minEdgePct,
    strongEdgePct,
    maxAllowedSpreadPct,
  });

  if (!mispricing.ok) {
    return {
      ok: false,
      stage: "MISPRICING",
      reason: mispricing.reason,
      btc,
      reachability,
      mispricing,
    };
  }

  if (mispricing.decision !== "TRADE") {
    return {
      ok: true,
      stage: "DECISION",
      action: "NO_PAPER_TRADE",
      reason: `MISPRICING_DECISION_${mispricing.decision}`,
      btc,
      reachability,
      mispricing,
      risk: null,
      paperTrade: null,
    };
  }

  const side = mispricing.bestSide;
  const entryProbability = getEntryProbabilityForSide({ side, mispricing });

  const openTrades = getPaperTrades({ status: "OPEN", limit: 500 });
  const allRecentTrades = getPaperTrades({ limit: 1000 });
  const currentState = summarizePaperRiskState(allRecentTrades);

  const estimatedSizeUsd =
    mispricing.bestAdjustedEdge >= 25 ? 500 :
    mispricing.bestAdjustedEdge >= 20 ? 250 :
    mispricing.bestAdjustedEdge >= 15 ? 100 :
    mispricing.bestAdjustedEdge >= 10 ? 50 :
    25;

  const risk = evaluateKalshiTradeRisk({
    tradeCandidate: {
      mode: "PAPER",
      side,
      sizeUsd: estimatedSizeUsd,
      adjustedEdge: mispricing.bestAdjustedEdge,
      confidenceScore: mispricing.confidenceScore,
      marketTicker,
    },
    currentState: {
      ...currentState,
      openExposureUsd: currentState.openExposureUsd,
      openTrades: openTrades.length,
    },
    limits: riskLimits,
  });

  if (!risk.approved) {
    return {
      ok: true,
      stage: "RISK",
      action: "RISK_REJECTED",
      reason: risk.reason,
      btc,
      reachability,
      mispricing,
      risk,
      paperTrade: null,
    };
  }

  const paperTrade = createPaperTrade({
    marketTicker,
    side,
    entryProbability,
    modelProbability: reachability.modelProbability,
    marketProbability: mispricing.marketProbability,
    adjustedEdge: mispricing.bestAdjustedEdge,
    rawEdge: mispricing.bestRawEdge,
    btcPrice: currentPrice,
    targetPrice: target,
    minutesRemaining,
    confidenceScore: mispricing.confidenceScore,
    sizeUsd: estimatedSizeUsd,
    source: "PAPER_DECISION_FLOW",
    notes,
  });

  return {
    ok: Boolean(paperTrade.ok),
    stage: paperTrade.ok ? "PAPER_TRADE_CREATED" : "PAPER_TRADE_FAILED",
    action: paperTrade.ok ? "PAPER_TRADE_CREATED" : "NO_PAPER_TRADE",
    reason: paperTrade.ok ? "TRADE_CREATED" : paperTrade.reason,
    btc,
    reachability,
    mispricing,
    risk,
    paperTrade,
  };
}

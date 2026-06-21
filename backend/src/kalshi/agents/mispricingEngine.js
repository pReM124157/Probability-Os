function safeNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeProbability(value) {
  const n = safeNumber(value);

  if (n === null) {
    return null;
  }

  // Accept either 0.42 or 42.
  if (n >= 0 && n <= 1) {
    return n * 100;
  }
  if (n >= 0 && n <= 100) {
    return n;
  }

  return null;
}

export function calculateMispricing({
  marketProbability,
  modelProbability,
  yesAskPrice = null,
  yesBidPrice = null,
  noAskPrice = null,
  noBidPrice = null,
  feeBps = 0,
  minEdgePct = 5,
  strongEdgePct = 10,
  maxAllowedSpreadPct = 8,
} = {}) {
  const marketProb = normalizeProbability(marketProbability);
  const modelProb = normalizeProbability(modelProbability);

  if (marketProb === null || modelProb === null) {
    return {
      ok: false,
      reason: "INVALID_PROBABILITY_INPUT",
      decision: "NO_TRADE",
    };
  }

  const yesAsk = normalizeProbability(yesAskPrice);
  const yesBid = normalizeProbability(yesBidPrice);
  const noAsk = normalizeProbability(noAskPrice);
  const noBid = normalizeProbability(noBidPrice);

  const yesSpread =
    yesAsk !== null && yesBid !== null
      ? Math.max(0, yesAsk - yesBid)
      : null;

  const noSpread =
    noAsk !== null && noBid !== null
      ? Math.max(0, noAsk - noBid)
      : null;

  const rawYesEdge = modelProb - marketProb;
  const rawNoEdge = marketProb - modelProb;

  const feePct = safeNumber(feeBps, 0) / 100;

  const yesCostPenalty =
    yesSpread !== null ? yesSpread / 2 + feePct : feePct;

  const noCostPenalty =
    noSpread !== null ? noSpread / 2 + feePct : feePct;

  const adjustedYesEdge = rawYesEdge - yesCostPenalty;
  const adjustedNoEdge = rawNoEdge - noCostPenalty;

  const bestSide =
    adjustedYesEdge >= adjustedNoEdge ? "YES" : "NO";

  const bestAdjustedEdge =
    bestSide === "YES" ? adjustedYesEdge : adjustedNoEdge;

  const bestRawEdge =
    bestSide === "YES" ? rawYesEdge : rawNoEdge;

  const bestSpread =
    bestSide === "YES" ? yesSpread : noSpread;

  let decision = "NO_TRADE";
  let edgeGrade = "NONE";

  if (bestAdjustedEdge >= strongEdgePct) {
    decision = "TRADE";
    edgeGrade = "STRONG";
  } else if (bestAdjustedEdge >= minEdgePct) {
    decision = "WATCH";
    edgeGrade = "MEDIUM";
  }

  if (bestSpread !== null && bestSpread > maxAllowedSpreadPct) {
    decision = "NO_TRADE";
    edgeGrade = "SPREAD_TOO_WIDE";
  }

  const confidenceScore = clamp(
    Math.round(50 + bestAdjustedEdge * 3),
    0,
    100
  );

  return {
    ok: true,
    marketProbability: Number(marketProb.toFixed(2)),
    modelProbability: Number(modelProb.toFixed(2)),

    yes: {
      rawEdge: Number(rawYesEdge.toFixed(2)),
      adjustedEdge: Number(adjustedYesEdge.toFixed(2)),
      bid: yesBid,
      ask: yesAsk,
      spread: yesSpread === null ? null : Number(yesSpread.toFixed(2)),
    },

    no: {
      rawEdge: Number(rawNoEdge.toFixed(2)),
      adjustedEdge: Number(adjustedNoEdge.toFixed(2)),
      bid: noBid,
      ask: noAsk,
      spread: noSpread === null ? null : Number(noSpread.toFixed(2)),
    },

    bestSide,
    bestRawEdge: Number(bestRawEdge.toFixed(2)),
    bestAdjustedEdge: Number(bestAdjustedEdge.toFixed(2)),
    feeBps: safeNumber(feeBps, 0),
    minEdgePct,
    strongEdgePct,
    maxAllowedSpreadPct,
    decision,
    edgeGrade,
    confidenceScore,
    explanation:
      `${bestSide} has the best adjusted edge at ${Number(bestAdjustedEdge.toFixed(2))}%. ` +
      `Decision: ${decision}.`,
  };
}

export function extractMarketProbabilityFromOrderbook(orderbook) {
  const yesTop = orderbook?.yes?.[0] || null;
  const noTop = orderbook?.no?.[0] || null;

  // Kalshi books are usually arrays like [price, quantity].
  const yesBid = Array.isArray(yesTop) ? safeNumber(yesTop[0]) : null;
  const noBid = Array.isArray(noTop) ? safeNumber(noTop[0]) : null;

  // Approximate ask from opposite side: YES ask ~= 100 - NO bid, NO ask ~= 100 - YES bid.
  const yesAsk = noBid !== null ? 100 - noBid : null;
  const noAsk = yesBid !== null ? 100 - yesBid : null;

  const marketProbability =
    yesBid !== null && yesAsk !== null
      ? (yesBid + yesAsk) / 2
      : yesAsk !== null
        ? yesAsk
        : yesBid;

  return {
    marketProbability:
      marketProbability === null ? null : Number(marketProbability.toFixed(2)),
    yesBid,
    yesAsk,
    noBid,
    noAsk,
  };
}

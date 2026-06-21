import {
  getPaperTrades,
  settlePaperTrade,
  getPaperTradingStats,
} from "./paperTradingEngine.js";

function safeNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function resolveBtcTargetOutcome({
  direction = "UP",
  targetPrice,
  settlementBtcPrice,
} = {}) {
  const target = safeNumber(targetPrice);
  const settlement = safeNumber(settlementBtcPrice);

  if (!target || !settlement) {
    return {
      ok: false,
      reason: "INVALID_SETTLEMENT_INPUT",
      actualOutcome: null,
    };
  }

  const normalizedDirection = String(direction || "UP").toUpperCase();

  if (normalizedDirection === "UP") {
    return {
      ok: true,
      direction: "UP",
      targetPrice: target,
      settlementBtcPrice: settlement,
      actualOutcome: settlement >= target ? "YES" : "NO",
    };
  }

  if (normalizedDirection === "DOWN") {
    return {
      ok: true,
      direction: "DOWN",
      targetPrice: target,
      settlementBtcPrice: settlement,
      actualOutcome: settlement <= target ? "YES" : "NO",
    };
  }

  return {
    ok: false,
    reason: "INVALID_DIRECTION",
    actualOutcome: null,
  };
}

export function settleOpenPaperTradesByBtcPrice({
  settlementBtcPrice,
  marketTicker = null,
} = {}) {
  const openTrades = getPaperTrades({ status: "OPEN", limit: 1000 });

  const candidates = marketTicker
    ? openTrades.filter((trade) => trade.marketTicker === marketTicker)
    : openTrades;

  const settled = [];
  const skipped = [];

  for (const trade of candidates) {
    const direction =
      safeNumber(trade.targetPrice) >= safeNumber(trade.btcPrice)
        ? "UP"
        : "DOWN";

    const outcome = resolveBtcTargetOutcome({
      direction,
      targetPrice: trade.targetPrice,
      settlementBtcPrice,
    });

    if (!outcome.ok) {
      skipped.push({
        tradeId: trade.id,
        marketTicker: trade.marketTicker,
        reason: outcome.reason,
      });
      continue;
    }

    const won = trade.side === outcome.actualOutcome;

    const result = settlePaperTrade({
      tradeId: trade.id,
      won,
      settlementPrice: won ? 100 : 0,
    });

    settled.push({
      tradeId: trade.id,
      marketTicker: trade.marketTicker,
      side: trade.side,
      direction,
      targetPrice: trade.targetPrice,
      entryBtcPrice: trade.btcPrice,
      settlementBtcPrice,
      actualOutcome: outcome.actualOutcome,
      result: result.ok ? result.trade.status : "SETTLEMENT_FAILED",
      pnlUsd: result.trade?.pnlUsd ?? null,
      ok: result.ok,
      reason: result.reason || null,
    });
  }

  return {
    ok: true,
    checked: candidates.length,
    settled: settled.length,
    skipped: skipped.length,
    settledTrades: settled,
    skippedTrades: skipped,
    stats: getPaperTradingStats(),
  };
}

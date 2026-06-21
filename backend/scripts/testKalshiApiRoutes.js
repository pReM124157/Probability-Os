const BASE_URL = process.env.KALSHI_API_TEST_BASE_URL || "http://localhost:5000/api/kalshi";

async function request(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  let json = null;

  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }

  if (!response.ok) {
    throw new Error(`${path} failed with ${response.status}: ${JSON.stringify(json)}`);
  }

  return json;
}

async function main() {
  console.log("=== Probability OS API Route Test ===");

  const status = await request("/status");
  console.log("\n[STATUS]");
  console.log(JSON.stringify({
    ok: status.ok,
    mode: status.mode,
    btcOk: status.btc?.ok,
    paperStats: status.paperStats,
  }, null, 2));

  const stats = await request("/paper/stats");
  console.log("\n[PAPER STATS]");
  console.log(JSON.stringify(stats, null, 2));

  const btcPrice = status.btc?.price || 64250;

  const decision = await request("/paper/decision", {
    method: "POST",
    body: JSON.stringify({
      marketTicker: `API-TEST-BTC-${Date.now()}`,
      targetPrice: btcPrice + 100,
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
      notes: "API route validation trade",
    }),
  });

  console.log("\n[PAPER DECISION]");
  console.log(JSON.stringify({
    ok: decision.ok,
    stage: decision.stage,
    action: decision.action,
    reason: decision.reason,
    tradeId: decision.paperTrade?.trade?.id || null,
    marketTicker: decision.paperTrade?.trade?.marketTicker || null,
  }, null, 2));

  if (decision.paperTrade?.trade?.marketTicker) {
    const settlement = await request("/paper/settle", {
      method: "POST",
      body: JSON.stringify({
        marketTicker: decision.paperTrade.trade.marketTicker,
        settlementBtcPrice: btcPrice + 150,
      }),
    });

    console.log("\n[SETTLEMENT]");
    console.log(JSON.stringify({
      ok: settlement.ok,
      checked: settlement.checked,
      settled: settlement.settled,
      skipped: settlement.skipped,
      stats: settlement.stats,
    }, null, 2));
  }

  const finalStats = await request("/paper/stats");
  console.log("\n[FINAL STATS]");
  console.log(JSON.stringify(finalStats, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

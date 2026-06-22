const BASE_URL =
  process.env.KALSHI_SIGNAL_API_BASE_URL ||
  "http://127.0.0.1:5050/api/kalshi";

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
  const payload = {
    marketTicker: `SIGNAL-API-BTC-${Date.now()}`,
    targetPrice: 64350,
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
    notes: "Signal API route test",
  };

  const response = await request("/signal/explain", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  console.log("=== Signal API Route Test ===");
  console.log("\n[SIGNAL]");
  console.log(JSON.stringify(response.signal, null, 2));
  console.log("\n[HUMAN MESSAGE]");
  console.log(response.signal?.humanMessage || "No human message returned.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

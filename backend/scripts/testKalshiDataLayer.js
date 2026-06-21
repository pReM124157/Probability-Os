import dotenv from "dotenv";
dotenv.config();

import { getAggregatedBtcPrice } from "../src/kalshi/data/cryptoPriceClient.js";
import {
  getKalshiStatus,
  getKalshiMarkets,
  getKalshiMarketOrderbook,
} from "../src/kalshi/data/kalshiClient.js";

async function main() {
  console.log("=== Probability OS Data Layer Test ===");

  console.log("\n[KALSHI CONFIG]");
  console.log(JSON.stringify(getKalshiStatus(), null, 2));

  console.log("\n[BTC PRICE AGGREGATOR]");
  const btc = await getAggregatedBtcPrice();
  console.log(JSON.stringify(btc, null, 2));

  console.log("\n[KALSHI MARKETS]");
  try {
    const markets = await getKalshiMarkets({
      status: "open",
      limit: 5,
    });

    console.log(JSON.stringify({
      ok: markets.ok,
      count: markets.count,
      tickers: markets.markets.map((m) => m.ticker).filter(Boolean).slice(0, 5),
    }, null, 2));

    const firstTicker = markets.markets?.[0]?.ticker;

    if (firstTicker) {
      console.log(`\n[KALSHI ORDERBOOK: ${firstTicker}]`);
      const orderbook = await getKalshiMarketOrderbook(firstTicker);

      console.log(JSON.stringify({
        ok: orderbook.ok,
        ticker: orderbook.ticker,
        yesLevels: orderbook.yes.length,
        noLevels: orderbook.no.length,
        yesTop: orderbook.yes[0] || null,
        noTop: orderbook.no[0] || null,
      }, null, 2));
    } else {
      console.log("[KALSHI] No open markets returned.");
    }
  } catch (error) {
    console.error("[KALSHI DATA TEST FAILED]", {
      message: error.message,
      status: error.status || null,
      body: error.body || null,
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

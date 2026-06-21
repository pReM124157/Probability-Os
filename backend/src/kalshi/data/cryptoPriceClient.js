import { fetchJson, toNumber } from "../utils/http.js";

export async function getCoinbaseBtcUsdTicker() {
  const url = "https://api.exchange.coinbase.com/products/BTC-USD/ticker";
  const data = await fetchJson(url, {
    timeoutMs: Number(process.env.COINBASE_TIMEOUT_MS || 8000),
    headers: {
      "User-Agent": "ProbabilityOS/0.1",
    },
  });

  return {
    provider: "COINBASE",
    symbol: "BTC-USD",
    price: toNumber(data.price),
    bid: toNumber(data.bid),
    ask: toNumber(data.ask),
    volume: toNumber(data.volume),
    time: data.time || new Date().toISOString(),
    raw: data,
  };
}

export async function getBinanceBtcUsdtTicker() {
  const url = "https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT";
  const data = await fetchJson(url, {
    timeoutMs: Number(process.env.BINANCE_TIMEOUT_MS || 8000),
  });

  return {
    provider: "BINANCE",
    symbol: "BTCUSDT",
    price: toNumber(data.price),
    bid: null,
    ask: null,
    volume: null,
    time: new Date().toISOString(),
    raw: data,
  };
}

export async function getKrakenBtcUsdTicker() {
  const url = "https://api.kraken.com/0/public/Ticker?pair=XBTUSD";
  const data = await fetchJson(url, {
    timeoutMs: Number(process.env.KRAKEN_TIMEOUT_MS || 8000),
  });

  const resultKey = data?.result ? Object.keys(data.result)[0] : null;
  const ticker = resultKey ? data.result[resultKey] : null;

  return {
    provider: "KRAKEN",
    symbol: "XBTUSD",
    price: toNumber(ticker?.c?.[0]),
    bid: toNumber(ticker?.b?.[0]),
    ask: toNumber(ticker?.a?.[0]),
    volume: toNumber(ticker?.v?.[1]),
    time: new Date().toISOString(),
    raw: data,
  };
}

export async function getAggregatedBtcPrice() {
  const providers = [
    getCoinbaseBtcUsdTicker,
    getBinanceBtcUsdtTicker,
    getKrakenBtcUsdTicker,
  ];

  const results = await Promise.allSettled(providers.map((fn) => fn()));

  const quotes = results.map((result, index) => {
    if (result.status === "fulfilled") {
      return result.value;
    }

    const providerName = ["COINBASE", "BINANCE", "KRAKEN"][index];

    return {
      provider: providerName,
      symbol: null,
      price: null,
      bid: null,
      ask: null,
      volume: null,
      time: new Date().toISOString(),
      error: result.reason?.message || "UNKNOWN_ERROR",
    };
  });

  const validQuotes = quotes.filter((q) => Number.isFinite(q.price));

  if (validQuotes.length === 0) {
    return {
      ok: false,
      price: null,
      providerCount: 0,
      quotes,
      reason: "NO_VALID_BTC_PRICE",
    };
  }

  const averagePrice =
    validQuotes.reduce((sum, q) => sum + q.price, 0) / validQuotes.length;

  return {
    ok: true,
    symbol: "BTC-USD",
    price: Number(averagePrice.toFixed(2)),
    providerCount: validQuotes.length,
    quotes,
    timestamp: new Date().toISOString(),
  };
}

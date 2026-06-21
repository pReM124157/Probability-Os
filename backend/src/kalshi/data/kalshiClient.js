import { kalshiConfig, getKalshiConfigSummary } from "../utils/kalshiConfig.js";
import { fetchJson } from "../utils/http.js";

function buildUrl(path, params = {}) {
  const url = new URL(`${kalshiConfig.baseUrl}${path}`);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  return url.toString();
}

export function getKalshiStatus() {
  return getKalshiConfigSummary();
}

export async function getKalshiMarkets({
  seriesTicker = kalshiConfig.defaultSeriesTicker,
  status = "open",
  limit = 100,
} = {}) {
  const url = buildUrl("/markets", {
    series_ticker: seriesTicker || undefined,
    status,
    limit,
  });

  const data = await fetchJson(url, {
    timeoutMs: kalshiConfig.requestTimeoutMs,
  });

  return {
    ok: true,
    source: "KALSHI",
    type: "markets",
    count: Array.isArray(data?.markets) ? data.markets.length : 0,
    markets: data?.markets || [],
    raw: data,
  };
}

export async function getKalshiMarketOrderbook(ticker) {
  if (!ticker) {
    return {
      ok: false,
      reason: "MISSING_MARKET_TICKER",
    };
  }

  const url = buildUrl(`/markets/${encodeURIComponent(ticker)}/orderbook`);

  const data = await fetchJson(url, {
    timeoutMs: kalshiConfig.requestTimeoutMs,
  });

  return {
    ok: true,
    source: "KALSHI",
    type: "orderbook",
    ticker,
    yes: data?.orderbook?.yes || [],
    no: data?.orderbook?.no || [],
    raw: data,
  };
}

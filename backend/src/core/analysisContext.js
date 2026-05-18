import { getCompanyOverview } from "../services/marketData.service.js";
import { safeString } from "./safety.js";
import { logMetric } from "../services/telemetry.service.js";

function toTickerCandidate(input) {
  if (typeof input === "string") return safeString(input).toUpperCase();
  if (!input || typeof input !== "object") return "";
  return safeString(
    input.Symbol ||
    input.symbol ||
    input.ticker
  ).toUpperCase();
}

function hasCompanyOverviewShape(input) {
  if (!input || typeof input !== "object") return false;
  return [
    "Name",
    "PERatio",
    "ReturnOnEquityTTM",
    "Sector",
    "BusinessSummary",
    "QuarterlyRevenueGrowthYOY"
  ].some((key) => input[key] !== undefined && input[key] !== null && input[key] !== "");
}

export function extractAnalysisTicker(input) {
  const ticker = toTickerCandidate(input);
  return ticker.replace(/\s+/g, "");
}

export async function buildAnalysisContext(input) {
  const ticker = extractAnalysisTicker(input);
  if (!ticker) {
    throw new Error("Analysis context requires a valid ticker");
  }

  if (hasCompanyOverviewShape(input)) {
    return {
      ticker,
      stockData: {
        ...input,
        Symbol: input.Symbol || ticker
      }
    };
  }

  const stockData = await getCompanyOverview(ticker);
  return {
    ticker,
    stockData: {
      ...stockData,
      Symbol: stockData?.Symbol || ticker
    }
  };
}

function compactObject(obj = {}) {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value !== null && value !== undefined && value !== "" && value !== "-")
  );
}

function signalWhitelist(data = {}) {
  return compactObject({
    symbol: data.Symbol || data.symbol || data.ticker,
    name: data.Name,
    sector: data.Sector,
    marketCap: data.MarketCapitalization,
    pe: data.PERatio,
    roe: data.ReturnOnEquityTTM,
    epsGrowth: data.QuarterlyEarningsGrowthYOY,
    revenueGrowth: data.QuarterlyRevenueGrowthYOY,
    debtEquity: data.DebtToEquityRatio,
    margins: data.ProfitMargin,
    rsi: data.rsi,
    trend: data.trend,
    volatility: data.volatility || data.atr,
    support: data.support,
    resistance: data.resistance,
    momentum: data.momentumScore,
    earningsTrend: data.QuarterlyEarningsGrowthYOY,
    institutionalActivity: data.institutionalActivity || data.volumeRatio
  });
}

function measureContext(agent, raw, curated) {
  const before = JSON.stringify(raw || {}).length;
  const after = JSON.stringify(curated || {}).length;
  logMetric("prompt.context.bytes.before", before, { agent });
  logMetric("prompt.context.bytes.after", after, { agent });
  logMetric("prompt.context.reduction_pct", before > 0 ? Number((((before - after) / before) * 100).toFixed(2)) : 0, { agent });
}

export function buildValuationContext(data = {}) {
  const curated = signalWhitelist(data);
  measureContext("valuation", data, curated);
  return curated;
}

export function buildRiskContext(data = {}) {
  const curated = signalWhitelist(data);
  measureContext("risk", data, curated);
  return curated;
}

export function buildDecisionContext(data = {}) {
  const curated = signalWhitelist(data);
  measureContext("decision", data, curated);
  return curated;
}

export function buildExplainabilityContext(data = {}) {
  const curated = signalWhitelist(data);
  measureContext("explainability", data, curated);
  return curated;
}

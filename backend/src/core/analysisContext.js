import { getCompanyOverview } from "../services/marketData.service.js";
import { safeString } from "./safety.js";

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

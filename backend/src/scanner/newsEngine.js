import { fetchCompanyNews } from "../services/news.service.js";

function classifyHeadline(title) {
  const lower = String(title || "").toLowerCase();
  if (
    lower.includes("upgrade") ||
    lower.includes("beats") ||
    lower.includes("profit") ||
    lower.includes("growth") ||
    lower.includes("wins") ||
    lower.includes("deal") ||
    lower.includes("record")
  ) {
    return "POSITIVE";
  }
  if (
    lower.includes("downgrade") ||
    lower.includes("miss") ||
    lower.includes("loss") ||
    lower.includes("fall") ||
    lower.includes("probe") ||
    lower.includes("risk") ||
    lower.includes("cut")
  ) {
    return "NEGATIVE";
  }
  return "NEUTRAL";
}

export function buildMarketNewsIntel(headlines = []) {
  const counts = { POSITIVE: 0, NEGATIVE: 0, NEUTRAL: 0 };
  headlines.forEach((headline) => {
    counts[classifyHeadline(headline)] += 1;
  });

  const sentiment =
    counts.POSITIVE > counts.NEGATIVE
      ? "POSITIVE"
      : counts.NEGATIVE > counts.POSITIVE
      ? "NEGATIVE"
      : "NEUTRAL";

  return {
    sentiment,
    headlineCount: headlines.length,
    topHeadlines: headlines.slice(0, 5),
    counts
  };
}

export async function buildTickerNewsIntel({ ticker, companyName }) {
  const news = await fetchCompanyNews(ticker, companyName);
  const catalysts = [news.positive, news.negative].filter(
    (item) => item && item !== "News unavailable" && !item.startsWith("No strong")
  );

  return {
    sentiment: news.sentiment || "NEUTRAL",
    catalysts: catalysts.slice(0, 2),
    positive: news.positive,
    negative: news.negative
  };
}

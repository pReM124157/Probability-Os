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
  const safeHeadlines = Array.isArray(headlines) ? headlines : [];
  const counts = { POSITIVE: 0, NEGATIVE: 0, NEUTRAL: 0 };
  safeHeadlines.forEach((headline) => {
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
    headlineCount: safeHeadlines.length,
    topHeadlines: safeHeadlines.slice(0, 5),
    counts
  };
}

export async function buildTickerNewsIntel({ ticker, companyName }) {
  const news = await fetchCompanyNews(ticker, companyName);
  const symbol = String(ticker || "").toUpperCase().replace(/\.NS$/, "");
  const company = String(companyName || "").toLowerCase();
  const now = Date.now();
  const oneDayMs = 24 * 60 * 60 * 1000;
  const rawCatalysts = [news.positive, news.negative].filter(
    (item) => item && item !== "News unavailable" && !item.startsWith("No strong")
  );
  const dedupedCatalysts = Array.from(new Set(rawCatalysts.map((item) => String(item).trim())));

  function catalystWeight(text) {
    const lower = text.toLowerCase();
    const earningsImpact =
      lower.includes("earnings") || lower.includes("results") || lower.includes("guidance")
        ? 4
        : 0;
    const symbolSpecific =
      symbol && (lower.includes(symbol.toLowerCase()) || (company && lower.includes(company)))
        ? 3
        : 0;
    const sectorSpecific =
      lower.includes("sector") || lower.includes("industry") || lower.includes("peer")
        ? 2
        : 0;
    const macroRelevance =
      lower.includes("rbi") ||
      lower.includes("inflation") ||
      lower.includes("rate") ||
      lower.includes("fii") ||
      lower.includes("gdp")
        ? 1
        : 0;
    const stalePenalty =
      news.lastUpdated && now - new Date(news.lastUpdated).getTime() > oneDayMs ? -2 : 0;
    const duplicatePenalty = lower.includes("market today") || lower.includes("sensex") ? -1 : 0;
    return earningsImpact + symbolSpecific + sectorSpecific + macroRelevance + stalePenalty + duplicatePenalty;
  }

  const catalysts = dedupedCatalysts
    .map((item) => ({ item, weight: catalystWeight(item) }))
    .sort((a, b) => b.weight - a.weight)
    .map((entry) => entry.item)
    .slice(0, 2);

  return {
    sentiment: news.sentiment || "NEUTRAL",
    catalysts,
    positive: news.positive,
    negative: news.negative,
    retrievalPriority: ["EARNINGS_IMPACT", "SECTOR_TREND", "MACRO_NEWS", "SOCIAL_SENTIMENT"]
  };
}

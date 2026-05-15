import fetch from "node-fetch";
import { getOrPopulateSharedCache, getSharedCache, setSharedCache } from "./sharedCache.service.js";
import { logError } from "./telemetry.service.js";

const API_KEY = process.env.NEWS_API_KEY;
const NEWS_CACHE_TTL_SECONDS = 5 * 60;
const NEWS_TIMEOUT_MS = 5000;

export async function fetchCompanyNews(symbol, companyName = "") {
  try {
    const cacheKey = `NEWS_${String(symbol || "").toUpperCase()}`;
    const cached = await getSharedCache(cacheKey);
    if (cached) return cached;

    const query = `${companyName || symbol} stock India`;

    const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(
    query
    )}&sortBy=publishedAt&language=en&pageSize=5&apiKey=${API_KEY}`;

    const payload = await getOrPopulateSharedCache(
      cacheKey,
      "company_news",
      NEWS_CACHE_TTL_SECONDS,
      async () => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), NEWS_TIMEOUT_MS);
        try {
          const res = await fetch(url, { signal: controller.signal });
          const text = await res.text();
          if (!text) throw new Error("Empty response");

          const data = JSON.parse(text);

          if (!data.articles || data.articles.length === 0) {
            return {
              positive: "No major positive developments recently.",
              negative: "No major negative developments recently.",
              sentiment: "NEUTRAL"
            };
          }

          const positive = [];
          const negative = [];

          for (const a of data.articles) {
            if (!a.title || a.title.length < 20) continue;

            const t = a.title.toLowerCase();

            if (
              t.includes("profit") ||
              t.includes("growth") ||
              t.includes("gain") ||
              t.includes("expansion") ||
              t.includes("record")
            ) {
              positive.push(a.title);
            } else if (
              t.includes("loss") ||
              t.includes("fall") ||
              t.includes("decline") ||
              t.includes("downgrade") ||
              t.includes("risk")
            ) {
              negative.push(a.title);
            }
          }

          return {
            positive: positive[0] || "No strong positive triggers detected.",
            negative: negative[0] || "No strong negative triggers detected.",
            sentiment:
              positive.length > negative.length
                ? "POSITIVE"
                : negative.length > positive.length
                ? "NEGATIVE"
                : "NEUTRAL"
          };
        } finally {
          clearTimeout(timeoutId);
        }
      },
      {
        lockOwner: `news:${String(symbol || "").toUpperCase()}`,
        fillLockTtlSeconds: 15,
        waitMs: 2500
      }
    );

    await setSharedCache(cacheKey, "company_news", payload, NEWS_CACHE_TTL_SECONDS);
    return payload;
  } catch (err) {
    logError("news.fetch.error", err, { symbol, companyName });

    return {
      positive: "News unavailable",
      negative: "News unavailable",
      sentiment: "NEUTRAL"
    };
  }
}

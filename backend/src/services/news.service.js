import fetch from "node-fetch";

const API_KEY = process.env.NEWS_API_KEY;

export async function fetchCompanyNews(symbol, companyName = "") {
  try {
    const query = `${companyName || symbol} stock India`;

    const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(
      query
    )}&sortBy=publishedAt&language=en&pageSize=5&apiKey=${API_KEY}`;

    const res = await fetch(url);

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

    let positive = [];
    let negative = [];

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
  } catch (err) {
    console.log("NEWS ERROR:", err.message);

    return {
      positive: "News unavailable",
      negative: "News unavailable",
      sentiment: "NEUTRAL"
    };
  }
}
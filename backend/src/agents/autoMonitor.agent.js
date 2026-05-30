import supabase from "../services/supabase.service.js";
import { generateRebalanceAdvice } from "./rebalance.engine.js";
import { sendPortfolioAlert } from "./alert.agent.js";
import { getCompanyOverview } from "../services/marketData.service.js";

export async function runAutoMonitor() {
  console.log("🔍 Running portfolio monitor...");

  const { data: holdings, error } = await supabase
    .from("holdings")
    .select("*");

  if (error) {
    console.error(error);
    return;
  }

  // Map holdings to the format expected by rebalance engine, enriching with sector
  const mappedPortfolio = await Promise.all(
    holdings.map(async (h) => {
      let sector = "Sector unavailable";
      try {
        const overview = await getCompanyOverview(h.symbol);
        if (overview && overview.Sector && overview.Sector.toLowerCase() !== "fallback") {
          sector = overview.Sector.toUpperCase();
        }
      } catch (err) {
        console.warn(`[AUTO-MONITOR] Failed to fetch overview for ${h.symbol}`);
      }

      return {
        symbol: h.symbol,
        investedAmount: Number(h.quantity) * Number(h.avg_price),
        quantity: h.quantity,
        avgPrice: h.avg_price,
        sector: sector
      };
    })
  );

  const result = generateRebalanceAdvice(mappedPortfolio);

  const message = result.status === "DATA_NOT_VALIDATED"
    ? `
🚨 INSTITUTIONAL PORTFOLIO REVIEW
━━━━━━━━━━━━━━━━━━
⚠️ Portfolio data could not be fully validated.

I detected a portfolio review request, but holding weights, sector exposure, or portfolio value are missing/zero.

Use /portfolio for full health details, or send holdings with quantities like:
“I have RELIANCE 10 shares and INFY 5 shares.”
━━━━━━━━━━━━━━━━━━
`.trim()
    : `
🚨 INSTITUTIONAL PORTFOLIO REVIEW
━━━━━━━━━━━━━━━━━━
📊 Dominant Sector: ${result.dominantSector || "N/A"} (${result.sectorPercent || 0}%)
📌 Top Holding: ${result.biggestStock || "N/A"} (${result.stockPercent || 0}%)

🧠 Recommendation:
${result.recommendation}

Use /portfolio for full health details.
━━━━━━━━━━━━━━━━━━
`.trim();

  await sendPortfolioAlert(message);
}
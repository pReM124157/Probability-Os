import supabase from "../services/supabase.service.js";
import { generateRebalanceAdvice } from "./rebalance.engine.js";
import { sendPortfolioAlert } from "./alert.agent.js";

export async function runAutoMonitor() {
  console.log("🔍 Running portfolio monitor...");

  const { data: holdings, error } = await supabase
    .from("holdings")
    .select("*");

  if (error) {
    console.error(error);
    return;
  }

  // Map holdings to the format expected by rebalance engine
  const mappedPortfolio = holdings.map(h => ({
    symbol: h.symbol,
    investedAmount: Number(h.quantity) * Number(h.avg_price),
    quantity: h.quantity,
    avgPrice: h.avg_price
  }));

  const result = generateRebalanceAdvice(mappedPortfolio);

  const message = `
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
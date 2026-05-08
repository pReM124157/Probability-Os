import { getIndianIndices, getIndianMarketNews, getIndianSectors } from "../services/marketData.service.js";
import { buildMarketNewsIntel } from "./newsEngine.js";

function classifyMarketRegime(change) {
  if (change >= 1.0) return "RISK_ON";
  if (change <= -1.0) return "RISK_OFF";
  return "BALANCED";
}

export async function getMarketOverview() {
  const [indices, sectorSnapshot, headlines] = await Promise.all([
    getIndianIndices(),
    getIndianSectors(),
    getIndianMarketNews()
  ]);

  const newsIntel = buildMarketNewsIntel(headlines);
  const regime = classifyMarketRegime(Number(indices?.nifty?.change || 0));

  return {
    regime,
    indices,
    sectors: sectorSnapshot,
    news: newsIntel,
    openingBias:
      regime === "RISK_ON"
        ? "Positive breadth expected into the open"
        : regime === "RISK_OFF"
        ? "Defensive open likely unless breadth improves"
        : "Balanced opening setup with selective opportunities"
  };
}

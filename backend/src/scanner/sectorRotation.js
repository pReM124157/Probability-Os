import { getSectorMomentum } from "../services/intelligence.service.js";
import { normalizeSector } from "./convictionEngine.js";

function sectorBiasToRank(bias) {
  const key = String(bias || "").toUpperCase();
  if (key.includes("STRONG_BULLISH")) return 9;
  if (key.includes("BULLISH")) return 7;
  if (key.includes("BEARISH")) return 4;
  return 5;
}

export async function buildSectorRotation({ rankedStocks = [], marketSectorSnapshot = {} }) {
  const sectorMomentum = await getSectorMomentum();
  if (!sectorMomentum || sectorMomentum?.unavailable) return [];
  const sectorMap = new Map();

  const safeSectorMomentum = (sectorMomentum && typeof sectorMomentum === "object") ? sectorMomentum : {};
  Object.entries(safeSectorMomentum).forEach(([sector, data]) => {
    if (!data) return;
    sectorMap.set(sector, {
      sector,
      bias: data.bias || "NEUTRAL",
      strength: Number(data.strength || 0),
      marketChange: 0,
      leaders: [],
      avgConviction: 0
    });
  });

  if (marketSectorSnapshot.bank !== undefined) {
    const banking = sectorMap.get("BANKING") || {
      sector: "BANKING",
      bias: "NEUTRAL",
      strength: 0,
      leaders: [],
      avgConviction: 0
    };
    banking.marketChange = Number(marketSectorSnapshot.bank || 0);
    sectorMap.set("BANKING", banking);
  }

  if (marketSectorSnapshot.it !== undefined) {
    const it = sectorMap.get("IT") || {
      sector: "IT",
      bias: "NEUTRAL",
      strength: 0,
      leaders: [],
      avgConviction: 0
    };
    it.marketChange = Number(marketSectorSnapshot.it || 0);
    sectorMap.set("IT", it);
  }

  const safeRanked = Array.isArray(rankedStocks) ? rankedStocks : [];
  safeRanked.forEach((stock) => {
    const sector = normalizeSector(stock.sector);
    const existing = sectorMap.get(sector) || {
      sector,
      bias: "NEUTRAL",
      strength: 0,
      marketChange: 0,
      leaders: [],
      avgConviction: 0
    };
    existing.leaders.push({
      ticker: stock.ticker,
      convictionScore: stock.convictionScore,
      rr: stock.rr
    });
    sectorMap.set(sector, existing);
  });

  const rotations = Array.from(sectorMap.values()).map((item) => {
    const leaders = item.leaders
      .sort((a, b) => b.convictionScore - a.convictionScore)
      .slice(0, 3);
    const avgConviction =
      leaders.length > 0
        ? leaders.reduce((sum, leader) => sum + leader.convictionScore, 0) / leaders.length
        : 0;
    const sectorScore =
      (sectorBiasToRank(item.bias) * 0.5) +
      (Number(item.marketChange || 0) * 0.7) +
      (avgConviction * 0.4);

    return {
      sector: item.sector,
      bias: item.bias,
      strength: Number(item.strength || 0),
      marketChange: Number(Number(item.marketChange || 0).toFixed(2)),
      avgConviction: Number(avgConviction.toFixed(2)),
      sectorScore: Number(sectorScore.toFixed(2)),
      leaders
    };
  });

  return rotations.sort((a, b) => b.sectorScore - a.sectorScore);
}

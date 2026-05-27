import { getCompanyOverview, getLiveMarketData } from "../services/marketData.service.js";
import { buildCapitalProtectionState, getInstitutionalRuntimeSnapshot } from "../services/institutionalStatus.service.js";

const SECTOR_FALLBACKS = {
  TCS: "INFORMATION TECHNOLOGY",
  INFY: "INFORMATION TECHNOLOGY",
  INFOSYS: "INFORMATION TECHNOLOGY",
  WIPRO: "INFORMATION TECHNOLOGY",
  HCLTECH: "INFORMATION TECHNOLOGY",
  TECHM: "INFORMATION TECHNOLOGY",
  LTIM: "INFORMATION TECHNOLOGY",
  HDFCBANK: "FINANCIALS",
  ICICIBANK: "FINANCIALS",
  AXISBANK: "FINANCIALS",
  SBIN: "FINANCIALS",
  KOTAKBANK: "FINANCIALS",
  BAJFINANCE: "FINANCIALS",
  BAJAJFINSV: "FINANCIALS",
  RELIANCE: "ENERGY",
  ONGC: "ENERGY",
  BPCL: "ENERGY",
  POWERGRID: "UTILITIES",
  NTPC: "UTILITIES",
  SUNPHARMA: "PHARMA",
  DRREDDY: "PHARMA",
  CIPLA: "PHARMA",
  DIVISLAB: "PHARMA",
  APOLLOHOSP: "HEALTHCARE",
  TATACONSUM: "CONSUMPTION",
  HINDUNILVR: "CONSUMPTION",
  ITC: "CONSUMPTION",
  BRITANNIA: "CONSUMPTION",
  NESTLEIND: "CONSUMPTION",
  TITAN: "CONSUMPTION",
  ASIANPAINT: "CONSUMPTION",
  TATAMOTORS: "AUTO",
  MARUTI: "AUTO",
  M_M: "AUTO",
  MANDM: "AUTO",
  BAJAJ_AUTO: "AUTO",
  EICHERMOT: "AUTO",
  HEROMOTOCO: "AUTO",
  TATASTEEL: "METALS",
  JSWSTEEL: "METALS",
  HINDALCO: "METALS",
  ULTRACEMCO: "CAPITAL GOODS",
  LT: "CAPITAL GOODS",
  ADANIPORTS: "INFRASTRUCTURE"
};

function normalizeTicker(symbol) {
  return String(symbol || "")
    .toUpperCase()
    .replace(/\.NS|\.BO/g, "")
    .replace(/[^A-Z0-9]/g, "_");
}

function formatCurrency(value) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0
  }).format(value || 0);
}

function canonicalSectorName(rawSector, symbol) {
  const normalized = String(rawSector || "").trim().toUpperCase();
  const aliases = {
    TECHNOLOGY: "INFORMATION TECHNOLOGY",
    "INFORMATION TECHNOLOGY": "INFORMATION TECHNOLOGY",
    IT: "INFORMATION TECHNOLOGY",
    BANKING: "FINANCIALS",
    "FINANCIAL SERVICES": "FINANCIALS",
    FINANCIAL: "FINANCIALS",
    FINANCIALS: "FINANCIALS",
    INSURANCE: "FINANCIALS",
    HEALTHCARE: "PHARMA",
    PHARMACEUTICALS: "PHARMA",
    PHARMA: "PHARMA",
    FMCG: "CONSUMPTION",
    CONSUMER: "CONSUMPTION",
    "CONSUMER DEFENSIVE": "CONSUMPTION",
    "CONSUMER CYCLICAL": "CONSUMPTION",
    ENERGY: "ENERGY",
    UTILITIES: "UTILITIES",
    AUTO: "AUTO",
    AUTOMOBILE: "AUTO",
    AUTOMOBILES: "AUTO",
    METALS: "METALS",
    MATERIALS: "METALS",
    INDUSTRIALS: "CAPITAL GOODS",
    "CAPITAL GOODS": "CAPITAL GOODS",
    REALTY: "REAL ESTATE",
    "REAL ESTATE": "REAL ESTATE",
    COMMUNICATION: "TELECOM",
    TELECOM: "TELECOM"
  };

  // If the provider returned a real sector that isn't "FALLBACK"
  if (normalized && normalized !== "FALLBACK") {
    return aliases[normalized] || normalized;
  }

  // Only use hardcoded fallbacks if the provider failed to give us a sector
  const fallback = SECTOR_FALLBACKS[normalizeTicker(symbol)];
  return fallback || "Sector unavailable";
}

function normalizeDisplaySector(sector = "") {
  return String(sector || "Unknown")
    .toLowerCase()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function scoreBand(value, bands, fallback = 5) {
  for (const band of bands) {
    if (band.test(value)) return band.score;
  }
  return fallback;
}

function derivePortfolioPersonality({ topSector, topHoldingWeight, cashWeight, sectorCount }) {
  if (cashWeight >= 12) return "Defensive";
  if (topHoldingWeight >= 35) return "Aggressive";
  if (topSector === "INFORMATION TECHNOLOGY" || topSector === "AUTO") return "Growth-Oriented";
  if (topSector === "FINANCIALS" && sectorCount >= 4) return "Balanced";
  if (topSector === "CONSUMPTION" || topSector === "UTILITIES") return "Defensive";
  return "Moderately Balanced";
}

function strongestHoldingStatus(pnlPct) {
  if (pnlPct >= 15) return "OUTPERFORMING";
  if (pnlPct >= 7) return "IMPROVING";
  if (pnlPct >= 0) return "STABLE";
  return "UNDERPERFORMING";
}

function holdingInsight(holding) {
  const sector = holding.sector;
  const insightMap = {
    "INFORMATION TECHNOLOGY": "Export execution and profitability remain the key drivers of trend quality.",
    FINANCIALS: "Credit growth and deposit quality are the main stability anchors here.",
    PHARMA: "Defensive earnings visibility improves downside resilience for this position.",
    CONSUMPTION: "Domestic demand and pricing power provide balance against cyclical volatility.",
    ENERGY: "Commodity and policy sensitivity can amplify swings despite strong cash generation.",
    AUTO: "Demand momentum and margin durability remain the primary trend drivers.",
    "CAPITAL GOODS": "Execution visibility and capex momentum support medium-term positioning."
  };
  return insightMap[sector] || "Position quality is tied to sector leadership and execution consistency.";
}

function diversificationRead({ topSectorWeight, sectorCount, topHoldingWeight }) {
  if (topSectorWeight >= 50) {
    return "Portfolio remains heavily tilted toward one sector, creating elevated concentration risk. Diversification is currently limited.";
  }
  if (topHoldingWeight >= 35) {
    return "Single-position dependency is meaningful. Sector breadth is present, but portfolio balance is still only moderate.";
  }
  if (sectorCount >= 4) {
    return "Sector mix is reasonably diversified, which improves stability across market regimes.";
  }
  return "Diversification is improving, but additional sector balance would strengthen risk-adjusted resilience.";
}

function computeHealthScore({ stockCount, sectorCount, topHoldingWeight, topSectorWeight, cashWeight, losersWeight }) {
  const diversificationScore = scoreBand(stockCount, [
    { test: (v) => v >= 10, score: 9.2 },
    { test: (v) => v >= 7, score: 7.8 },
    { test: (v) => v >= 5, score: 6.5 },
    { test: () => true, score: 4.8 }
  ]);
  const concentrationScore = scoreBand(topHoldingWeight, [
    { test: (v) => v <= 15, score: 9.3 },
    { test: (v) => v <= 25, score: 7.8 },
    { test: (v) => v <= 35, score: 6.2 },
    { test: (v) => v <= 50, score: 4.5 },
    { test: () => true, score: 3.0 }
  ]);
  const sectorBalanceScore = scoreBand(topSectorWeight, [
    { test: (v) => v <= 25, score: 9.0 },
    { test: (v) => v <= 40, score: 7.4 },
    { test: (v) => v <= 50, score: 5.8 },
    { test: () => true, score: 3.8 }
  ]);
  const drawdownRiskScore = scoreBand(losersWeight, [
    { test: (v) => v <= 10, score: 8.5 },
    { test: (v) => v <= 20, score: 7.2 },
    { test: (v) => v <= 35, score: 5.8 },
    { test: () => true, score: 4.2 }
  ]);
  const cashReserveScore = scoreBand(cashWeight, [
    { test: (v) => v >= 5 && v <= 12, score: 8.2 },
    { test: (v) => v > 0 && v < 5, score: 6.0 },
    { test: (v) => v > 12 && v <= 20, score: 7.2 },
    { test: () => true, score: 4.8 }
  ]);

  const total =
    (diversificationScore * 0.20) +
    (concentrationScore * 0.25) +
    (sectorBalanceScore * 0.20) +
    (drawdownRiskScore * 0.15) +
    (cashReserveScore * 0.10) +
    (Math.min(sectorCount, 5) * 0.2);

  return Number(Math.min(10, total).toFixed(1));
}

function healthLabel(score) {
  if (score >= 8) return "Well Balanced";
  if (score >= 6) return "Moderately Balanced";
  if (score >= 4.5) return "Needs Rebalancing";
  return "High Risk Structure";
}

function concentrationLabel(weight) {
  if (weight >= 50) return "Elevated";
  if (weight >= 35) return "Moderate";
  return "Controlled";
}

function riskInterpretation({ topHoldingWeight, topSectorWeight, losersWeight }) {
  if (topHoldingWeight >= 50 || topSectorWeight >= 55) return "HIGH";
  if (topHoldingWeight >= 30 || topSectorWeight >= 40 || losersWeight >= 20) return "MEDIUM";
  return "LOW";
}

function preferredSectors(topSector) {
  if (topSector === "INFORMATION TECHNOLOGY") {
    return ["Financials", "Pharma", "Capital Goods"];
  }
  if (topSector === "FINANCIALS") {
    return ["Consumption", "Pharma", "Utilities"];
  }
  return ["Financials", "Pharma", "Consumption"];
}

function weakSectors(topSector) {
  if (topSector === "INFORMATION TECHNOLOGY") {
    return ["Export IT", "Metals"];
  }
  return ["Metals", "High Beta Cyclicals"];
}

export async function buildPortfolioReview(holdings = []) {
  if (!Array.isArray(holdings) || holdings.length === 0) {
    return {
      empty: true,
      message: "Your portfolio is empty.\nUse /add TICKER QTY PRICE to add holdings."
    };
  }

  const enriched = await Promise.all(
    holdings.map(async (holding) => {
      const symbol = String(holding.symbol || "").toUpperCase();
      const [overview, live] = await Promise.all([
        getCompanyOverview(symbol).catch(() => null),
        getLiveMarketData(symbol).catch(() => null)
      ]);

      const quantity = Number(holding.quantity || 0);
      const avgPrice = Number(holding.avgPrice ?? holding.avg_price ?? holding.buyPrice ?? 0);
      const currentPrice = Number(live?.currentPrice || live?.price || avgPrice || 0);
      const safeQuantity = Number.isFinite(quantity) && quantity > 0 ? quantity : 0;
      const safeAvgPrice = Number.isFinite(avgPrice) && avgPrice > 0 ? avgPrice : 0;
      const safeCurrentPrice = Number.isFinite(currentPrice) && currentPrice > 0 ? currentPrice : safeAvgPrice;
      const invested = safeQuantity * safeAvgPrice;
      const currentValue = safeQuantity * safeCurrentPrice;
      const pnlAmount = currentValue - invested;
      const pnlPct = invested > 0 ? ((currentValue - invested) / invested) * 100 : 0;
      const sector = canonicalSectorName(overview?.Sector, symbol);

      return {
        symbol,
        name: overview?.Name || symbol,
        quantity: safeQuantity,
        avgPrice: safeAvgPrice,
        currentPrice: safeCurrentPrice,
        invested,
        currentValue,
        pnlAmount,
        pnlPct,
        sector
      };
    })
  );

  const totalInvested = enriched.reduce((sum, item) => sum + item.invested, 0);
  const totalValue = enriched.reduce((sum, item) => sum + item.currentValue, 0);
  const safeTotalValue = Number(totalValue || 0);
  const totalPnL = totalValue - totalInvested;
  const totalPnLPct = totalInvested > 0 ? (totalPnL / totalInvested) * 100 : 0;

  const holdingsWithWeights = enriched
    .map((item) => ({
      ...item,
      weight: safeTotalValue > 0
        ? Number(((item.currentValue / safeTotalValue) * 100).toFixed(2))
        : 0
    }))
    .sort((a, b) => b.weight - a.weight);

  const sectorBuckets = new Map();
  holdingsWithWeights.forEach((holding) => {
    const bucket = sectorBuckets.get(holding.sector) || { sector: holding.sector, value: 0, holdings: [] };
    bucket.value += holding.currentValue;
    bucket.holdings.push(holding);
    sectorBuckets.set(holding.sector, bucket);
  });

  const sectors = Array.from(sectorBuckets.values())
    .map((bucket) => ({
      sector: bucket.sector,
      weight: safeTotalValue > 0
        ? Number(((bucket.value / safeTotalValue) * 100).toFixed(2))
        : 0,
      holdings: bucket.holdings.sort((a, b) => b.weight - a.weight)
    }))
    .sort((a, b) => b.weight - a.weight);

  const topHolding = holdingsWithWeights[0];
  const topSector = sectors[0];
  const losersWeight = holdingsWithWeights
    .filter((holding) => holding.pnlPct < 0)
    .reduce((sum, holding) => sum + holding.weight, 0);
  const cashWeight = sectors
    .filter((sector) => sector.sector === "CASH / DEFENSIVE")
    .reduce((sum, sector) => sum + sector.weight, 0);
  const score = computeHealthScore({
    stockCount: holdingsWithWeights.length,
    sectorCount: sectors.length,
    topHoldingWeight: topHolding?.weight || 0,
    topSectorWeight: topSector?.weight || 0,
    cashWeight,
    losersWeight
  });

  const personality = derivePortfolioPersonality({
    topSector: topSector?.sector,
    topHoldingWeight: topHolding?.weight || 0,
    cashWeight,
    sectorCount: sectors.length
  });

  const strongest = [...holdingsWithWeights]
    .sort((a, b) => (b.pnlPct * b.weight) - (a.pnlPct * a.weight))
    .slice(0, 2)
    .map((holding) => ({
      symbol: holding.symbol,
      weight: Number(holding.weight.toFixed(1)),
      pnlPct: Number(holding.pnlPct.toFixed(1)),
      status: strongestHoldingStatus(holding.pnlPct),
      insight: holdingInsight(holding)
    }));

  const riskFlags = [];
  if ((topSector?.weight || 0) >= 45) {
    riskFlags.push({
      title: `OVERWEIGHT ${topSector.sector} EXPOSURE`,
      detail: `Current allocation at ${topSector.weight.toFixed(1)}% exceeds healthy diversification levels and increases sector-specific downside risk.`
    });
  }
  if ((topHolding?.weight || 0) >= 35) {
    riskFlags.push({
      title: "POSITION SIZE WARNING",
      detail: `${topHolding.symbol} at ${topHolding.weight.toFixed(1)}% creates meaningful single-stock dependency within the portfolio.`
    });
  }
  if (losersWeight >= 20) {
    riskFlags.push({
      title: "DRAWDOWN CLUSTER",
      detail: `${losersWeight.toFixed(1)}% of current value sits in losing positions, which can weigh on recovery velocity if market breadth weakens.`
    });
  }

  const actions = [];
  if ((topHolding?.weight || 0) >= 35) actions.push(`Gradually reduce ${topHolding.symbol} concentration`);
  if ((topSector?.weight || 0) >= 45) actions.push(`Diversify away from ${topSector.sector.toLowerCase()} into domestic-facing sectors`);
  actions.push(`Increase exposure to ${preferredSectors(topSector?.sector)[0].toLowerCase()} and ${preferredSectors(topSector?.sector)[1].toLowerCase()}`);
  actions.push("Add defensive consumption allocation");
  actions.push("Maintain 5–10% strategic cash reserve");

  const activeSystems = [
    { name: "Portfolio Defense Agent", active: true },
    { name: "Correlation Stress Engine", active: holdingsWithWeights.length >= 2 },
    { name: "Adaptive Learning Layer", active: true },
    { name: "Statistical Validation Engine", active: true },
    { name: "Market Regime Detection", active: sectors.length > 0 },
    { name: "Volatility Surveillance", active: holdingsWithWeights.length > 0 },
    { name: "Liquidity Monitoring", active: holdingsWithWeights.length > 0 },
    { name: "Recommendation Outcome Tracker", active: true }
  ];

  const activeRiskNotes = [];
  if ((topSector?.weight || 0) >= 35) {
    activeRiskNotes.push(`${normalizeDisplaySector(topSector?.sector || "Top sector")} concentration elevated`);
  }
  if ((topHolding?.pnlPct || 0) < 0) {
    activeRiskNotes.push(`Momentum weakening in ${topHolding.symbol} exposure`);
  }
  if (activeRiskNotes.length === 0) {
    activeRiskNotes.push("No immediate concentration shock detected");
  }
  const runtime = await getInstitutionalRuntimeSnapshot();
  const capitalProtection = buildCapitalProtectionState({
    score,
    details: {
      topHoldingWeight: Number((topHolding?.weight || 0).toFixed(1)),
      topSectorWeight: Number((topSector?.weight || 0).toFixed(1))
    }
  }, runtime);

  return {
    empty: false,
    score,
    healthLabel: healthLabel(score),
    totalValue,
    totalInvested,
    totalPnL,
    totalPnLPct,
    concentrationRisk: concentrationLabel(topSector?.weight || 0),
    personality,
    sectors: sectors.map((sector) => ({
      sector: sector.sector,
      weight: Number(sector.weight.toFixed(1)),
      holdings: sector.holdings.map((holding) => holding.symbol)
    })),
    diversificationRead: diversificationRead({
      topSectorWeight: topSector?.weight || 0,
      sectorCount: sectors.length,
      topHoldingWeight: topHolding?.weight || 0
    }),
    strongestHoldings: strongest,
    riskFlags,
    actions,
    preferredSectors: preferredSectors(topSector?.sector),
    weakSectors: weakSectors(topSector?.sector),
    strategicOutlook:
      (topSector?.weight || 0) >= 45
        ? `Portfolio quality remains solid, but concentration risk is elevated. Current structure favors ${personality.toLowerCase()} positioning over balance, making performance more sensitive to ${topSector.sector.toLowerCase()} volatility.`
        : `Portfolio quality is improving with a more balanced sector mix. Selective diversification can further strengthen long-term risk-adjusted returns without sacrificing upside.`,
    riskLevel: riskInterpretation({
      topHoldingWeight: topHolding?.weight || 0,
      topSectorWeight: topSector?.weight || 0,
      losersWeight
    }),
    details: {
      holdings: holdingsWithWeights.map((holding) => ({
        ...holding,
        weight: Number(holding.weight.toFixed(1)),
        pnlPct: Number(holding.pnlPct.toFixed(1))
      })),
      sectorCount: sectors.length,
      stockCount: holdingsWithWeights.length,
      topSector: topSector?.sector || "Sector unavailable",
      topSectorWeight: Number((topSector?.weight || 0).toFixed(1)),
      topHolding: topHolding?.symbol || "NONE",
      topHoldingWeight: Number((topHolding?.weight || 0).toFixed(1)),
      formatted: {
        totalValue: formatCurrency(totalValue),
        totalInvested: formatCurrency(totalInvested),
        totalPnL: `${totalPnL >= 0 ? "+" : "-"}${formatCurrency(Math.abs(totalPnL))}`
      },
      activeSystems,
      activeRiskNotes,
      runtime,
      capitalProtection
    }
  };
}

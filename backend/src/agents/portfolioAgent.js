export async function analyzePortfolio(stocks) {
  if (!stocks || stocks.length === 0) {
    return {
      healthScore: 0,
      dominantSector: "No holdings",
      highestStock: { symbol: "None", normalizedAllocation: 0 },
      dominantSectorWeight: "0",
      topAllocation: 0,
      suggestion: "Add portfolio holdings first"
    };
  }
  try {
    let portfolio = [];
    let sectorMap = {};
    let totalWeight = 0;

    for (const item of stocks) {
      const symbol = item.symbol?.toLowerCase() || "unknown";
      const allocation = Number(item.allocation || 100);

      const sectorLookup = {
        tcs: "IT",
        infosys: "IT",
        wipro: "IT",
        hdfcbank: "Banking",
        icicibank: "Banking",
        reliance: "Energy",
        asianpaints: "FMCG",
        hul: "FMCG",
        sunpharma: "Pharma",
        cipla: "Pharma",
        titan: "Consumer",
      };
      const sector = sectorLookup[symbol] || "Unknown";

      portfolio.push({
        symbol,
        allocation,
        sector,
      });

      totalWeight += allocation;

      if (!sectorMap[sector]) {
        sectorMap[sector] = 0;
      }

      sectorMap[sector] += allocation;
    }

    // Calculate position values
    let totalPortfolioValue = 0;
    const evaluatedPortfolio = stocks.map(item => {
      const val = (Number(item.quantity) || 0) * (Number(item.currentPrice || item.avgPrice) || 0);
      totalPortfolioValue += val;
      return {
        ...item,
        positionValue: val
      };
    });

    // Normalize weights
    const enrichedPortfolio = evaluatedPortfolio.map(item => ({
      ...item,
      weight: totalPortfolioValue > 0 ? (item.positionValue / totalPortfolioValue) * 100 : 0
    }));

    // Find dominant sector
    const finalSectorMap = {};
    enrichedPortfolio.forEach(item => {
      const sector = item.sector || "Other";
      finalSectorMap[sector] = (finalSectorMap[sector] || 0) + item.weight;
    });

    let dominantSector = "None";
    let dominantWeight = 0;
    for (const [sector, weight] of Object.entries(finalSectorMap)) {
      if (weight > dominantWeight) {
        dominantWeight = weight;
        dominantSector = sector;
      }
    }

    return {
      holdings: enrichedPortfolio,
      totalValue: totalPortfolioValue,
      dominantSector,
      dominantSectorWeight: dominantWeight.toFixed(2),
      totalWeight: enrichedPortfolio.reduce((sum, h) => sum + h.weight, 0)
    };
  } catch (error) {
    console.error(error);
    throw error;
  }
}

export async function portfolioAgent(data) {
  return await analyzePortfolio([data]);
}
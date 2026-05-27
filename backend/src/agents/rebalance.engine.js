export function generateRebalanceAdvice(portfolio) {
  if (!portfolio || portfolio.length === 0) {
    return {
      alert: "No portfolio data available",
      recommendation: "Add holdings first"
    };
  }

  let total = portfolio.reduce((sum, stock) => sum + (Number(stock.investedAmount) || 0), 0);
  const safeTotalValue = Number(total || 0);

  let sectorMap = {};
  let biggestStock = null;

  for (const stock of portfolio) {
    const sector = stock.sector || "Sector unavailable";

    if (!sectorMap[sector]) {
      sectorMap[sector] = 0;
    }

    sectorMap[sector] += Number(stock.investedAmount) || 0;

    if (
      !biggestStock ||
      stock.investedAmount > biggestStock.investedAmount
    ) {
      biggestStock = stock;
    }
  }

  let dominantSector = "";
  let dominantValue = 0;

  for (const sector in sectorMap) {
    if (sectorMap[sector] > dominantValue) {
      dominantValue = sectorMap[sector];
      dominantSector = sector;
    }
  }

  const sectorPercent = safeTotalValue > 0
    ? Number(((dominantValue / safeTotalValue) * 100).toFixed(2))
    : 0;
  const stockPercent = safeTotalValue > 0
    ? Number((((Number(biggestStock?.investedAmount) || 0) / safeTotalValue) * 100).toFixed(2))
    : 0;

  let recommendation = [];

  if (sectorPercent > 50) {
    recommendation.push(
      `Reduce ${dominantSector} exposure (${sectorPercent.toFixed(2)}%)`
    );
  }

  if (stockPercent > 30) {
    recommendation.push(
      `Trim ${biggestStock.symbol} allocation (${stockPercent.toFixed(2)}%)`
    );
  }

  if (recommendation.length === 0) {
    recommendation.push("Allocation currently within institutional risk guardrails");
  }

  return {
    dominantSector,
    sectorPercent,
    biggestStock: biggestStock?.symbol || "N/A",
    stockPercent: stockPercent.toFixed(2),
    recommendation: recommendation.join(". ")
  };
}

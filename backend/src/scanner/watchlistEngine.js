export function buildWatchlists(rankedStocks = []) {
  const highRiskWatchlist = rankedStocks
    .filter((stock) => stock.volatilityBand === "HIGH" || stock.riskLevel === "HIGH")
    .map((stock) => ({
      ticker: stock.ticker,
      riskLevel: stock.riskLevel,
      volatilityBand: stock.volatilityBand,
      reason: stock.volatilityBand === "HIGH"
        ? "Elevated ATR profile"
        : "Risk model flagged high risk"
    }));

  const weakSetupWatchlist = rankedStocks
    .filter((stock) => stock.convictionScore < 6 || stock.rr < 1.5 || stock.trend === "BEARISH")
    .map((stock) => ({
      ticker: stock.ticker,
      convictionScore: stock.convictionScore,
      rr: stock.rr,
      trend: stock.trend
    }));

  return {
    highRiskWatchlist,
    weakSetupWatchlist
  };
}

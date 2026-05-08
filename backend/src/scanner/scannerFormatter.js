export function formatMorningScannerReport({
  generatedAt,
  marketOverview,
  sectorRotation,
  institutionalFlows,
  rankedStocks,
  watchlists
}) {
  const lines = [];
  lines.push("FinSight Morning Market Intelligence");
  lines.push(`Generated: ${generatedAt}`);
  lines.push("");
  lines.push(`Opening Bias: ${marketOverview.openingBias}`);
  lines.push(`Regime: ${marketOverview.regime}`);
  lines.push(`Flow: ${institutionalFlows.note}`);
  lines.push("");
  lines.push("Top Sector Rotation:");

  sectorRotation.slice(0, 3).forEach((sector, index) => {
    lines.push(
      `${index + 1}. ${sector.sector} | Bias: ${sector.bias} | Score: ${sector.sectorScore}`
    );
  });

  lines.push("");
  lines.push("Conviction Opportunities:");
  rankedStocks.forEach((stock, index) => {
    lines.push(
      `${index + 1}. ${stock.ticker} | ${stock.convictionScore}/10 | ${stock.decision} | RR ${stock.rr} | ${stock.thesis}`
    );
  });

  if (watchlists.highRiskWatchlist.length > 0) {
    lines.push("");
    lines.push("High Risk Watchlist:");
    watchlists.highRiskWatchlist.slice(0, 3).forEach((item) => {
      lines.push(`${item.ticker} | ${item.reason}`);
    });
  }

  if (watchlists.weakSetupWatchlist.length > 0) {
    lines.push("");
    lines.push("Weak Setups Filtered:");
    watchlists.weakSetupWatchlist.slice(0, 3).forEach((item) => {
      lines.push(`${item.ticker} | Conviction ${item.convictionScore} | RR ${item.rr}`);
    });
  }

  return lines.join("\n");
}

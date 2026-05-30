function formatCurrency(value) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0
  }).format(value || 0);
}

export function formatPortfolioReview(review, options = {}) {
  if (!review || review.empty) {
    return review?.message || "Portfolio unavailable.";
  }

  const lines = [];
  const topTwoHoldings = (review?.details?.holdings || []).slice(0, 2);
  const activeSystems = Array.isArray(review?.details?.runtime?.systems)
    ? review.details.runtime.systems
    : (Array.isArray(review?.details?.activeSystems) ? review.details.activeSystems : []);
  const activeRisks = Array.isArray(review?.details?.activeRiskNotes) ? review.details.activeRiskNotes : [];
  const runtime = review?.details?.runtime || {};
  const marketInfra = runtime.marketInfra || {};
  const surveillance = runtime.surveillance || {};
  const capitalProtection = review?.details?.capitalProtection || {};
  const score100 = Math.max(0, Math.min(100, Math.round((Number(review.score) || 0) * 10)));
  const riskState = score100 >= 80 ? "LOW" : score100 >= 60 ? "MODERATE" : "ELEVATED";
  const detailed = options?.detailed === true;

  lines.push("🚨 FINSIGHT — LIVE PORTFOLIO COMMAND CENTER");
  lines.push("━━━━━━━━━━━━━━━━━━");
  const investedCapital =
    Number(review?.totalInvested) ||
    Number(review?.investedCapital) ||
    Number(review?.details?.totalInvested) ||
    Number(review?.details?.investedCapital) ||
    0;

  const hasCostBasis = Number.isFinite(investedCapital) && investedCapital > 0;
  const totalPnL = Number(review?.totalPnL);
  const totalPnLPct = Number(review?.totalPnLPct);
  const hasValidPnL =
    hasCostBasis &&
    Number.isFinite(totalPnL) &&
    Number.isFinite(totalPnLPct);

  lines.push(`📊 Portfolio Value: ${formatCurrency(review.totalValue)}`);
  lines.push(`💼 Invested Capital: ${hasCostBasis ? formatCurrency(investedCapital) : "Not available"}`);
  lines.push(
    hasValidPnL
      ? `📈 Unrealized P/L: ${totalPnL >= 0 ? "+" : "-"}${formatCurrency(Math.abs(totalPnL))} (${totalPnLPct >= 0 ? "+" : ""}${totalPnLPct.toFixed(2)}%)`
      : "📈 Unrealized P/L: Not available — cost basis missing"
  );
  lines.push(`🧾 Holdings Count: ${review?.details?.stockCount || 0}`);
  lines.push("🏦 Sector Exposure");

  review.sectors.forEach((sector) => {
    lines.push(`• ${normalizeSector(sector.sector)}: ${Number(sector.weight || 0).toFixed(1)}%`);
  });

  lines.push("🎯 Largest Exposure");
  topTwoHoldings.forEach((h) => {
    lines.push(`• ${h.symbol} → ${Number(h.weight || 0).toFixed(1)}%`);
  });
  lines.push("🧠 ACTIVE INSTITUTIONAL SYSTEMS");
  activeSystems.forEach((system) => {
    const state = String(system.state || (system.active ? "ONLINE" : "DEGRADED")).toUpperCase();
    const icon = state === "ONLINE" ? "✅" : (state === "DEGRADED" ? "🟡" : "❌");
    const last = system.lastExecutionAt ? ` (${formatAgo(system.lastExecutionAt)})` : "";
    lines.push(`${icon} ${system.name}${last}`);
  });
  lines.push("📡 MARKET INFRASTRUCTURE");
  lines.push(`• Market State: ${marketInfra.marketState || "UNKNOWN"}`);
  lines.push(`• Data Reliability: ${marketInfra.dataReliability || "UNKNOWN"}`);
  lines.push(`• Active Providers: ${(marketInfra.activeProviders || []).join(", ") || "Unavailable"}`);
  lines.push(`• Provider Health Score: ${Number(marketInfra.providerHealthScore || 0)}/100`);
  lines.push(`• Cache State: ${marketInfra.cacheState || "UNKNOWN"}`);
  lines.push(`• Last Market Sync: ${formatAgo(marketInfra.lastMarketSyncAt)}`);
  lines.push("🛡 CAPITAL PROTECTION STATE");
  lines.push(`• Deployment Mode: ${capitalProtection.deploymentMode || "NORMAL"}`);
  lines.push(`• Risk Budget Usage: ${Number(capitalProtection.riskBudgetUsage || 0)}%`);
  lines.push(`• Concentration State: ${capitalProtection.concentrationState || "NORMAL"}`);
  lines.push(`• Volatility Regime: ${capitalProtection.volatilityRegime || "MODERATE"}`);
  lines.push(`• Protection Systems: ${capitalProtection.protectionSystems || "ACTIVE"}`);
  lines.push("⏱ LIVE SURVEILLANCE");
  lines.push(`• Last Portfolio Scan: ${formatAgo(surveillance.lastPortfolioScanAt)}`);
  lines.push(`• Last Stress Test: ${surveillance.lastStressTestAt ? `Completed (${formatAgo(surveillance.lastStressTestAt)})` : "Pending"}`);
  lines.push(`• Correlation Scan: ${surveillance.correlationScanState || "UNKNOWN"}`);
  lines.push(`• Scheduler State: ${surveillance.schedulerState || "UNKNOWN"}`);
  lines.push(`• Monitoring Status: ${surveillance.monitoringStatus || "UNKNOWN"}`);
  lines.push("⚠️ Active Risks");
  activeRisks.forEach((risk) => lines.push(`• ${risk}`));
  lines.push(`🛡️ Portfolio Health Score: ${score100}/100 — ${riskState} RISK`);
  lines.push(`• Risk State: ${riskState} RISK`);
  lines.push(`• Capital Protection: ${riskState === "ELEVATED" ? "HEIGHTENED" : "ACTIVE"}`);
  lines.push(`• Concentration Risk: ${review.concentrationRisk}`);
  lines.push("━━━━━━━━━━━━━━━━━━");
  lines.push("Use /portfolio detailed for full institutional diagnostics.");

  if (detailed) {
    lines.push("━━━━━━━━━━━━━━━━━━");
    lines.push("🔬 Detailed Diagnostics");
    lines.push(`• Diversification: ${review.diversificationRead}`);
    lines.push(`• Investment Style: ${review.personality}`);
    lines.push("• Suggested Actions:");
    review.actions.forEach((action) => lines.push(`  - ${action}`));
  }

  return lines.join("\n");
}

function normalizeSector(sector = "") {
  return String(sector || "Unknown")
    .toLowerCase()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function formatAgo(isoTs) {
  if (!isoTs) return "Unavailable";
  const ts = new Date(isoTs).getTime();
  if (!Number.isFinite(ts) || ts <= 0) return "Unavailable";
  const diffSeconds = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  return `${diffSeconds}s ago`;
}

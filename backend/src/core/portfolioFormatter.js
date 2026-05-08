function formatCurrency(value) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0
  }).format(value || 0);
}

function healthEmoji(score) {
  if (score >= 8) return "🟢";
  if (score >= 6) return "🟡";
  return "🔴";
}

function sectorEmoji(sector) {
  const map = {
    "INFORMATION TECHNOLOGY": "💻",
    FINANCIALS: "🏦",
    CONSUMPTION: "🛒",
    PHARMA: "💊",
    ENERGY: "⚡",
    AUTO: "🚗",
    UTILITIES: "🛡",
    "CAPITAL GOODS": "🏗",
    UNCLASSIFIED: "📁"
  };
  return map[sector] || "📁";
}

export function formatPortfolioReview(review) {
  if (!review || review.empty) {
    return review?.message || "Portfolio unavailable.";
  }

  const lines = [];
  lines.push("🏛 FINSIGHT AI — PORTFOLIO HEALTH REVIEW");
  lines.push("━━━━━━━━━━━━━━━━━━");
  lines.push("📊 PORTFOLIO HEALTH SCORE");
  lines.push(`${healthEmoji(review.score)} ${review.score} / 10 — ${review.healthLabel}`);
  lines.push(`📌 Current Portfolio Value: ${formatCurrency(review.totalValue)}`);
  lines.push(`📈 Overall PnL: ${review.totalPnL >= 0 ? "+" : "-"}${formatCurrency(Math.abs(review.totalPnL))} (${review.totalPnLPct >= 0 ? "+" : ""}${review.totalPnLPct.toFixed(1)}%)`);
  lines.push(`⚠ Concentration Risk: ${review.concentrationRisk}`);
  lines.push(`🧭 Investment Style: ${review.personality}`);
  lines.push("━━━━━━━━━━━━━━━━━━");
  lines.push("📦 PORTFOLIO COMPOSITION");
  lines.push("━━━━━━━━━━━━━━━━━━");

  review.sectors.forEach((sector) => {
    lines.push(`${sectorEmoji(sector.sector)} ${sector.sector} — ${sector.weight.toFixed(1)}%`);
    sector.holdings.forEach((holding) => lines.push(`• ${holding}`));
  });

  lines.push("🧠 DIVERSIFICATION READ:");
  lines.push(review.diversificationRead);
  lines.push("━━━━━━━━━━━━━━━━━━");
  lines.push("🏆 STRONGEST HOLDINGS");
  lines.push("━━━━━━━━━━━━━━━━━━");

  review.strongestHoldings.forEach((holding) => {
    lines.push(`🟢 ${holding.symbol}`);
    lines.push(`• Weight: ${holding.weight.toFixed(1)}%`);
    lines.push(`• PnL: ${holding.pnlPct >= 0 ? "+" : ""}${holding.pnlPct.toFixed(1)}%`);
    lines.push(`• Status: ${holding.status}`);
    lines.push("• Insight:");
    lines.push(holding.insight);
  });

  if (review.riskFlags.length > 0) {
    lines.push("━━━━━━━━━━━━━━━━━━");
    lines.push("⚠ RISK CONCENTRATIONS");
    lines.push("━━━━━━━━━━━━━━━━━━");
    review.riskFlags.forEach((flag) => {
      lines.push(`🔴 ${flag.title}`);
      lines.push(flag.detail);
    });
  }

  lines.push("━━━━━━━━━━━━━━━━━━");
  lines.push("📈 REBALANCING INTELLIGENCE");
  lines.push("━━━━━━━━━━━━━━━━━━");
  lines.push("✅ Suggested Actions:");
  review.actions.forEach((action) => lines.push(`• ${action}`));
  lines.push("📌 Preferred Sectors Right Now:");
  review.preferredSectors.forEach((sector) => lines.push(`• ${sector}`));
  lines.push("⚠ Weak Sectors:");
  review.weakSectors.forEach((sector) => lines.push(`• ${sector}`));
  lines.push("━━━━━━━━━━━━━━━━━━");
  lines.push("🧠 STRATEGIC OUTLOOK");
  lines.push("━━━━━━━━━━━━━━━━━━");
  lines.push(review.strategicOutlook);
  lines.push("━━━━━━━━━━━━━━━━━━");
  lines.push("⚠ Educational only. Not financial advice.");

  return lines.join("\n");
}

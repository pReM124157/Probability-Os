export async function rankingAgent(stockData) {
  try {
    const {
      ticker,
      symbol,
      confidenceScore = 0,
      riskScore = 5,
      financialScore = 80,
      technicalScore = 70
    } = stockData;
    const resolvedTicker = ticker || symbol || "UNKNOWN";
    const confidence100 = Number(confidenceScore) || 0;
    const risk100 = Math.max(0, Math.min(100, (Number(riskScore) || 0) * 10));
    const financial100 = Number(financialScore) || 0;
    const technical100 = Number(technicalScore) || 0;
    let rankScore =
      (confidence100 * 0.40) +
      (financial100 * 0.25) +
      (technical100 * 0.20) +
      ((100 - risk100) * 0.15);
    let priority = "LOW";
    if (rankScore >= 80) {
      priority = "HIGH";
    } else if (rankScore >= 60) {
      priority = "MEDIUM";
    }
    return {
      ticker: resolvedTicker,
      rankScore: Number(rankScore.toFixed(1)),
      priority,
      summary: `${resolvedTicker} ranked as ${priority} priority opportunity`
    };
  } catch (error) {
    console.error("Ranking Agent Error:", error.message);
    return {
      ticker: stockData?.ticker || "UNKNOWN",
      rankScore: 0,
      priority: "LOW",
      summary: "Ranking failed"
    };
  }
}

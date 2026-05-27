export async function capitalAgent(stockData) {
  try {
    const {
      ticker,
      symbol,
      priority = "LOW",
      confidenceScore = 0,
      riskLevel = "HIGH"
    } = stockData;
    const resolvedTicker = ticker || symbol || "UNKNOWN";
    const confidence100 = Number(confidenceScore) || 0;

    let allocation = 5;

    if (priority === "HIGH" && confidence100 >= 80) {
      allocation = 20;
    } else if (priority === "MEDIUM") {
      allocation = 10;
    }

    if (riskLevel === "HIGH") {
      allocation -= 5;
    }

    allocation = Math.max(allocation, 2);

    return {
      ticker: resolvedTicker,
      suggestedAllocation: `${allocation}%`,
      summary: `Recommended portfolio allocation: ${allocation}%`
    };
  } catch (error) {
    console.error("Capital Agent Error:", error.message);

    return {
      ticker: stockData?.ticker || "UNKNOWN",
      suggestedAllocation: "0%",
      summary: "Allocation failed"
    };
  }
}

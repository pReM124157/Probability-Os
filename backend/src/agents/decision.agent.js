export async function runDecisionAgent({
  riskLevel,
  riskScore,
  companyOverview,
  portfolioHealth = 5,
  learningBoost = 0
}) {
  try {
    let score = 0;

    const marketCap = companyOverview?.MarketCapitalization;
    const peRatio = companyOverview?.PERatio;
    const profitMargin = companyOverview?.ProfitMargin;

    const hasFinancialData = 
        (marketCap !== null && marketCap !== undefined) || 
        (peRatio !== null && peRatio !== undefined) || 
        (profitMargin !== null && profitMargin !== undefined);

    if (!hasFinancialData) {
      return {
        finalAction: "HOLD",
        confidenceScore: 5, // Neutral starting point for unknown
        reasoning:
          "Institutional data is currently unavailable for this ticker. Defaulting to a neutral HOLD until verifiable financial metrics are retrieved."
      };
    }

    // Risk Scoring (Always present)
    if (riskLevel === "LOW") score += 3;
    if (riskLevel === "MEDIUM") score += 2;
    if (riskLevel === "HIGH") score -= 2;

    if (riskScore !== null) {
        if (riskScore <= 3) score += 2;
        if (riskScore >= 7) score -= 2;
    }

    // Large cap quality boost (Only if data exists)
    if (marketCap !== null) {
        if (marketCap > 100000000000) score += 3;
        else if (marketCap > 10000000000) score += 2;
        else if (marketCap < 1000000000) score -= 1; // Only penalize if we KNOW it's small
    }

    // PE valuation scoring (Only if data exists)
    if (peRatio !== null && peRatio > 0) {
        if (peRatio < 25) score += 3;
        else if (peRatio < 40) score += 1;
        else if (peRatio > 60) score -= 2;
    }

    // Profitability (Only if data exists)
    if (profitMargin !== null) {
        if (profitMargin > 0.15) score += 2;
        else if (profitMargin > 0.08) score += 1;
        else if (profitMargin < 0.05) score -= 1; // Only penalize if we KNOW it's low
    }

    // Portfolio fit
    if (portfolioHealth >= 7) score += 1;
    if (portfolioHealth <= 3) score -= 1;

    // Learning system
    score += learningBoost;

    let finalAction = "HOLD";
    const confidenceScore = Math.min(Math.max(score, 1), 10);

    let recommendation = "Monitor closely";
    if (confidenceScore >= 8) {
      finalAction = "STRONG BUY";
      recommendation = "Accumulate aggressively";
    } else if (confidenceScore >= 6) {
      finalAction = "BUY";
      recommendation = "Accumulate gradually";
    } else if (confidenceScore >= 4) {
      finalAction = "HOLD";
      recommendation = "Monitor closely";
    } else {
      finalAction = "SELL";
      recommendation = "Reduce exposure";
    }

    return {
      finalAction,
      confidenceScore,
      recommendation,
      reasoning: `${companyOverview?.Name || "This company"} shows a ${finalAction} profile (${recommendation}) based on financial strength, valuation quality, risk profile, and historical learning performance.`
    };

  } catch (error) {
    console.error(error.message);

    return {
      finalAction: "HOLD",
      confidenceScore: 4,
      reasoning:
        "Fallback decision due to insufficient data."
    };
  }
}

export async function decisionAgent(stockData) {
  const result = await runDecisionAgent({
    riskLevel: stockData.riskLevel,
    riskScore: stockData.riskScore || 5,
    companyOverview: stockData,
    portfolioHealth: stockData.portfolioHealth || 5,
    learningBoost: stockData.learningBoost || 0
  });

  return {
    finalDecision: result.finalAction,
    finalConfidenceScore: result.confidenceScore,
    recommendation: result.recommendation,
    reason: result.reasoning
  };
}
import { generateInvestmentAnalysis } from "../services/claude.service.js";

/**
 * decision.agent.js
 * Institutional-grade equity analyst agent.
 * Makes strict, data-driven investment decisions using a hedge-fund research desk prompt.
 */
export async function decisionAgent(data) {
  try {
    const prompt = `
You are an institutional-grade equity analyst operating like a hedge fund research desk.

Your job is to make strict, data-driven investment decisions using only the provided numbers.
Do not hallucinate.
Do not guess.
Do not invent missing values.
If a metric is unavailable, treat it as unavailable—not negative.

Your output must be concise, execution-focused, and suitable for professional portfolio decision-making.

==================================================
STOCK INFORMATION
==================================================

Stock Name: ${data.Name || data.Symbol}
Symbol: ${data.Symbol}
Sector: ${data.Sector || "N/A"}

==================================================
CORE FUNDAMENTALS
==================================================

Market Capitalization: ${data.MarketCapitalization ?? "N/A"}
P/E Ratio: ${data.PERatio ?? "N/A"}
Price to Book Ratio: ${data.PriceToBookRatio ?? "N/A"}
Profit Margin: ${data.ProfitMargin ?? "N/A"}
Return on Equity (ROE): ${data.ReturnOnEquityTTM ?? "N/A"}
Debt to Equity Ratio: ${data.DebtToEquityRatio ?? "N/A"}
Quarterly Revenue Growth YoY: ${data.QuarterlyRevenueGrowthYOY ?? "N/A"}
Quarterly Earnings Growth YoY: ${data.QuarterlyEarningsGrowthYOY ?? "N/A"}
Beta: ${data.Beta ?? "N/A"}

==================================================
LIVE MARKET DATA
==================================================

Current Price: ${data.currentPrice ?? "N/A"}
Previous Close: ${data.previousClose ?? "N/A"}
Open Price: ${data.open ?? "N/A"}
Day High: ${data.dayHigh ?? "N/A"}
Day Low: ${data.dayLow ?? "N/A"}

52 Week High: ${data.fiftyTwoWeekHigh ?? "N/A"}
52 Week Low: ${data.fiftyTwoWeekLow ?? "N/A"}

Current Volume: ${data.volume ?? "N/A"}
Average Volume: ${data.averageVolume ?? "N/A"}

==================================================
TECHNICAL CONTEXT
==================================================

RSI: ${data.rsi ?? "N/A"}
Above 50 DMA: ${data.above50DMA ?? "N/A"}
Above 200 DMA: ${data.above200DMA ?? "N/A"}
Trend Strength: ${data.trendStrength ?? "N/A"}
Momentum Score: ${data.momentumScore ?? "N/A"}
Breakout Strength: ${data.breakoutStrength ?? "N/A"}

==================================================
DECISION RULES
==================================================

BUY:
- Strong fundamentals
- Healthy growth
- Good margin quality
- Controlled debt
- Strong technical structure
- Attractive valuation
- Institutional accumulation signs

HOLD:
- Mixed setup
- Neutral valuation
- Moderate conviction
- Wait for confirmation

SELL / AVOID:
- Weak financial quality
- Poor growth
- Overvaluation
- Weak technical structure
- Risk outweighs reward

Missing data should NOT automatically force SELL.

==================================================
RETURN STRICTLY IN THIS FORMAT
==================================================

Final Decision: BUY / HOLD / SELL

Confidence Score: X/10

Risk Level: LOW / MEDIUM / HIGH

Priority Level: LOW / MEDIUM / HIGH

Rank Score: X/10

Suggested Allocation: X%

Reason:
(2-line institutional explanation only.
Must reference actual provided data.
No generic explanations.)

Recommended Action:
(Example:
Build position gradually
Wait for breakout confirmation
Strong buy opportunity
Avoid fresh entry)

==================================================
IMPORTANT RULES
==================================================

- Never use generic AI language
- Never write essays
- Never repeat the full input
- Keep reasoning short and sharp
- Output must feel like hedge fund analyst output
- Use exact live market values provided
- Never guess stock price
- Never invent fundamentals
- Be strict, realistic, and execution-focused
`.trim();

    const response = await generateInvestmentAnalysis(prompt);

    // Parse the institutional response
    const decision = response.match(/Final Decision:\s*(.*)/i)?.[1] || "HOLD";
    const confidence = parseInt(response.match(/Confidence Score:\s*(\d+)/i)?.[1]) || 5;
    const risk = response.match(/Risk Level:\s*(.*)/i)?.[1] || "MEDIUM";
    const priority = response.match(/Priority Level:\s*(.*)/i)?.[1] || "MEDIUM";
    const rank = parseInt(response.match(/Rank Score:\s*(\d+)/i)?.[1]) || 5;
    const allocation = response.match(/Suggested Allocation:\s*(.*)/i)?.[1] || "0%";
    const reason = response.match(/Reason:\s*([\s\S]*?)(?=Recommended Action:|$)/i)?.[1]?.trim() || "No reason provided.";
    const action = response.match(/Recommended Action:\s*([\s\S]*?)$/i)?.[1]?.trim() || "No action provided.";

    return {
      finalDecision: decision.toUpperCase(),
      finalConfidenceScore: confidence,
      riskLevel: risk.toUpperCase(),
      priorityLevel: priority.toUpperCase(),
      rankScore: rank,
      suggestedAllocation: allocation,
      reason: reason,
      recommendation: action
    };

  } catch (error) {
    console.error("Decision Agent Error:", error.message);
    return {
      finalDecision: "HOLD",
      finalConfidenceScore: 5,
      riskLevel: "MEDIUM",
      priorityLevel: "MEDIUM",
      rankScore: 5,
      suggestedAllocation: "0%",
      reason: "Error in deep analysis phase. Defaulting to neutral position.",
      recommendation: "Monitor manually."
    };
  }
}
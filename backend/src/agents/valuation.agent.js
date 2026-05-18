import { generateStructuredJson } from "../services/claude.service.js";
import { valuationSchema } from "../core/agentSchemas.js";
import { buildValuationContext } from "../core/analysisContext.js";

export async function valuationAgent(stockData) {
  const curated = buildValuationContext(stockData);
  const prompt = `
You are a valuation specialist. 

Analyze this market and financial data:
${JSON.stringify(curated, null, 2)}

Provide a deep valuation analysis.
Consider PE ratio vs Sector, Price to Book, and Growth rates.

Return ONLY a JSON object:
{
  "score": number (1-10, where 10 is deeply undervalued/attractive),
  "status": "UNDERVALUED" | "FAIR" | "OVERVALUED",
  "fairPrice": number,
  "marginOfSafety": "percentage string",
  "reason": "concise explanation"
}
`;

  try {
    const result = await generateStructuredJson({
      prompt,
      schema: valuationSchema,
      schemaName: "valuation"
    });
    return {
      score: result.score,
      status: result.status,
      fairPrice: result.fairPrice,
      marginOfSafety: result.marginOfSafety,
      reason: result.reason
    };
  } catch (e) {
    console.error("Valuation Agent structured-output error:", e.message);
    throw new Error(`Valuation analysis unavailable: ${e.message}`);
  }
}

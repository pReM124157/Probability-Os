import { generateStructuredJson } from "../services/claude.service.js";
import { riskSchema } from "../core/agentSchemas.js";
import { buildRiskContext } from "../core/analysisContext.js";

export async function runRiskAgent(stockData) {
  const curated = buildRiskContext(stockData);
  const prompt = `
You are a risk management expert.

Analyze:

${JSON.stringify(curated, null, 2)}

Return ONLY a JSON object with:
{
  "majorRisks": [],
  "riskScore": 0,
  "riskLevel": "LOW" | "MEDIUM" | "HIGH"
}
`;

  try {
    return await generateStructuredJson({
      prompt,
      schema: riskSchema,
      schemaName: "risk"
    });
  } catch (e) {
    throw new Error(`Risk analysis unavailable: ${e.message}`);
  }
}

export async function riskAgent(stockData) {
  return await runRiskAgent(stockData);
}

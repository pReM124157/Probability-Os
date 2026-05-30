import { generateStructuredJson } from "../services/claude.service.js";
import { riskSchema } from "../core/agentSchemas.js";
import { buildRiskContext } from "../core/analysisContext.js";

function clampRiskScore(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 5;
  return Math.max(0, Math.min(10, n));
}

function normalizeRiskLevel(value, score) {
  const level = String(value || "").trim().toUpperCase();
  if (["LOW", "MEDIUM", "HIGH"].includes(level)) return level;
  if (score >= 7) return "HIGH";
  if (score >= 4) return "MEDIUM";
  return "LOW";
}

function buildFallbackRisk(error) {
  return {
    majorRisks: [
      "Risk model output could not be fully validated.",
      "Using conservative fallback risk assessment."
    ],
    riskScore: 6,
    riskLevel: "MEDIUM",
    degradedMode: true,
    fallbackReason: error?.message || "Structured risk output unavailable"
  };
}

function normalizeRiskPayload(payload) {
  const riskScore = clampRiskScore(payload?.riskScore);
  return {
    majorRisks: Array.isArray(payload?.majorRisks)
      ? payload.majorRisks.map((item) => String(item)).filter(Boolean).slice(0, 8)
      : [],
    riskScore,
    riskLevel: normalizeRiskLevel(payload?.riskLevel, riskScore),
    degradedMode: payload?.degradedMode === true,
    fallbackReason: payload?.fallbackReason || null
  };
}

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

Rules:
- riskScore must be a number from 0 to 10 only.
- Do not return percentages or 0-100 scores.
- If risk is high, use 8, 9, or 10, not 80 or 90.
`;

  try {
    const result = await generateStructuredJson({
      prompt,
      schema: riskSchema,
      schemaName: "risk"
    });
    return normalizeRiskPayload(result);
  } catch (e) {
    console.warn("[RISK AGENT] Structured risk failed; using conservative fallback", e?.message);
    return buildFallbackRisk(e);
  }
}

export async function riskAgent(stockData) {
  return await runRiskAgent(stockData);
}

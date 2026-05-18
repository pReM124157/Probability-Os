import { getInstitutionalAnalysis } from "../services/claude.service.js";

/**
 * decision.agent.js
 * Institutional-grade equity analyst agent.
 * Uses the centralized, compressed institutional analysis service.
 */
export async function decisionAgent(data) {
  try {
    return await getInstitutionalAnalysis(data);
  } catch (error) {
    console.error("Decision Agent Error:", error.message);
    return {
      finalDecision: "HOLD",
      finalConfidenceScore: 1,
      riskLevel: "MEDIUM",
      priorityLevel: "LOW",
      rankScore: 1,
      suggestedAllocation: "0%",
      reason: `Decision engine fail-closed: ${error.message}`,
      recommendation: "No trade. Structured decision output unavailable."
    };
  }
}

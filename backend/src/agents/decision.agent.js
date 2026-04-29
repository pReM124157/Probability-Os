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
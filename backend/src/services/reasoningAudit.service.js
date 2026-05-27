import supabase from "./supabase.service.js";

const SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000";

export async function storeDecisionReasoning(record = {}) {
  const row = {
    user_id: record.userId || SYSTEM_USER_ID,
    decision_type: record.decisionType || "PORTFOLIO_DEFENSE",
    reasoning: record.reasoning || "No reasoning provided",
    mathematical_basis: record.mathematicalBasis || "No mathematical basis provided",
    confidence: Number(record.confidence || 0),
    regime_assumptions: record.regimeAssumptions || {},
    model_assumptions: record.modelAssumptions || {}
  };

  const { error } = await supabase.from("reasoning_audit_logs").insert(row);
  if (error) console.warn("[AUDIT] storeDecisionReasoning failed:", error.message);
  return row;
}

export function generateDecisionAuditTrail(records = []) {
  return records.map((r) => ({
    at: r.created_at,
    decisionType: r.decision_type,
    confidence: r.confidence,
    reasoning: r.reasoning
  }));
}

export function trackReasoningConsistency(records = []) {
  if (records.length < 2) return 1;
  let consistent = 0;
  for (let i = 1; i < records.length; i += 1) {
    if ((records[i - 1].decision_type || "") === (records[i].decision_type || "")) consistent += 1;
  }
  return Number((consistent / (records.length - 1)).toFixed(4));
}

export function trackReasoningAccuracy(records = []) {
  if (!records.length) return 0;
  const avg = records.reduce((acc, r) => acc + Number(r.outcome_accuracy || 0.5), 0) / records.length;
  return Number(avg.toFixed(4));
}

export function generateInstitutionalExplanation({ reasoning = "", math = "", regime = "" } = {}) {
  return `Institutional rationale: ${reasoning}. Mathematical validation: ${math}. Regime assumption: ${regime}.`; 
}

export function generateExplainabilitySummary(records = []) {
  return {
    consistency: trackReasoningConsistency(records),
    accuracy: trackReasoningAccuracy(records),
    sampleSize: records.length
  };
}

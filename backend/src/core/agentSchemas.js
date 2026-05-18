import { z } from "zod";

export const valuationSchema = z.object({
  score: z.number().min(1).max(10),
  status: z.enum(["UNDERVALUED", "FAIR", "OVERVALUED"]),
  fairPrice: z.number().nonnegative(),
  marginOfSafety: z.string(),
  reason: z.string().min(1)
});

export const riskSchema = z.object({
  majorRisks: z.array(z.string()).default([]),
  riskScore: z.number().min(0).max(10),
  riskLevel: z.enum(["LOW", "MEDIUM", "HIGH"])
});

export const decisionSchema = z.object({
  finalDecision: z.enum(["BUY", "HOLD", "SELL"]),
  finalConfidenceScore: z.number().min(1).max(10),
  riskLevel: z.enum(["LOW", "MEDIUM", "HIGH"]),
  priorityLevel: z.enum(["LOW", "MEDIUM", "HIGH"]),
  rankScore: z.number().min(1).max(10),
  suggestedAllocation: z.string(),
  reason: z.string().min(1),
  recommendation: z.string().min(1)
});

export const explainabilitySchema = z.object({
  stock: z.string(),
  finalDecision: z.string(),
  confidenceScore: z.number(),
  summary: z.string(),
  positives: z.array(z.string()),
  negatives: z.array(z.string()),
  warnings: z.array(z.string())
});


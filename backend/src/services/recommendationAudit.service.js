import crypto from "crypto";
import { z } from "zod";
import supabase from "./supabase.service.js";
import { logError, logEvent } from "./telemetry.service.js";
import { initializeOutcomeForRecommendation } from "./recommendationOutcome.service.js";

const MAX_JSON_BYTES = 64 * 1024;
const AUDIT_INSERT_TIMEOUT_MS = 1800;

class RecommendationAuditError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = "RecommendationAuditError";
    this.code = code;
    this.details = details;
  }
}

function safeNumber(value, fieldName) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new RecommendationAuditError(`Invalid numeric field: ${fieldName}`, "INVALID_NUMERIC_FIELD", { fieldName, value });
  }
  return numeric;
}

function boundedJson(value, fieldName) {
  if (value === null || value === undefined) return null;
  const serialized = JSON.stringify(value);
  const bytes = Buffer.byteLength(serialized, "utf8");
  if (bytes > MAX_JSON_BYTES) {
    throw new RecommendationAuditError(`Payload too large: ${fieldName}`, "PAYLOAD_TOO_LARGE", { fieldName, bytes, maxBytes: MAX_JSON_BYTES });
  }
  return JSON.parse(serialized);
}

const recommendationAuditSchema = z.object({
  symbol: z.string().min(1),
  exchange: z.string().optional().nullable(),
  recommendationType: z.string().min(1),
  action: z.enum(["BUY", "SELL", "HOLD", "AVOID"]),
  confidence: z.number().min(0).max(100),
  conviction: z.string().optional().nullable(),
  entryPrice: z.number().nonnegative().optional().nullable(),
  stopLoss: z.number().nonnegative().optional().nullable(),
  targetPrice: z.number().nonnegative().optional().nullable(),
  rrRatio: z.number().nonnegative().optional().nullable(),
  horizon: z.string().optional().nullable(),
  sector: z.string().optional().nullable(),
  marketRegime: z.string().optional().nullable(),
  valuationScore: z.number().optional().nullable(),
  technicalScore: z.number().optional().nullable(),
  riskScore: z.number().optional().nullable(),
  liquidityScore: z.number().optional().nullable(),
  volatilityScore: z.number().optional().nullable(),
  aiSummary: z.string().optional().nullable(),
  reasoningSnapshot: z.any().optional().nullable(),
  indicatorSnapshot: z.any().optional().nullable(),
  marketSnapshot: z.any().optional().nullable(),
  providerMetadata: z.any().optional().nullable(),
  analysisVersion: z.string().optional().nullable(),
  generatedBy: z.string().optional().nullable(),
  userId: z.string().optional().nullable(),
  telegramChatId: z.string().optional().nullable(),
  createdAt: z.string().datetime().optional().nullable()
});

function buildRecommendationId(normalized) {
  const ts = new Date(normalized.createdAt || Date.now()).toISOString().replace(/[-:.TZ]/g, "");
  const digest = crypto
    .createHash("sha256")
    .update(`${normalized.symbol}|${normalized.action}|${normalized.confidence}|${ts}|${normalized.analysisVersion || ""}`)
    .digest("hex")
    .slice(0, 8)
    .toUpperCase();
  return `FS-${normalized.symbol}-${ts}-${digest}`;
}

function normalizeRecommendationAuditPayload(payload = {}) {
  const normalized = {
    symbol: String(payload.symbol || "").toUpperCase().trim(),
    exchange: payload.exchange ?? null,
    recommendationType: String(payload.recommendationType || "").toUpperCase().trim(),
    action: String(payload.action || "").toUpperCase().trim(),
    confidence: safeNumber(payload.confidence, "confidence"),
    conviction: payload.conviction ?? null,
    entryPrice: safeNumber(payload.entryPrice, "entryPrice"),
    stopLoss: safeNumber(payload.stopLoss, "stopLoss"),
    targetPrice: safeNumber(payload.targetPrice, "targetPrice"),
    rrRatio: safeNumber(payload.rrRatio, "rrRatio"),
    horizon: payload.horizon ?? null,
    sector: payload.sector ?? null,
    marketRegime: payload.marketRegime ?? null,
    valuationScore: safeNumber(payload.valuationScore, "valuationScore"),
    technicalScore: safeNumber(payload.technicalScore, "technicalScore"),
    riskScore: safeNumber(payload.riskScore, "riskScore"),
    liquidityScore: safeNumber(payload.liquidityScore, "liquidityScore"),
    volatilityScore: safeNumber(payload.volatilityScore, "volatilityScore"),
    aiSummary: payload.aiSummary ? String(payload.aiSummary).slice(0, 4000) : null,
    reasoningSnapshot: boundedJson(payload.reasoningSnapshot, "reasoningSnapshot"),
    indicatorSnapshot: boundedJson(payload.indicatorSnapshot, "indicatorSnapshot"),
    marketSnapshot: boundedJson(payload.marketSnapshot, "marketSnapshot"),
    providerMetadata: boundedJson(payload.providerMetadata, "providerMetadata"),
    analysisVersion: payload.analysisVersion ?? "v1",
    generatedBy: payload.generatedBy ?? "master.agent",
    userId: payload.userId ?? null,
    telegramChatId: payload.telegramChatId ?? null,
    createdAt: payload.createdAt ? new Date(payload.createdAt).toISOString() : new Date().toISOString()
  };
  const parsed = recommendationAuditSchema.safeParse(normalized);
  if (!parsed.success) {
    throw new RecommendationAuditError("Recommendation audit validation failed", "VALIDATION_FAILED", {
      issues: parsed.error.issues
    });
  }
  return parsed.data;
}

function withTimeout(promise, timeoutMs, timeoutLabel) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new RecommendationAuditError(`${timeoutLabel} timed out`, "TIMEOUT")), timeoutMs);
    })
  ]);
}

export async function insertRecommendationAudit(payload) {
  const startedAt = Date.now();
  try {
    const normalized = normalizeRecommendationAuditPayload(payload);
    const recommendationId = buildRecommendationId(normalized);
    logEvent("recommendation.audit.replay_generated", {
      symbol: normalized.symbol,
      recommendation_id: recommendationId,
      action: normalized.action,
      confidence: normalized.confidence,
      validation_status: "valid",
      provider_sources: normalized.providerMetadata || {}
    });

    const row = {
      recommendation_id: recommendationId,
      symbol: normalized.symbol,
      exchange: normalized.exchange,
      recommendation_type: normalized.recommendationType,
      action: normalized.action,
      confidence: normalized.confidence,
      conviction: normalized.conviction,
      entry_price: normalized.entryPrice,
      stop_loss: normalized.stopLoss,
      target_price: normalized.targetPrice,
      rr_ratio: normalized.rrRatio,
      horizon: normalized.horizon,
      sector: normalized.sector,
      market_regime: normalized.marketRegime,
      valuation_score: normalized.valuationScore,
      technical_score: normalized.technicalScore,
      risk_score: normalized.riskScore,
      liquidity_score: normalized.liquidityScore,
      volatility_score: normalized.volatilityScore,
      ai_summary: normalized.aiSummary,
      reasoning_snapshot: normalized.reasoningSnapshot,
      indicator_snapshot: normalized.indicatorSnapshot,
      market_snapshot: normalized.marketSnapshot,
      provider_metadata: normalized.providerMetadata,
      analysis_version: normalized.analysisVersion,
      generated_by: normalized.generatedBy,
      user_id: normalized.userId,
      telegram_chat_id: normalized.telegramChatId,
      created_at: normalized.createdAt
    };

    const insertPromise = supabase.from("recommendation_audit").insert([row]);
    const { error } = await withTimeout(insertPromise, AUDIT_INSERT_TIMEOUT_MS, "recommendation audit insert");
    if (error) {
      throw new RecommendationAuditError("Recommendation audit insert failed", "INSERT_FAILED", { error });
    }

    logEvent("recommendation.audit.insert_success", {
      symbol: normalized.symbol,
      recommendation_id: recommendationId,
      latency_ms: Date.now() - startedAt,
      validation_status: "valid",
      provider_sources: normalized.providerMetadata || {},
      confidence: normalized.confidence,
      action: normalized.action
    });

    await initializeOutcomeForRecommendation({
      recommendation_id: recommendationId,
      symbol: normalized.symbol,
      entry_price: normalized.entryPrice,
      rr_ratio: normalized.rrRatio,
      volatility_score: normalized.volatilityScore,
      horizon: normalized.horizon,
      created_at: normalized.createdAt,
      provider_metadata: normalized.providerMetadata
    });

    return { recommendationId };
  } catch (error) {
    const validationFailure = error instanceof RecommendationAuditError && error.code === "VALIDATION_FAILED";
    const timeoutFailure = error instanceof RecommendationAuditError && error.code === "TIMEOUT";

    if (validationFailure) {
      logEvent("recommendation.audit.validation_failure", {
        symbol: String(payload?.symbol || "").toUpperCase(),
        recommendation_id: null,
        latency_ms: Date.now() - startedAt,
        validation_status: "invalid",
        provider_sources: payload?.providerMetadata || {},
        confidence: payload?.confidence ?? null,
        action: payload?.action ?? null,
        details: error.details || {}
      });
    } else if (timeoutFailure) {
      logEvent("recommendation.audit.timeout", {
        symbol: String(payload?.symbol || "").toUpperCase(),
        recommendation_id: null,
        latency_ms: Date.now() - startedAt,
        validation_status: "valid",
        provider_sources: payload?.providerMetadata || {},
        confidence: payload?.confidence ?? null,
        action: payload?.action ?? null
      });
    } else {
      logEvent("recommendation.audit.insert_failure", {
        symbol: String(payload?.symbol || "").toUpperCase(),
        recommendation_id: null,
        latency_ms: Date.now() - startedAt,
        validation_status: "valid",
        provider_sources: payload?.providerMetadata || {},
        confidence: payload?.confidence ?? null,
        action: payload?.action ?? null
      });
    }

    logError("recommendation.audit.error", error, {
      symbol: payload?.symbol || null
    });
    throw error;
  }
}

export { RecommendationAuditError };

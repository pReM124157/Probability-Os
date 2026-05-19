import supabase from "./supabase.service.js";
import { getHistoricalCandles } from "./marketData.service.js";
import { logError, logEvent } from "./telemetry.service.js";
import { applyExponentialBackoff, delayHistoricalRetry } from "./historicalRequestLimiter.service.js";

const TRACKING_VERSION = "outcome-v1";
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_EXPIRY_DAYS = 30;
const MAX_BATCH_SIZE = 100;
const OUTCOME_CONCURRENCY = 2;
const unavailableSymbols = new Map();

class OutcomeTrackingError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = "OutcomeTrackingError";
    this.code = code;
    this.details = details;
  }
}

function toNumber(value, field) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new OutcomeTrackingError(`Invalid numeric value for ${field}`, "INVALID_NUMERIC", { field, value });
  }
  return num;
}

function toNullableNumber(value, field) {
  if (value === null || value === undefined || value === "") return null;
  return toNumber(value, field);
}

function toTimestamp(value, field) {
  const ts = new Date(value);
  if (Number.isNaN(ts.getTime()) || ts.getTime() <= 0) {
    throw new OutcomeTrackingError(`Invalid timestamp for ${field}`, "INVALID_TIMESTAMP", { field, value });
  }
  return ts;
}

function daysSince(dateValue) {
  return Math.max(1, Math.ceil((Date.now() - new Date(dateValue).getTime()) / DAY_MS) + 2);
}

function normalizeCandle(candle) {
  const timestamp = toTimestamp(candle?.date || candle?.timestamp, "candle.date");
  const high = toNumber(candle?.high, "candle.high");
  const low = toNumber(candle?.low, "candle.low");
  const close = toNumber(candle?.close, "candle.close");
  if (high < low) {
    throw new OutcomeTrackingError("Malformed candle: high < low", "MALFORMED_CANDLE", { candle });
  }
  return { timestamp, high, low, close };
}

function computeCandleMetrics(action, entry, candle) {
  if (action === "SELL") {
    return {
      upsidePct: ((entry - candle.low) / entry) * 100,
      drawdownPct: ((entry - candle.high) / entry) * 100,
      returnPct: ((entry - candle.close) / entry) * 100
    };
  }
  return {
    upsidePct: ((candle.high - entry) / entry) * 100,
    drawdownPct: ((candle.low - entry) / entry) * 100,
    returnPct: ((candle.close - entry) / entry) * 100
  };
}

function evaluateHits(action, candle, targetPrice, stopLoss) {
  if (action === "SELL") {
    return {
      target: targetPrice != null ? candle.low <= targetPrice : false,
      stop: stopLoss != null ? candle.high >= stopLoss : false
    };
  }
  return {
    target: targetPrice != null ? candle.high >= targetPrice : false,
    stop: stopLoss != null ? candle.low <= stopLoss : false
  };
}

function withJitter(minMs = 60, maxMs = 180) {
  const jitter = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise((resolve) => setTimeout(resolve, jitter));
}

function markTemporarilyUnavailable(symbol, retryAfterMs) {
  unavailableSymbols.set(String(symbol || "").toUpperCase(), Date.now() + retryAfterMs);
}

function skipRecentlyFailedSymbols(symbol) {
  const key = String(symbol || "").toUpperCase();
  const nextAt = unavailableSymbols.get(key);
  if (!nextAt) return false;
  if (nextAt <= Date.now()) {
    unavailableSymbols.delete(key);
    return false;
  }
  return true;
}

async function mapWithConcurrency(items, concurrency, worker) {
  const resolvedConcurrency = Number(concurrency || OUTCOME_CONCURRENCY);
  let cursor = 0;
  const results = [];
  const runners = Array.from({ length: Math.min(resolvedConcurrency, items.length) }).map(async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

function deriveExpiry(horizon, createdAt) {
  const base = new Date(createdAt);
  const upper = String(horizon || "").toUpperCase();
  if (upper.includes("INTRADAY")) base.setDate(base.getDate() + 2);
  else if (upper.includes("SWING")) base.setDate(base.getDate() + 30);
  else if (upper.includes("POSITIONAL")) base.setDate(base.getDate() + 90);
  else base.setDate(base.getDate() + DEFAULT_EXPIRY_DAYS);
  return base.toISOString();
}

export async function initializeOutcomeForRecommendation(auditRow) {
  if (!auditRow?.recommendation_id) {
    throw new OutcomeTrackingError("Missing recommendation_id for outcome init", "INVALID_RECOMMENDATION");
  }
  const entryPrice = toNullableNumber(auditRow.entry_price, "entry_price");
  if (!entryPrice || entryPrice <= 0) {
    throw new OutcomeTrackingError("Invalid entry price for outcome init", "INVALID_ENTRY_PRICE", {
      recommendation_id: auditRow.recommendation_id
    });
  }
  const createdAt = toTimestamp(auditRow.created_at, "recommendation_created_at").toISOString();
  const rrRatio = toNullableNumber(auditRow.rr_ratio, "rr_ratio");
  if (rrRatio != null && rrRatio < 0) {
    throw new OutcomeTrackingError("Invalid RR ratio for outcome init", "INVALID_RR_RATIO", {
      recommendation_id: auditRow.recommendation_id
    });
  }
  const row = {
    recommendation_id: auditRow.recommendation_id,
    symbol: String(auditRow.symbol || "").toUpperCase(),
    entry_price: entryPrice,
    recommendation_created_at: createdAt,
    outcome_status: "OPEN",
    rr_ratio: rrRatio,
    volatility_at_entry: toNullableNumber(auditRow.volatility_score, "volatility_score"),
    candles_processed: 0,
    last_tracking_run: null,
    tracking_version: TRACKING_VERSION,
    expiry_at: deriveExpiry(auditRow.horizon, createdAt),
    provider_metadata: {
      source: auditRow?.provider_metadata || {},
      bootstrap: "recommendation_audit_insert"
    }
  };

  const { error } = await supabase
    .from("recommendation_outcomes")
    .upsert([row], { onConflict: "recommendation_id", ignoreDuplicates: true });

  if (error) {
    throw new OutcomeTrackingError("Failed to initialize recommendation outcome", "OUTCOME_INIT_FAILED", { error });
  }
}

function buildOutcomeUpdate({ outcome, audit, candles }) {
  const action = String(audit.action || "").toUpperCase();
  const entry = toNumber(outcome.entry_price, "entry_price");
  if (entry <= 0) {
    throw new OutcomeTrackingError("Zero or negative entry price", "INVALID_ENTRY_PRICE", {
      recommendation_id: outcome.recommendation_id
    });
  }

  const targetPrice = toNullableNumber(audit.target_price, "target_price");
  const stopLoss = toNullableNumber(audit.stop_loss, "stop_loss");

  let maxUpside = Number.NEGATIVE_INFINITY;
  let maxDrawdown = Number.POSITIVE_INFINITY;
  let realizedReturn = null;
  let unrealizedReturn = null;
  let targetHitAt = null;
  let stopHitAt = null;
  let status = outcome.outcome_status || "OPEN";

  for (const candle of candles) {
    const metrics = computeCandleMetrics(action, entry, candle);
    if (!Number.isFinite(metrics.returnPct) || !Number.isFinite(metrics.upsidePct) || !Number.isFinite(metrics.drawdownPct)) {
      throw new OutcomeTrackingError("NaN detected in outcome calculation", "INVALID_CALCULATION", {
        recommendation_id: outcome.recommendation_id
      });
    }
    maxUpside = Math.max(maxUpside, metrics.upsidePct);
    maxDrawdown = Math.min(maxDrawdown, metrics.drawdownPct);
    unrealizedReturn = metrics.returnPct;

    if (status === "OPEN") {
      const hit = evaluateHits(action, candle, targetPrice, stopLoss);
      if (hit.target && hit.stop) {
        throw new OutcomeTrackingError("Impossible state: target and stop hit in same candle", "IMPOSSIBLE_STATE", {
          recommendation_id: outcome.recommendation_id,
          candle: candle.timestamp.toISOString()
        });
      }
      if (hit.target) {
        status = "TARGET_HIT";
        targetHitAt = candle.timestamp.toISOString();
        realizedReturn =
          action === "SELL"
            ? ((entry - targetPrice) / entry) * 100
            : ((targetPrice - entry) / entry) * 100;
        break;
      }
      if (hit.stop) {
        status = "STOP_HIT";
        stopHitAt = candle.timestamp.toISOString();
        realizedReturn =
          action === "SELL"
            ? ((entry - stopLoss) / entry) * 100
            : ((stopLoss - entry) / entry) * 100;
        break;
      }
    }
  }

  const lastCandle = candles[candles.length - 1];
  const expiryAt = outcome.expiry_at ? toTimestamp(outcome.expiry_at, "expiry_at") : null;
  if (status === "OPEN" && expiryAt && Date.now() >= expiryAt.getTime()) {
    status = "EXPIRED";
    realizedReturn = unrealizedReturn;
  }

  return {
    recommendation_id: outcome.recommendation_id,
    symbol: outcome.symbol,
    latest_price: lastCandle.close,
    latest_price_at: lastCandle.timestamp.toISOString(),
    outcome_status: status,
    unrealized_return_pct: Number((unrealizedReturn ?? 0).toFixed(4)),
    realized_return_pct: realizedReturn == null ? null : Number(realizedReturn.toFixed(4)),
    max_upside_pct: Number((maxUpside === Number.NEGATIVE_INFINITY ? 0 : maxUpside).toFixed(4)),
    max_drawdown_pct: Number((maxDrawdown === Number.POSITIVE_INFINITY ? 0 : maxDrawdown).toFixed(4)),
    target_hit_at: targetHitAt,
    stop_hit_at: stopHitAt,
    closed_at: status === "OPEN" ? null : new Date().toISOString(),
    candles_processed: candles.length,
    last_tracking_run: new Date().toISOString(),
    tracking_version: TRACKING_VERSION,
    provider_metadata: {
      ...(outcome.provider_metadata || {}),
      source: "YAHOO",
      calculation_version: TRACKING_VERSION,
      candle_count: candles.length
    }
  };
}

export async function syncRecommendationOutcomes({ limit = MAX_BATCH_SIZE, onlyOpen = true } = {}) {
  const startedAt = Date.now();
  const statusFilter = onlyOpen ? "OPEN" : null;

  let query = supabase
    .from("recommendation_outcomes")
    .select("recommendation_id,symbol,entry_price,recommendation_created_at,outcome_status,expiry_at,provider_metadata")
    .order("recommendation_created_at", { ascending: false })
    .limit(limit);
  if (statusFilter) query = query.eq("outcome_status", statusFilter);

  const { data: outcomes, error } = await query;
  if (error) {
    logError("recommendation.outcome.fetch_failure", error, { stage: "outcomes_query" });
    return { processed: 0, updated: 0 };
  }
  if (!outcomes?.length) return { processed: 0, updated: 0 };

  const recommendationIds = outcomes.map((o) => o.recommendation_id);
  const { data: audits, error: auditError } = await supabase
    .from("recommendation_audit")
    .select("recommendation_id,action,target_price,stop_loss,horizon,created_at,provider_metadata")
    .in("recommendation_id", recommendationIds);
  if (auditError) {
    logError("recommendation.outcome.fetch_failure", auditError, { stage: "audit_query" });
    return { processed: 0, updated: 0 };
  }
  const auditMap = new Map((audits || []).map((a) => [a.recommendation_id, a]));
  const updates = [];

  await mapWithConcurrency(outcomes, 2, async (outcome) => {
    const recStartedAt = Date.now();
    try {
      if (skipRecentlyFailedSymbols(outcome.symbol)) {
        logEvent("recommendation.outcome.symbol_skipped", { symbol: outcome.symbol, reason: "recent_historical_failures" });
        return;
      }
      await withJitter();
      const audit = auditMap.get(outcome.recommendation_id);
      if (!audit) {
        throw new OutcomeTrackingError("Missing audit row for outcome", "MISSING_AUDIT_ROW", {
          recommendation_id: outcome.recommendation_id
        });
      }
      const days = Math.min(365, Math.max(10, daysSince(outcome.recommendation_created_at)));
      const candlesRaw = await getHistoricalCandles(outcome.symbol, { days, interval: "1d" });
      const candles = (candlesRaw || []).map(normalizeCandle).sort((a, b) => a.timestamp - b.timestamp);
      if (!candles.length) {
        markTemporarilyUnavailable(outcome.symbol, 10 * 60 * 1000);
        throw new OutcomeTrackingError("No candles available for tracking", "MISSING_CANDLES", {
          recommendation_id: outcome.recommendation_id
        });
      }
      const update = buildOutcomeUpdate({ outcome, audit, candles });
      updates.push(update);

      const eventName =
        update.outcome_status === "TARGET_HIT"
          ? "recommendation.outcome.target_hit"
          : update.outcome_status === "STOP_HIT"
          ? "recommendation.outcome.stop_hit"
          : update.outcome_status === "EXPIRED"
          ? "recommendation.outcome.expired"
          : "recommendation.outcome.updated";
      logEvent(eventName, {
        recommendation_id: update.recommendation_id,
        symbol: update.symbol,
        outcome_status: update.outcome_status,
        return_pct: update.realized_return_pct ?? update.unrealized_return_pct,
        max_upside_pct: update.max_upside_pct,
        max_drawdown_pct: update.max_drawdown_pct,
        candles_processed: update.candles_processed,
        processing_latency_ms: Date.now() - recStartedAt
      });
    } catch (error) {
      await delayHistoricalRetry(applyExponentialBackoff(250, 1));
      if (error instanceof OutcomeTrackingError && error.code === "IMPOSSIBLE_STATE") {
        logEvent("recommendation.outcome.calculation_failure", {
          recommendation_id: outcome.recommendation_id,
          symbol: outcome.symbol,
          outcome_status: outcome.outcome_status,
          return_pct: null,
          max_upside_pct: null,
          max_drawdown_pct: null,
          candles_processed: 0,
          processing_latency_ms: Date.now() - recStartedAt
        });
      } else {
        logEvent("recommendation.outcome.fetch_failure", {
          recommendation_id: outcome.recommendation_id,
          symbol: outcome.symbol,
          outcome_status: outcome.outcome_status,
          return_pct: null,
          max_upside_pct: null,
          max_drawdown_pct: null,
          candles_processed: 0,
          processing_latency_ms: Date.now() - recStartedAt
        });
      }
      logError("recommendation.outcome.error", error, {
        recommendation_id: outcome.recommendation_id,
        symbol: outcome.symbol
      });
    }
  });

  if (unavailableSymbols.size > 0) {
    logEvent("recommendation.outcome.unavailable_symbols", { count: unavailableSymbols.size });
  }

  if (updates.length > 0) {
    const { error: writeError } = await supabase
      .from("recommendation_outcomes")
      .upsert(updates, { onConflict: "recommendation_id" });
    if (writeError) {
      logError("recommendation.outcome.calculation_failure", writeError, { stage: "batch_upsert" });
      return { processed: outcomes.length, updated: 0 };
    }
  }

  logEvent("recommendation.outcome.updated", {
    recommendation_id: null,
    symbol: "BATCH",
    outcome_status: "BATCH",
    return_pct: null,
    max_upside_pct: null,
    max_drawdown_pct: null,
    candles_processed: updates.reduce((sum, item) => sum + Number(item.candles_processed || 0), 0),
    processing_latency_ms: Date.now() - startedAt
  });

  return { processed: outcomes.length, updated: updates.length };
}

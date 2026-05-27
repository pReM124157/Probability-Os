import supabase from "./supabase.service.js";
import { getHistoricalCandles, getLiveMarketData } from "./marketData.service.js";
import { logError, logEvent } from "./telemetry.service.js";
import { applyExponentialBackoff, delayHistoricalRetry } from "./historicalRequestLimiter.service.js";
import bot from "./telegram.service.js";
import { formatLifecycle } from "./telegramFormatter.service.js";

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

function formatCurrency(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "NA";
  return `₹${Number.isInteger(n) ? n : n.toFixed(2).replace(/\.00$/, "")}`;
}

function formatReturnPct(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "NA";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function inferExchange(audit) {
  const exchange = String(audit?.exchange || "").trim().toUpperCase();
  if (exchange) return exchange;
  const symbol = String(audit?.symbol || "").trim().toUpperCase();
  if (symbol.endsWith(".NS")) return "NSE";
  if (symbol.endsWith(".BO")) return "BSE";
  return "NSE";
}

function isProductionOutcomeRow(outcome, audit = null) {
  const blob = JSON.stringify({
    outcome_recommendation_id: outcome?.recommendation_id,
    outcome_symbol: outcome?.symbol,
    audit_recommendation_id: audit?.recommendation_id,
    audit_symbol: audit?.symbol,
    generated_by: audit?.generated_by,
    provider_metadata: audit?.provider_metadata,
    outcome_metadata: outcome?.provider_metadata
  }).toUpperCase();

  if (blob.includes("TEST")) return false;
  if (blob.includes("TRIAL")) return false;
  if (blob.includes("MANUAL.TEST")) return false;
  if (blob.includes("MANUAL_TEST")) return false;
  if (blob.includes("COPILOT.DELIVERY")) return false;
  if (blob.includes("PRODUCTION.DELIVERY.VERIFICATION")) return false;

  return true;
}

function formatTradeDuration(createdAt, closedAt) {
  const start = createdAt ? new Date(createdAt) : null;
  const end = closedAt ? new Date(closedAt) : null;
  if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "1 Day";
  const days = Math.max(0, Math.round((end.getTime() - start.getTime()) / DAY_MS));
  if (days === 0) return "Same Day";
  if (days === 1) return "1 Day";
  return `${days} Days`;
}

async function buildLiveFallbackCandle(symbol) {
  const live = await getLiveMarketData(symbol);
  const price = Number(live?.currentPrice ?? live?.price ?? 0);
  if (!Number.isFinite(price) || price <= 0) {
    throw new OutcomeTrackingError("No live price available for tracking fallback", "MISSING_LIVE_PRICE", {
      symbol
    });
  }
  return normalizeCandle({
    timestamp: new Date().toISOString(),
    high: price,
    low: price,
    close: price
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// LIFECYCLE TELEGRAM FORMATTERS & DELIVERY
// ─────────────────────────────────────────────────────────────────────────────

export function formatLifecycleTelegramMessage(eventType, { audit, update, previousSL, newSL, duration, outcomeText }) {
  return formatLifecycle({
    eventType,
    symbol: update?.symbol || audit?.symbol || "UNKNOWN",
    exchange: inferExchange(audit),
    entryPrice: audit?.entry_price || update?.entry_price,
    targetPrice: audit?.target_price,
    exitPrice: update?.latest_price || newSL,
    pnl: update?.realized_return_pct ?? update?.unrealized_return_pct ?? 0,
    previousSL,
    newSL,
    duration,
    outcomeText,
    timestamp: new Date()
  });
}

async function fetchActiveSubscriberChatIds(audit = null) {
  const { data: subscribers, error } = await supabase
    .from("subscribers")
    .select("telegram_chat_id,status,preferred_risk,preferred_sectors,enable_trade_updates")
    .eq("status", "active");

  if (error) throw error;

  const filteredSubscribers = (subscribers || []).filter(sub => {
    // 1. Enable trade updates
    if (sub.enable_trade_updates === false) return false;

    // 2. Risk filtering
    if (sub.preferred_risk && audit) {
      const prefRisk = sub.preferred_risk.toUpperCase();
      const recRiskScore = audit.risk_score != null ? Number(audit.risk_score) : null;
      if (recRiskScore !== null) {
        if (prefRisk === "LOW" && recRiskScore > 3) return false;
        if (prefRisk === "MEDIUM" && recRiskScore > 6) return false;
      }
    }
    
    // 3. Sector filtering
    if (sub.preferred_sectors && Array.isArray(sub.preferred_sectors) && sub.preferred_sectors.length > 0 && audit) {
      const recSector = String(audit.sector || "").toLowerCase().trim();
      const match = sub.preferred_sectors.some(sec => String(sec || "").toLowerCase().trim() === recSector);
      if (!match) return false;
    }
    
    return true;
  });

  return Array.from(new Set(
    filteredSubscribers
      .map((subscriber) => String(subscriber?.telegram_chat_id || "").trim())
      .filter((chatId) => /^-?\d+$/.test(chatId))
  ));
}

export async function deliverLifecycleEvent(outcome, audit, update, eventType, extraData = {}) {
  const sentEvents = outcome.provider_metadata?.sent_events || {};

  // Check unique key / idempotency to suppress duplicates
  const existingStatus = sentEvents[eventType]?.status;
  if (existingStatus && (existingStatus.startsWith("SENT") || existingStatus.startsWith("SKIPPED") || existingStatus === "NO_SUBSCRIBERS")) {
    console.log(`=== DUPLICATE LIFECYCLE SUPPRESSED ===`);
    console.log({ recommendationId: outcome.recommendation_id, eventType });
    return { status: "SUPPRESSED", duplicateSuppressed: 1, updatedSentEvents: sentEvents };
  }

  const prevSL = extraData.previousSL || outcome.provider_metadata?.previous_stop_loss || audit?.stop_loss;
  const currSL = extraData.newSL || outcome.provider_metadata?.current_stop_loss || outcome.entry_price;

  const message = formatLifecycleTelegramMessage(eventType, {
    audit,
    update,
    previousSL: prevSL,
    newSL: currSL,
    duration: formatTradeDuration(audit?.created_at, update?.closed_at || new Date()),
    outcomeText: extraData.outcomeText
  });

  if (!message) {
    const updatedSentEvents = {
      ...sentEvents,
      [eventType]: {
        status: "SKIPPED_NO_MESSAGE",
        sent_at: new Date().toISOString(),
        sent_count: 0,
        failed_count: 0,
        details: {}
      }
    };
    return { status: "SKIPPED", updatedSentEvents };
  }

  const subscriberChatIds = await fetchActiveSubscriberChatIds(audit);
  if (!subscriberChatIds?.length) {
    console.log("No active subscribers found for lifecycle event");
    const updatedSentEvents = {
      ...sentEvents,
      [eventType]: {
        status: "SKIPPED_NO_SUBSCRIBERS",
        sent_at: new Date().toISOString(),
        sent_count: 0,
        failed_count: 0,
        details: {}
      }
    };
    return { status: "NO_SUBSCRIBERS", updatedSentEvents };
  }

  console.log("=== STARTING LIFECYCLE TELEGRAM DELIVERY ===");
  console.log("RECOMMENDATION_ID:", outcome.recommendation_id);
  console.log("EVENT_TYPE:", eventType);
  console.log("SUBSCRIBERS COUNT:", subscriberChatIds.length);
  console.log("\n========== TELEGRAM MESSAGE ==========");
  console.log(message);
  console.log("======================================\n");

  const sentMap = {};
  let sentCount = 0;
  let failedCount = 0;

  for (const chatId of subscriberChatIds) {
    console.log("=== SENDING TO SUBSCRIBER ===");
    console.log("Chat ID:", chatId);
    console.log("TELEGRAM_SEND_START", new Date().toISOString());

    try {
      const response = await bot.telegram.sendMessage(chatId, message);
      console.log("TELEGRAM_SEND_SUCCESS", new Date().toISOString());
      console.log("=== TELEGRAM DELIVERY SUCCESS ===");
      sentMap[chatId] = { messageId: response.message_id, sent_at: new Date().toISOString() };
      sentCount++;
    } catch (err) {
      console.error("=== TELEGRAM DELIVERY FAILED ===");
      console.error(err.message);
      sentMap[chatId] = { error: err.message, failed_at: new Date().toISOString() };
      failedCount++;
    }
  }

  const updatedSentEvents = {
    ...sentEvents,
    [eventType]: {
      status: sentCount > 0 ? "SENT" : "FAILED",
      sent_at: new Date().toISOString(),
      sent_count: sentCount,
      failed_count: failedCount,
      details: sentMap,
      message_id: sentCount > 0 ? Object.values(sentMap)[0]?.messageId : null
    }
  };

  return {
    sentCount,
    failedCount,
    updatedSentEvents
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CORE EVENT GENERATOR & OUTCOME INITIALIZER
// ─────────────────────────────────────────────────────────────────────────────

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
      bootstrap: "recommendation_audit_insert",
      current_stop_loss: toNullableNumber(auditRow.stop_loss, "stop_loss"),
      previous_stop_loss: null,
      sent_events: {}
    }
  };

  const { error } = await supabase
    .from("recommendation_outcomes")
    .upsert([row], { onConflict: "recommendation_id", ignoreDuplicates: true });

  if (error) {
    throw new OutcomeTrackingError("Failed to initialize recommendation outcome", "OUTCOME_INIT_FAILED", { error });
  }
}

export function buildOutcomeUpdate({ outcome, audit, candles }) {
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
  let status = "OPEN";

  let currentSL = stopLoss;
  let prevSL = null;
  let trailingUpdated = false;

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
      const hit = evaluateHits(action, candle, targetPrice, currentSL);
      if (hit.target) {
        status = "TARGET_HIT";
        targetHitAt = candle.timestamp.toISOString();
        prevSL = currentSL;
        currentSL = entry; // Move Stop Loss to Cost (Entry)
        realizedReturn =
          action === "SELL"
            ? ((entry - targetPrice) / entry) * 100
            : ((targetPrice - entry) / entry) * 100;
      } else if (hit.stop) {
        status = "STOP_HIT";
        stopHitAt = candle.timestamp.toISOString();
        realizedReturn =
          action === "SELL"
            ? ((entry - currentSL) / entry) * 100
            : ((currentSL - entry) / entry) * 100;
        break;
      }
    } else if (status === "TARGET_HIT") {
      // Trail stop loss further if price continues strongly in our favor (+4% gains)
      if (action === "BUY") {
        if (candle.high >= entry * 1.04 && currentSL < entry * 1.015) {
          prevSL = currentSL;
          currentSL = entry * 1.015; // Lock in 1.5% profit
          trailingUpdated = true;
        }
      } else if (action === "SELL") {
        if (candle.low <= entry * 0.96 && currentSL > entry * 0.985) {
          prevSL = currentSL;
          currentSL = entry * 0.985; // Lock in 1.5% profit on short
          trailingUpdated = true;
        }
      }

      // Check if trailed stop loss is hit
      const stopHit = action === "SELL" ? candle.high >= currentSL : candle.low <= currentSL;
      if (stopHit) {
        status = "STOP_HIT";
        stopHitAt = candle.timestamp.toISOString();
        realizedReturn =
          action === "SELL"
            ? ((entry - currentSL) / entry) * 100
            : ((currentSL - entry) / entry) * 100;
        break;
      }
    }
  }

  const lastCandle = candles[candles.length - 1];
  const expiryAt = outcome.expiry_at ? toTimestamp(outcome.expiry_at, "expiry_at") : null;
  const evaluationTime = lastCandle ? lastCandle.timestamp.getTime() : Date.now();
  if ((status === "OPEN" || status === "TARGET_HIT") && expiryAt && evaluationTime >= expiryAt.getTime()) {
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
    closed_at: (status === "OPEN" || status === "TARGET_HIT") ? null : new Date().toISOString(),
    candles_processed: candles.length,
    last_tracking_run: new Date().toISOString(),
    tracking_version: TRACKING_VERSION,
    provider_metadata: {
      ...(outcome.provider_metadata || {}),
      source: "YAHOO",
      calculation_version: TRACKING_VERSION,
      candle_count: candles.length,
      current_stop_loss: currentSL,
      previous_stop_loss: prevSL,
      trailing_updated: trailingUpdated
    }
  };
}

export async function syncRecommendationOutcomes({ limit = MAX_BATCH_SIZE, onlyOpen = true } = {}) {
  const startedAt = Date.now();
  const statusFilter = onlyOpen ? ["OPEN", "TARGET_HIT"] : null;

  let query = supabase
    .from("recommendation_outcomes")
    .select("recommendation_id,symbol,entry_price,recommendation_created_at,outcome_status,expiry_at,provider_metadata,target_hit_at,stop_hit_at")
    .order("recommendation_created_at", { ascending: false })
    .limit(limit);
  if (statusFilter) query = query.in("outcome_status", statusFilter);

  const { data: outcomes, error } = await query;
  if (error) {
    logError("recommendation.outcome.fetch_failure", error, { stage: "outcomes_query" });
    return { processed: 0, updated: 0 };
  }
  if (!outcomes?.length) return { processed: 0, updated: 0 };

  const recommendationIds = outcomes.map((o) => o.recommendation_id);
  const { data: audits, error: auditError } = await supabase
    .from("recommendation_audit")
    .select("recommendation_id,symbol,exchange,action,entry_price,target_price,stop_loss,horizon,created_at,provider_metadata,risk_score,sector,generated_by")
    .in("recommendation_id", recommendationIds);
  if (auditError) {
    logError("recommendation.outcome.fetch_failure", auditError, { stage: "audit_query" });
    return { processed: 0, updated: 0 };
  }
  const auditMap = new Map((audits || []).map((a) => [a.recommendation_id, a]));
  const actionableOutcomes = (outcomes || []).filter((outcome) => {
    const audit = auditMap.get(outcome.recommendation_id);
    const action = String(audit?.action || "").toUpperCase();
    return (action === "BUY" || action === "SELL") && isProductionOutcomeRow(outcome, audit);
  });
  let updatedCount = 0;
  let totalCandlesProcessed = 0;

  console.log("=== ACTIVE RECOMMENDATIONS ===");
  console.log(actionableOutcomes.length);

  await mapWithConcurrency(actionableOutcomes, 2, async (outcome) => {
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
      let candles = (candlesRaw || []).map(normalizeCandle).sort((a, b) => a.timestamp - b.timestamp);
      if (!candles.length) {
        const fallbackCandle = await buildLiveFallbackCandle(outcome.symbol);
        candles = [fallbackCandle];
      }
      const update = buildOutcomeUpdate({ outcome, audit, candles });
      console.log({
        symbol: outcome.symbol,
        currentPrice: update.latest_price,
        targetPrice: audit.target_price,
        stopLoss: update.provider_metadata?.current_stop_loss || audit.stop_loss
      });

      totalCandlesProcessed += candles.length;

      // Maintain sent events track across execution
      let currentMetadata = {
        ...(outcome.provider_metadata || {}),
        current_stop_loss: update.provider_metadata?.current_stop_loss,
        previous_stop_loss: update.provider_metadata?.previous_stop_loss,
        sent_events: outcome.provider_metadata?.sent_events || {}
      };

      let isPersisted = false;
      const persistUpdate = async (statusVal) => {
        const payload = {
          ...update,
          outcome_status: statusVal,
          provider_metadata: {
            ...update.provider_metadata,
            ...currentMetadata
          }
        };
        const { error: writeError } = await supabase
          .from("recommendation_outcomes")
          .update(payload)
          .eq("recommendation_id", outcome.recommendation_id);
        if (writeError) {
          throw new OutcomeTrackingError(`Failed to persist lifecycle update: ${writeError.message}`, "PERSIST_FAILED", { error: writeError });
        }
        isPersisted = true;
        updatedCount++;
      };

      // ───────────────────────────────────────────────────────────────────────
      // LIFECYCLE EVENT DISPATCH CONTROL
      // ───────────────────────────────────────────────────────────────────────

      // A. TARGET HIT (Transition: OPEN -> TARGET_HIT)
      if (
        outcome.outcome_status === "OPEN" &&
        update.outcome_status === "TARGET_HIT" &&
        !(currentMetadata.sent_events?.["TARGET_HIT"]?.status && (currentMetadata.sent_events["TARGET_HIT"].status.startsWith("SENT") || currentMetadata.sent_events["TARGET_HIT"].status.startsWith("SKIPPED")))
      ) {
        const delivery = await deliverLifecycleEvent(
          { ...outcome, provider_metadata: currentMetadata },
          audit,
          update,
          "TARGET_HIT"
        );
        if (delivery.updatedSentEvents) {
          currentMetadata.sent_events = delivery.updatedSentEvents;
          await persistUpdate("TARGET_HIT");
        }
      }

      // B. TRAILING SL UPDATE
      if (
        update.provider_metadata?.trailing_updated &&
        !(currentMetadata.sent_events?.["TRAILING_SL_UPDATE"]?.status && (currentMetadata.sent_events["TRAILING_SL_UPDATE"].status.startsWith("SENT") || currentMetadata.sent_events["TRAILING_SL_UPDATE"].status.startsWith("SKIPPED")))
      ) {
        const delivery = await deliverLifecycleEvent(
          { ...outcome, provider_metadata: currentMetadata },
          audit,
          update,
          "TRAILING_SL_UPDATE"
        );
        if (delivery.updatedSentEvents) {
          currentMetadata.sent_events = delivery.updatedSentEvents;
          await persistUpdate(outcome.outcome_status);
        }
      }

      // C. STOP HIT (Transition to STOP_HIT)
      if (
        outcome.outcome_status !== "STOP_HIT" &&
        update.outcome_status === "STOP_HIT"
      ) {
        // C1. Stop Hit alert
        if (!(currentMetadata.sent_events?.["STOP_HIT"]?.status && (currentMetadata.sent_events["STOP_HIT"].status.startsWith("SENT") || currentMetadata.sent_events["STOP_HIT"].status.startsWith("SKIPPED")))) {
          const delivery = await deliverLifecycleEvent(
            { ...outcome, provider_metadata: currentMetadata },
            audit,
            update,
            "STOP_HIT"
          );
          if (delivery.updatedSentEvents) {
            currentMetadata.sent_events = delivery.updatedSentEvents;
            await persistUpdate("STOP_HIT");
          }
        }

        // C2. Also broadcast general closure
        if (!(currentMetadata.sent_events?.["TRADE_CLOSED"]?.status && (currentMetadata.sent_events["TRADE_CLOSED"].status.startsWith("SENT") || currentMetadata.sent_events["TRADE_CLOSED"].status.startsWith("SKIPPED")))) {
          const closeDelivery = await deliverLifecycleEvent(
            { ...outcome, provider_metadata: currentMetadata },
            audit,
            update,
            "TRADE_CLOSED",
            { outcomeText: "Risk protection triggered. Trailing stop hit." }
          );
          if (closeDelivery.updatedSentEvents) {
            currentMetadata.sent_events = closeDelivery.updatedSentEvents;
            await persistUpdate("STOP_HIT");
          }
        }
      }

      // D. EXPIRED
      if (
        outcome.outcome_status !== "EXPIRED" &&
        update.outcome_status === "EXPIRED" &&
        !(currentMetadata.sent_events?.["TRADE_CLOSED"]?.status && (currentMetadata.sent_events["TRADE_CLOSED"].status.startsWith("SENT") || currentMetadata.sent_events["TRADE_CLOSED"].status.startsWith("SKIPPED")))
      ) {
        const closeDelivery = await deliverLifecycleEvent(
          { ...outcome, provider_metadata: currentMetadata },
          audit,
          update,
          "TRADE_CLOSED",
          { outcomeText: "Setup expired without a fresh execution trigger." }
        );
        if (closeDelivery.updatedSentEvents) {
          currentMetadata.sent_events = closeDelivery.updatedSentEvents;
          await persistUpdate("EXPIRED");
        }
      }

      if (!isPersisted) {
        update.provider_metadata = {
          ...update.provider_metadata,
          ...currentMetadata
        };
        const { error: writeError } = await supabase
          .from("recommendation_outcomes")
          .update(update)
          .eq("recommendation_id", outcome.recommendation_id);
        if (writeError) {
          throw new OutcomeTrackingError(`Failed to persist lifecycle update: ${writeError.message}`, "PERSIST_FAILED", { error: writeError });
        }
        updatedCount++;
      }

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

  logEvent("recommendation.outcome.updated", {
    recommendation_id: null,
    symbol: "BATCH",
    outcome_status: "BATCH",
    return_pct: null,
    max_upside_pct: null,
    max_drawdown_pct: null,
    candles_processed: totalCandlesProcessed,
    processing_latency_ms: Date.now() - startedAt
  });

  return { processed: actionableOutcomes.length, updated: updatedCount };
}

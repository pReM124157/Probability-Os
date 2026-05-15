import supabase from "./supabase.service.js";
import { safeString } from "../core/safety.js";
import { createTraceId, logEvent } from "./telemetry.service.js";

const DEFAULT_ALERT_COOLDOWN_HOURS = 48;
const DEFAULT_ALERT_CLAIM_TTL_SECONDS = 180;

function normalizeSymbol(symbol) {
  return safeString(symbol).toUpperCase();
}

export async function shouldSendAlert(chatId, symbol, alertType) {
  const { data, error } = await supabase
    .from("alert_memory")
    .select("*")
    .eq("chat_id", String(chatId))
    .eq("symbol", normalizeSymbol(symbol))
    .eq("alert_type", alertType)
    .order("last_sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Alert check error:", error.message);
    return false;
  }

  if (!data) return true;

  const lastSent = new Date(data.last_sent_at);
  const now = new Date();

  const diffHours =
    (now.getTime() - lastSent.getTime()) / (1000 * 60 * 60);

  return diffHours >= 48;
}

export async function saveAlert(chatId, symbol, alertType) {
  const { error } = await supabase
    .from("alert_memory")
    .upsert({
      chat_id: String(chatId),
      symbol: normalizeSymbol(symbol),
      alert_type: alertType,
      last_sent_at: new Date().toISOString()
    }, {
      onConflict: "chat_id,symbol,alert_type"
    });

  if (error) {
    console.error("Save alert error:", error.message);
  }
}

export async function claimAlertDelivery(chatId, symbol, alertType, options = {}) {
  const ownerId = options.ownerId || createTraceId("alert");
  const cooldownHours = options.cooldownHours || DEFAULT_ALERT_COOLDOWN_HOURS;
  const claimTtlSeconds = options.claimTtlSeconds || DEFAULT_ALERT_CLAIM_TTL_SECONDS;
  const traceId = options.traceId || ownerId;

  const { data, error } = await supabase.rpc("claim_alert_delivery", {
    p_chat_id: String(chatId),
    p_symbol: normalizeSymbol(symbol),
    p_alert_type: alertType,
    p_owner_id: ownerId,
    p_claim_ttl_seconds: claimTtlSeconds,
    p_cooldown_hours: cooldownHours
  });

  if (error) throw error;

  const claimed = data === true;
  logEvent(claimed ? "alert.claimed" : "alert.skipped", {
    traceId,
    ownerId,
    chatId: String(chatId),
    symbol: normalizeSymbol(symbol),
    alertType
  });

  return {
    claimed,
    ownerId,
    traceId
  };
}

export async function finalizeAlertDelivery(chatId, symbol, alertType, ownerId, traceId = ownerId) {
  const { data, error } = await supabase.rpc("finalize_alert_delivery", {
    p_chat_id: String(chatId),
    p_symbol: normalizeSymbol(symbol),
    p_alert_type: alertType,
    p_owner_id: ownerId
  });
  if (error) throw error;
  logEvent("alert.finalized", {
    traceId,
    ownerId,
    chatId: String(chatId),
    symbol: normalizeSymbol(symbol),
    alertType,
    finalized: data === true
  });
  return data === true;
}

export async function releaseAlertDeliveryClaim(chatId, symbol, alertType, ownerId, traceId = ownerId) {
  const { data, error } = await supabase.rpc("release_alert_delivery_claim", {
    p_chat_id: String(chatId),
    p_symbol: normalizeSymbol(symbol),
    p_alert_type: alertType,
    p_owner_id: ownerId
  });
  if (error) throw error;
  logEvent("alert.claim.released", {
    traceId,
    ownerId,
    chatId: String(chatId),
    symbol: normalizeSymbol(symbol),
    alertType,
    released: data === true
  });
  return data === true;
}

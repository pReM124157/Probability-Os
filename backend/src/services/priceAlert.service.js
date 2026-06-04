import supabase, { isSupabaseSchemaMissing, logInfraFallbackOnce } from "./supabase.service.js";

function normalizeAlertSymbol(symbol) {
  return String(symbol || "")
    .toUpperCase()
    .replace(/\.NS$|\.BO$/, "")
    .replace(/[^A-Z0-9]/g, "")
    .trim();
}

function normalizeCondition(condition) {
  const normalized = String(condition || "").toLowerCase();
  if (["below", "under", "less"].includes(normalized)) return "below";
  return "above";
}

export async function createPriceAlert({
  chatId,
  symbol,
  exchange = "NSE",
  condition = "above",
  targetPrice
}) {
  const cleanSymbol = normalizeAlertSymbol(symbol);
  const cleanCondition = normalizeCondition(condition);
  const price = Number(targetPrice);

  if (!chatId) throw new Error("chatId is required");
  if (!cleanSymbol) throw new Error("symbol is required");
  if (!price || price <= 0) throw new Error("targetPrice must be positive");

  const payload = {
    chat_id: String(chatId),
    symbol: cleanSymbol,
    exchange,
    condition: cleanCondition,
    target_price: price,
    status: "active"
  };

  const { data, error } = await supabase
    .from("price_alerts")
    .insert(payload)
    .select("*")
    .single();

  if (error) {
    if (isSupabaseSchemaMissing(error)) {
      logInfraFallbackOnce(
        "price_alerts_missing",
        "[PRICE ALERTS] price_alerts table missing; alert persistence disabled",
        { code: error.code, message: error.message }
      );
    }

    throw new Error(error.message || "Failed to create price alert");
  }

  return data;
}

export async function getActivePriceAlerts(limit = 100) {
  const { data, error } = await supabase
    .from("price_alerts")
    .select("*")
    .eq("status", "active")
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    if (isSupabaseSchemaMissing(error)) {
      logInfraFallbackOnce(
        "price_alerts_missing_read",
        "[PRICE ALERTS] price_alerts table missing; trigger scanner disabled",
        { code: error.code, message: error.message }
      );
      return [];
    }

    throw new Error(error.message || "Failed to fetch active price alerts");
  }

  return data || [];
}

export function isPriceAlertTriggered(alert, currentPrice) {
  const price = Number(currentPrice);
  const target = Number(alert?.target_price);

  if (!price || price <= 0 || !target || target <= 0) return false;

  if (alert.condition === "below") return price <= target;
  return price >= target;
}

export async function markPriceAlertTriggered(alertId, currentPrice, source = "UNKNOWN") {
  const { data, error } = await supabase
    .from("price_alerts")
    .update({
      status: "triggered",
      triggered_at: new Date().toISOString(),
      trigger_price: currentPrice,
      trigger_source: source
    })
    .eq("id", alertId)
    .eq("status", "active")
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message || "Failed to mark price alert triggered");
  }

  return data;
}

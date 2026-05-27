import supabase from "./supabase.service.js";
import { safeString } from "../core/safety.js";

const SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000";

/**
 * Adds or updates a holding for a user.
 */
export async function addHolding(chatId, { symbol, quantity, avgPrice }) {
  try {
    const { data, error } = await supabase
      .from("holdings")
      .upsert({
        chat_id: String(chatId),
        symbol: safeString(symbol).toUpperCase(),
        quantity,
        avg_price: avgPrice,
        updated_at: new Date()
      }, {
        onConflict: "chat_id,symbol"
      });

    if (error) throw new Error(error.message);
    return data;
  } catch (error) {
    console.error("Detailed Add Holding Error:", error);
    throw error;
  }
}

/**
 * Retrieves all holdings for a specific user.
 */
export async function getPortfolio(chatId) {
  try {
    const { data, error } = await supabase
      .from("holdings")
      .select("*")
      .eq("chat_id", chatId);

    if (error) throw error;

    return data.map((h) => ({
      symbol: h.symbol,
      allocation: h.quantity * h.avg_price,
      quantity: h.quantity,
      avgPrice: h.avg_price
    }));
  } catch (error) {
    console.error("Error fetching portfolio:", error.message);
    return [];
  }
}

/**
 * Removes a holding.
 */
export async function removeHolding(chatId, symbol) {
  try {
    const { data, error } = await supabase
      .from("holdings")
      .delete()
      .eq("chat_id", chatId)
      .eq("symbol", safeString(symbol).toUpperCase());

    if (error) throw error;
    return data;
  } catch (error) {
    console.error("Error removing holding:", error.message);
    throw error;
  }
}

/**
 * Updates a holding.
 */
export async function updateHolding(chatId, symbol, updates) {
  try {
    const { data, error } = await supabase
      .from("holdings")
      .update(updates)
      .eq("chat_id", chatId)
      .eq("symbol", safeString(symbol).toUpperCase());

    if (error) throw error;
    return data;
  } catch (error) {
    console.error("Error updating holding:", error.message);
    throw error;
  }
}

function clamp(value, min = 0, max = 1) {
  return Math.min(Math.max(Number(value) || 0, min), max);
}

export async function storeHistoricalPortfolioStates(state = {}) {
  const row = {
    user_id: state.userId || SYSTEM_USER_ID,
    portfolio_value: Number(state.portfolioValue || 0),
    drawdown: Number(state.drawdown || 0),
    volatility: Number(state.volatility || 0),
    concentration: Number(state.concentration || 0),
    heat_score: Number(state.heatScore || 0),
    regime: state.regime || "UNKNOWN",
    notes: state.notes || null
  };

  const { error } = await supabase.from("portfolio_history").insert(row);
  if (error) console.warn("[PORTFOLIO MEMORY] storeHistoricalPortfolioStates failed:", error.message);
  return row;
}

export function trackPortfolioEvolution(history = []) {
  if (history.length < 2) return { trend: "INSUFFICIENT_DATA", improvement: 0 };
  const latest = history[0];
  const prior = history[history.length - 1];
  const improvement = Number((Number(prior.drawdown || 0) - Number(latest.drawdown || 0)).toFixed(2));
  return { trend: improvement >= 0 ? "IMPROVING" : "DETERIORATING", improvement };
}

export function trackBehaviorPatterns(history = []) {
  const highHeat = history.filter((h) => Number(h.heat_score || 0) > 65).length;
  const highConcentration = history.filter((h) => Number(h.concentration || 0) > 40).length;
  return {
    highHeatRatio: Number(clamp(highHeat / Math.max(history.length, 1), 0, 1).toFixed(4)),
    highConcentrationRatio: Number(clamp(highConcentration / Math.max(history.length, 1), 0, 1).toFixed(4))
  };
}

export function trackRecurringFailures(events = []) {
  const grouped = events.reduce((acc, e) => {
    const key = e.failure_reason || "UNKNOWN";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  return grouped;
}

export function trackRecurringStrengths(events = []) {
  const grouped = events.reduce((acc, e) => {
    const key = e.success_reason || "UNKNOWN";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  return grouped;
}

export function detectRepeatedRiskPatterns(history = []) {
  const patterns = [];
  const behaviors = trackBehaviorPatterns(history);
  if (behaviors.highHeatRatio > 0.35) patterns.push("Recurring excessive portfolio heat");
  if (behaviors.highConcentrationRatio > 0.3) patterns.push("Recurring concentration mistakes");
  return patterns;
}

export function buildHistoricalPortfolioGraph(history = []) {
  return history.map((h) => ({
    t: h.created_at,
    value: Number(h.portfolio_value || 0),
    drawdown: Number(h.drawdown || 0),
    heat: Number(h.heat_score || 0)
  }));
}

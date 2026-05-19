import supabase from "./supabase.service.js";
import { sendTelegramAlert } from "./alert.service.js";

const PRIORITY_ORDER = ["INFO", "WARNING", "HIGH_PRIORITY", "CRITICAL"];

export function rankPortfolioThreats(threats = []) {
  return [...threats].sort((a, b) => {
    const pa = PRIORITY_ORDER.indexOf(a.urgency || "INFO");
    const pb = PRIORITY_ORDER.indexOf(b.urgency || "INFO");
    if (pa !== pb) return pb - pa;
    return (b.dangerScore || 0) - (a.dangerScore || 0);
  });
}

export function generatePortfolioDefensePlan(alerts = []) {
  const critical = alerts.filter((a) => a.urgency === "CRITICAL").length;
  const high = alerts.filter((a) => a.urgency === "HIGH_PRIORITY").length;
  const exits = alerts.filter((a) => a.action !== "HOLD");

  return {
    summary: `Defense posture: ${critical} critical, ${high} high-priority threats; ${exits.length} active de-risking actions`,
    immediateActions: exits.slice(0, 5).map((alert) => `${alert.ticker}: ${alert.action} ${alert.sellQuantity}`)
  };
}

export function generatePortfolioAlert(payload = {}) {
  return {
    ticker: payload.ticker,
    action: payload.action,
    sellQuantity: payload.sellQuantity,
    urgency: payload.urgency,
    confidence: payload.confidence,
    trendState: payload.trendState,
    mathematicalReasoning: payload.mathematicalReasoning,
    portfolioImpact: payload.portfolioImpact,
    marketRegime: payload.marketRegime,
    downsideProbability: payload.downsideProbability,
    expectedCorrection: payload.expectedCorrection,
    capitalProtectionBenefit: payload.capitalProtectionBenefit,
    dangerScore: payload.dangerScore || 0,
    createdAt: new Date().toISOString()
  };
}

export async function sendUrgentExitAlert(alert) {
  const urgencyPrefix = alert.urgency === "CRITICAL" ? "CRITICAL" : alert.urgency;
  const message = [
    `PORTFOLIO DEFENSE ${urgencyPrefix}`,
    `${alert.ticker}: ${alert.action} ${alert.sellQuantity}`,
    `Confidence: ${(alert.confidence * 100).toFixed(0)}%`,
    `Trend state: ${alert.trendState}`,
    `Regime: ${alert.marketRegime}`,
    `Reasoning: ${alert.mathematicalReasoning}`,
    `Impact: ${alert.portfolioImpact}`,
    `Downside probability: ${(alert.downsideProbability * 100).toFixed(1)}%`,
    `Expected correction: ${alert.expectedCorrection}%`,
    `Capital protection benefit: ${alert.capitalProtectionBenefit}%`
  ].join("\n");

  await sendTelegramAlert(message);
}

export async function persistPortfolioAlerts(alerts = []) {
  if (!alerts.length) return;
  const rows = alerts.map((alert) => ({
    ticker: alert.ticker,
    alert_type: alert.urgency,
    urgency: alert.urgency,
    action: alert.action,
    quantity: alert.sellQuantity,
    reasoning: alert.mathematicalReasoning,
    created_at: new Date().toISOString()
  }));

  const { error } = await supabase.from("portfolio_alerts").insert(rows);
  if (error) {
    console.warn("[PORTFOLIO ALERTS] Persist failed:", error.message);
  }
}

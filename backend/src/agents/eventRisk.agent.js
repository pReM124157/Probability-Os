/**
 * eventRisk.agent.js
 * Analyzes upcoming corporate and macro events to determine event-based risk.
 * Even strong BUY setups may be paused if high-impact events are imminent.
 */
import { getCompanyOverview, getHistoricalCandles } from "../services/marketData.service.js";
import { getOrPopulateSharedCache } from "../services/sharedCache.service.js";

async function getEarningsEvent(symbol, passedEarningsDate) {
  if (passedEarningsDate) return new Date(passedEarningsDate);
  if (!symbol) return null;
  const cacheKey = `EARNINGS_EVENT_${String(symbol).toUpperCase()}`;
  const payload = await getOrPopulateSharedCache(
    cacheKey,
    "earnings_calendar",
    6 * 60 * 60,
    async () => {
      const overview = await getCompanyOverview(symbol);
      return {
        earningsDate: overview?.EarningsDate || null
      };
    },
    { lockOwner: `earnings:${symbol}`, fillLockTtlSeconds: 45, waitMs: 5000 }
  );
  return payload?.earningsDate ? new Date(payload.earningsDate) : null;
}

async function getVolatilityProxy(symbol) {
  if (!symbol) return null;
  const candles = await getHistoricalCandles(symbol, { days: 120, interval: "1d" });
  if (!Array.isArray(candles) || candles.length < 40) return null;
  const closes = candles.map((c) => Number(c?.close || 0)).filter((v) => v > 0);
  if (closes.length < 30) return null;
  const returns = [];
  for (let i = 1; i < closes.length; i++) returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
  const variance = returns.reduce((s, r) => s + (r * r), 0) / returns.length;
  const realizedVolPct = Math.sqrt(variance) * Math.sqrt(252) * 100;
  const eventWindow = returns.slice(-5);
  const historicalEarningsMovePct = (eventWindow.reduce((s, r) => s + Math.abs(r), 0) / Math.max(eventWindow.length, 1)) * 100;
  return { realizedVolPct, historicalEarningsMovePct };
}

export async function analyzeEventRisk({
    symbol,
    earningsDate, // Date object or timestamp
    macroEvents = [] // Future placeholder for macro integration
}) {
    try {
        const eventDate = await getEarningsEvent(symbol, earningsDate);
        if (!eventDate) {
            return {
                eventRisk: "UNAVAILABLE",
                eventType: "EARNINGS",
                daysRemaining: null,
                action: "Event schedule unavailable.",
                reason: "Event schedule unavailable."
            };
        }

        const now = new Date();
        const timeDiff = eventDate - now;
        const daysRemaining = Math.ceil(timeDiff / (1000 * 60 * 60 * 24));
        const volProxy = await getVolatilityProxy(symbol);
        const impliedVolProxy = Number(volProxy?.realizedVolPct || 0);
        const historicalEarningsMove = Number(volProxy?.historicalEarningsMovePct || 0);
        const eventCluster = daysRemaining >= 0 && daysRemaining <= 14 && (macroEvents?.length || 0) >= 2;

        let eventRisk = "LOW";
        let action = "Monitor as usual";
        let reason = `Upcoming earnings in ${daysRemaining} days.`;

        if (daysRemaining >= 0 && daysRemaining <= 7) {
            eventRisk = "HIGH";
            action = "Avoid fresh entry before event clarity";
            reason = `Earnings in ${daysRemaining} days with elevated volatility risk.`;
        } else if (daysRemaining > 7 && daysRemaining <= 14) {
            eventRisk = "MODERATE";
            action = "Cautious entry only. Small sizing.";
            reason = `Earnings approaching in ${daysRemaining} days.`;
        }

        if (impliedVolProxy >= 35 || historicalEarningsMove >= 3.5 || eventCluster) {
            eventRisk = eventRisk === "LOW" ? "MODERATE" : "HIGH";
            reason = `${reason} Volatility regime is elevated near event window.`;
        }

        return {
            eventRisk,
            eventType: "EARNINGS RESULT",
            daysRemaining,
            action,
            reason,
            impliedVolatilityProxy: Number(impliedVolProxy.toFixed(2)),
            historicalEarningsMovePct: Number(historicalEarningsMove.toFixed(2))
        };

    } catch (error) {
        console.error("Event Risk Agent Error:", error.message);
        return {
            eventRisk: "UNAVAILABLE",
            eventType: "UNKNOWN",
            daysRemaining: null,
            action: "Event schedule unavailable.",
            reason: "Event schedule unavailable."
        };
    }
}

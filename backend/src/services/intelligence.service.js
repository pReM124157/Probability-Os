/**
 * Institutional Intelligence Service
 * Handles: Signals, Sector Strength, and Relative Strength
 */

export function calculateRelativeStrength(stockChange, indexChange) {
  const diff = stockChange - indexChange;
  if (diff > 2) return { status: "Outperforming Index", strength: "STRONG" };
  if (diff > 0) return { status: "Leading Index", strength: "MODERATE" };
  if (diff < -2) return { status: "Underperforming Index", strength: "WEAK" };
  return { status: "Neutral vs Index", strength: "NEUTRAL" };
}

export function generateSignals(data) {
  const signals = [];
  
  // 1. Fundamental Quality (Compounder)
  if (data.roe > 18 && data.revenueGrowth > 12 && data.pe < 40) {
    signals.push({ type: "QUALITY_COMPOUNDER", confidence: 9, note: "Top-tier capital efficiency and growth." });
  }

  // 2. Value Opportunity
  if (data.pe < 15 && data.dividendYield > 2) {
    signals.push({ type: "VALUE_PICK", confidence: 7, note: "Undervalued with strong dividend support." });
  }

  // 3. Momentum / Accumulation
  if (data.priceAboveMA200 && data.volumeSpike) {
    signals.push({ type: "ACCUMULATION_ZONE", confidence: 8, note: "Institutional accumulation detected near support." });
  }

  return signals;
}

export function getSectorMomentum() {
  // In a real system, this would be fetched from an API. 
  // For now, we use a daily-refreshable mock or calculated from indices.
  return {
    "IT": { strength: 1.2, bias: "BULLISH" },
    "FINANCIAL_SERVICES": { strength: 0.5, bias: "NEUTRAL" },
    "ENERGY": { strength: -0.8, bias: "BEARISH" },
    "AUTO": { strength: 2.1, bias: "STRONG_BULLISH" },
    "PHARMA": { strength: 0.2, bias: "NEUTRAL" }
  };
}

export function calculatePositionSize(riskAmount, entry, stopLoss) {
  if (!entry || !stopLoss || entry <= stopLoss) return null;
  const riskPerShare = entry - stopLoss;
  return Math.floor(riskAmount / riskPerShare);
}

function parseNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function parseCurrency(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const cleaned = String(value || "").replace(/[^0-9.-]/g, "");
  return parseNumber(cleaned, 0);
}

function parseEntryZone(entryZone) {
  const text = String(entryZone || "");
  const matches = text.match(/-?\d+(?:\.\d+)?/g) || [];
  if (matches.length < 2) return { lower: 0, upper: 0 };
  const lower = parseNumber(matches[0], 0);
  const upper = parseNumber(matches[1], 0);
  return { lower: Math.min(lower, upper), upper: Math.max(lower, upper) };
}

export function validateSignal(signal = {}) {
  const reasons = [];
  const rr = parseNumber(signal.rewardRiskRatio ?? signal.rr ?? signal.rrRatio, 0);
  const stock = String(signal.stock || signal.ticker || "").trim();
  const confidence = parseNumber(signal.confidenceScore ?? signal.confidence ?? signal.convictionScore, 0);
  const decision = String(signal.decision || signal.action || "HOLD").toUpperCase();
  const strategy = String(signal.strategy || signal.entrySignal || "").toUpperCase();
  const volumeRatio = parseNumber(signal.volumeRatio, 0);
  const rsi = parseNumber(signal.rsi, 50);
  const trend = String(signal.trend || "NEUTRAL").toUpperCase();
  const trendStrength = parseNumber(signal.trendStrength, 0);
  const momentumConfirmed = Boolean(signal.momentumConfirmed);
  const allocation = String(signal.allocation || "");
  const currentPrice = parseCurrency(signal.currentPrice);
  const stopLoss = parseCurrency(signal.stopLoss);
  const stopDistancePercent = currentPrice > 0 ? ((currentPrice - stopLoss) / currentPrice) * 100 : 999;
  const entry = parseEntryZone(signal.idealEntryZone || signal.entryZone);
  const entryZoneWidthPercent = currentPrice > 0 ? ((entry.upper - entry.lower) / currentPrice) * 100 : 999;

  const isStrongTrend = trendStrength >= 18;
  const isModerateTrend = trendStrength >= 10;
  const minRR = isStrongTrend ? 1.8 : isModerateTrend ? 1.35 : 1.15;
  const minConfidence = isStrongTrend ? 68 : isModerateTrend ? 58 : 52;
  const minVolume = isStrongTrend ? 1.2 : isModerateTrend ? 1.0 : 0.85;

  if (!stock || stock.toUpperCase() === "UNKNOWN") reasons.push("undefined_ticker");
  if (rr < minRR) reasons.push("low_rr");
  if (decision === "HOLD") reasons.push("hold_decision");
  if (confidence < minConfidence) reasons.push("low_confidence");
  if (volumeRatio < minVolume) reasons.push("low_volume");
  if (rsi > 75) reasons.push("overbought_rsi");
  if (stopDistancePercent > 6) reasons.push("wide_stop");
  if (entryZoneWidthPercent > 4) reasons.push("wide_entry_zone");
  // trend filter relaxed - neutral trend acceptable
  if (trend === "BEARISH" && confidence < 60) reasons.push("bearish_trend_low_confidence");
  // momentum confirmation relaxed for sideways markets
  if (allocation === "0%") reasons.push("zero_allocation");
  if (strategy.includes("AVOID") || strategy.includes("WAIT")) reasons.push("blocked_strategy");

  return {
    approved: reasons.length === 0,
    reasons,
    metrics: {
      rr,
      confidence,
      volumeRatio,
      trendStrength,
      thresholds: {
        minRR,
        minConfidence,
        minVolume
      },
      rsi,
      stopDistancePercent: Number(stopDistancePercent.toFixed(2)),
      entryZoneWidthPercent: Number(entryZoneWidthPercent.toFixed(2))
    }
  };
}

export function shouldRejectSignal(signal = {}) {
  return !validateSignal(signal).approved;
}

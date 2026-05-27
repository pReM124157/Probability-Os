import { toNumber } from "./convictionEngine.js";

function formatPrice(value) {
  return `₹${Math.round(value)}`;
}

function normalizeEntryZone({ entry, stopLoss, currentPrice }) {
  const price = toNumber(currentPrice);
  const maxWidth = price * 0.04;
  const lowerBound = Math.max(stopLoss, entry - maxWidth / 2);
  const upperBound = Math.min(price * 1.01, entry + maxWidth / 2);
  const width = Math.max(0, upperBound - lowerBound);
  return {
    lower: lowerBound,
    upper: upperBound,
    widthPct: price > 0 ? (width / price) * 100 : 0
  };
}

export function buildVolatilitySetup({ ticker, currentPrice, technicalData = {} }) {
  const price = toNumber(currentPrice);
  const atr = toNumber(technicalData.atr) || price * 0.025;
  const support = toNumber(technicalData.support) || price * 0.97;
  const resistance = toNumber(technicalData.resistance) || price * 1.03;
  const sma20 = toNumber(technicalData.sma20) || price;
  const sma50 = toNumber(technicalData.sma50) || price;
  const rsi = toNumber(technicalData.rsi);
  const volumeRatio = toNumber(technicalData.volumeRatio) || 1;
  const trend = String(technicalData.trend || "NEUTRAL").toUpperCase();
  const momentumStrength = String(technicalData.momentumStrength || "WEAK").toUpperCase();

  const atrPct = price > 0 ? atr / price : 0;
  const atrCompression = atrPct > 0 && atrPct <= 0.012;
  const volatilityExpansion = atrPct >= 0.025;
  const trendStrength = toNumber(technicalData.score) || 5;
  const momentumPersistence =
    (momentumStrength === "STRONG" ? 0.25 : momentumStrength === "MODERATE" ? 0.12 : 0) +
    (volumeRatio >= 1.4 ? 0.08 : 0) +
    (rsi >= 55 && rsi <= 70 ? 0.07 : 0);
  const breakoutContinuationProbability = Math.min(
    0.9,
    0.45 +
      (trend === "BULLISH" ? 0.18 : 0) +
      (trendStrength >= 7 ? 0.12 : trendStrength >= 6 ? 0.07 : 0) +
      momentumPersistence
  );
  const historicalMoveExtension = Math.max(0.8, Math.min(2.4, 1.1 + (trendStrength - 5) * 0.18));
  const resistanceProjection = Math.max(resistance, price + (atr * (1.2 + breakoutContinuationProbability)));
  const volatilityExpansionMultiplier = volatilityExpansion ? 1.2 : atrCompression ? 0.78 : 1;

  const stopLoss = Math.min(
    price - Math.max(0.8 * atr, price * 0.006),
    Math.max(support, sma50 - (0.4 * atr)) - Math.max(0.35 * atr, price * 0.004),
    (sma20 + sma50) / 2 - Math.max(0.45 * atr, price * 0.0045)
  );
  const validStop = stopLoss > 0 && stopLoss < price
    ? stopLoss
    : price - Math.max(1.2 * atr, price * 0.02);

  const normalizedTrendStrength = trendStrength <= 10 ? trendStrength * 10 : trendStrength;
  if (normalizedTrendStrength < 55) return null;

  let dynamicRRMultiplier = 1.5;
  if (normalizedTrendStrength >= 85) dynamicRRMultiplier = 3.0;
  else if (normalizedTrendStrength >= 75) dynamicRRMultiplier = 2.5;
  else if (normalizedTrendStrength >= 65) dynamicRRMultiplier = 2.0;

  const positionType = normalizedTrendStrength >= 80 ? "SWING" : normalizedTrendStrength >= 65 ? "POSITIONAL" : "TACTICAL";
  const maxStopPct = positionType === "SWING" ? 0.06 : positionType === "POSITIONAL" ? 0.08 : 0.05;

  const rawStopDistance = price - validStop;
  const clampedStopDistance = Math.min(rawStopDistance, price * maxStopPct);
  if (clampedStopDistance <= 0) return null;
  const normalizedStopLoss = price - clampedStopDistance;
  const targetDistance = clampedStopDistance * dynamicRRMultiplier;
  if (clampedStopDistance > targetDistance) return null;
  
  const target1 = price + (clampedStopDistance * dynamicRRMultiplier);
  const target2 = price + (clampedStopDistance * (dynamicRRMultiplier + 0.5));
  const target3 = price + (clampedStopDistance * (dynamicRRMultiplier + 1.0));

  const risk = clampedStopDistance;
  const reward = target1 - price;
  const rr = risk > 0 ? reward / risk : 0;
  if (rr < 1.5) return null;

  const rawEntryLower = Math.max(normalizedStopLoss + (0.4 * atr), Math.min(price, sma20, sma50) - (0.25 * atr));
  const rawEntryUpper = Math.max(rawEntryLower, Math.min(price + (0.35 * atr), target1));
  const normalizedEntry = normalizeEntryZone({
    entry: (rawEntryLower + rawEntryUpper) / 2,
    stopLoss: normalizedStopLoss,
    currentPrice: price
  });
  if (normalizedEntry.widthPct > 4) return null;
  const riskBand =
    atr > price * 0.03 ? "HIGH" : atr > price * 0.015 ? "MEDIUM" : "LOW";

  return {
    ticker,
    currentPrice: Number(price.toFixed(2)),
    atr: Number(atr.toFixed(2)),
    volatilityBand: riskBand,
    idealEntryZone: `${formatPrice(normalizedEntry.lower)} - ${formatPrice(normalizedEntry.upper)}`,
    stopLoss: Number(normalizedStopLoss.toFixed(2)),
    target1: Number(target1.toFixed(2)),
    target2: Number(target2.toFixed(2)),
    target3: Number(target3.toFixed(2)),
    rr: Number(rr.toFixed(2)),
    positionType,
    atrCompression,
    breakoutContinuationProbability: Number(breakoutContinuationProbability.toFixed(2)),
    trendStrength: Number(trendStrength.toFixed(1)),
    momentumConfirmed: momentumStrength !== "WEAK" && volumeRatio >= 1.1 && rsi >= 50 && rsi <= 75
  };
}

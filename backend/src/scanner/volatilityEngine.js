import { toNumber } from "./convictionEngine.js";

function formatPrice(value) {
  return `₹${Math.round(value)}`;
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

  const projectedMove =
    atr *
    historicalMoveExtension *
    breakoutContinuationProbability *
    volatilityExpansionMultiplier;
  const target1Raw = Math.max(resistanceProjection, price + projectedMove);
  const target1 = atrCompression
    ? Math.min(target1Raw, price + (1.8 * atr))
    : target1Raw;
  const target2 = Math.max(
    target1 + (0.9 * atr * volatilityExpansionMultiplier),
    target1 * (1 + Math.max(0.012, projectedMove / Math.max(price, 1)))
  );
  const risk = price - validStop;
  const reward = target1 - price;
  const rr = risk > 0 ? reward / risk : 0;

  const entryLower = Math.max(validStop + (0.4 * atr), Math.min(price, sma20, sma50) - (0.25 * atr));
  const entryUpper = Math.max(entryLower, Math.min(price + (0.4 * atr), target1));
  const riskBand =
    atr > price * 0.03 ? "HIGH" : atr > price * 0.015 ? "MEDIUM" : "LOW";

  return {
    ticker,
    currentPrice: Number(price.toFixed(2)),
    atr: Number(atr.toFixed(2)),
    volatilityBand: riskBand,
    idealEntryZone: `${formatPrice(entryLower)} – ${formatPrice(entryUpper)}`,
    stopLoss: Number(validStop.toFixed(2)),
    target1: Number(target1.toFixed(2)),
    target2: Number(target2.toFixed(2)),
    rr: Number(rr.toFixed(2)),
    atrCompression,
    breakoutContinuationProbability: Number(breakoutContinuationProbability.toFixed(2)),
    trendStrength: Number(trendStrength.toFixed(1)),
    momentumConfirmed: momentumStrength !== "WEAK" && volumeRatio >= 1.1 && rsi >= 50
  };
}

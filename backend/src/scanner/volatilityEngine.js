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

  const stopLoss = Math.min(
    price - Math.max(0.8 * atr, price * 0.006),
    Math.max(support, sma50 - (0.4 * atr)) - Math.max(0.35 * atr, price * 0.004)
  );
  const validStop = stopLoss > 0 && stopLoss < price
    ? stopLoss
    : price - Math.max(1.2 * atr, price * 0.02);

  const target1 = resistance > price ? resistance : price + (2.4 * atr);
  const target2 = Math.max(target1 + (1.1 * atr), price + (3.2 * atr));
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
    rr: Number(rr.toFixed(2))
  };
}

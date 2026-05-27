/**
 * Price Validation Utilities
 * Guards against zero-price / NaN / Infinity propagation through the data pipeline.
 * Any price that fails isValidPrice() MUST be rejected before caching.
 */

export function isValidPrice(price) {
  return Number.isFinite(price) && price > 0;
}

/**
 * Safely coerce a value to a valid positive price.
 * Returns null if the value is not a finite positive number.
 */
export function toValidPrice(raw) {
  const n = Number(raw);
  return isValidPrice(n) ? n : null;
}

/**
 * Logs and returns null for invalid prices, preventing cache poisoning.
 */
export function assertValidPrice(price, symbol, source = "unknown") {
  if (!isValidPrice(price)) {
    console.warn(`[INVALID PRICE REJECTED] symbol=${symbol} source=${source} value=${price}`);
    return null;
  }
  return price;
}

const historicalCache = new Map();

function keyFor(symbol, days, interval) {
  return `${String(symbol || "").toUpperCase()}:${days}:${interval}`;
}

export function calculateHistoricalTTL(interval = "1d") {
  const low = String(interval || "").toLowerCase();
  if (low.includes("m") || low.includes("h")) return 15 * 60 * 1000;
  return 60 * 60 * 1000;
}

export function detectRecentlyFetchedData(symbol, days, interval = "1d") {
  const key = keyFor(symbol, days, interval);
  const entry = historicalCache.get(key);
  if (!entry) return false;
  if (entry.expiresAt <= Date.now()) {
    historicalCache.delete(key);
    return false;
  }
  return true;
}

export function getCachedHistoricalData(symbol, days, interval = "1d") {
  const key = keyFor(symbol, days, interval);
  const entry = historicalCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    historicalCache.delete(key);
    return null;
  }
  return entry.data;
}

export function storeHistoricalData(symbol, days, interval = "1d", data = []) {
  const key = keyFor(symbol, days, interval);
  const ttlMs = calculateHistoricalTTL(interval);
  historicalCache.set(key, {
    data,
    expiresAt: Date.now() + ttlMs
  });
}

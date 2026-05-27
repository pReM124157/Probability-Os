export const TICKER_ALIASES = {
  ICICBANK: "ICICIBANK",
  ICICBANK_NS: "ICICIBANK",
  ICICI: "ICICIBANK",
  ICICIBANK: "ICICIBANK"
};

export function normalizeTickerAlias(input) {
  if (!input) return input;
  const raw = String(input).trim().toUpperCase();
  const base = raw.replace(".NS", "").replace(".BO", "").replace(/[^A-Z0-9]/g, "_");
  return TICKER_ALIASES[base] || base.replace(/_/g, "");
}


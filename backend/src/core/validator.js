/**
 * isValidSymbol — Hard symbol validation.
 * Only pure alphabetic tickers 3–15 chars pass.
 */
export function isValidSymbol(symbol) {
  if (!symbol || typeof symbol !== "string") return false;
  const clean = symbol.trim().toUpperCase();
  if (clean.length < 3 || clean.length > 15) return false;
  return /^[A-Z]+$/.test(clean);
}

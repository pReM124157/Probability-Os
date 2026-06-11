/**
 * parseInput — Single source of truth for intent routing.
 * Converts raw Telegram message text into a typed intent object.
 *
 * Supported intents:
 *   { type: "analyze", symbol: "TCS" }
 *   { type: "chat" }
 */
export function parseInput(text) {
  if (!text) return { type: "chat" };
  const clean = text.trim();
  const upper = clean.toUpperCase();
  // Ignore casual / acknowledgement messages
  const ignoreList = [
    "ok", "okay", "thanks", "thank you", "cool", "nice",
    "great", "hmm", "hmm.", "yes", "no", "alright", "my"
  ];
  if (ignoreList.includes(clean.toLowerCase())) {
    return { type: "chat" };
  }
  // /analyze TCS
  if (clean.toLowerCase().startsWith("/analyze")) {
    const symbol = clean.split(" ")[1];
    return symbol ? { type: "analyze", symbol: symbol.toUpperCase(), source: "command" } : { type: "invalid" };
  }
  // "Analyze TCS"
  if (clean.toLowerCase().startsWith("analyze ")) {
    const symbol = clean.split(" ")[1];
    return symbol ? { type: "analyze", symbol: symbol.toUpperCase(), source: "command" } : { type: "invalid" };
  }
  // Pure ticker (TCS, RELIANCE)
  if (/^[A-Z]{2,15}$/.test(upper) && upper.length >= 3) {
    return { type: "analyze", symbol: upper, source: "raw_ticker" };
  }
  // Everything else = chat
  return { type: "chat" };
}

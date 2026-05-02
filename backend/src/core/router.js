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
  // Ignore casual / acknowledgement messages
  const ignoreList = [
    "ok", "okay", "thanks", "thank you", "cool", "nice",
    "great", "hmm", "hmm.", "yes", "no", "alright"
  ];
  if (ignoreList.includes(clean.toLowerCase())) {
    return { type: "chat" };
  }
  // /analyze TCS
  if (clean.toLowerCase().startsWith("/analyze")) {
    const symbol = clean.split(" ")[1];
    return symbol ? { type: "analyze", symbol: symbol.toUpperCase() } : { type: "invalid" };
  }
  // "Analyze TCS"
  if (clean.toLowerCase().startsWith("analyze ")) {
    const symbol = clean.split(" ")[1];
    return symbol ? { type: "analyze", symbol: symbol.toUpperCase() } : { type: "invalid" };
  }
  // Pure ticker (TCS, RELIANCE)
  if (/^[A-Z]{2,15}$/.test(clean)) {
    return { type: "analyze", symbol: clean };
  }
  // Everything else = chat
  return { type: "chat" };
}

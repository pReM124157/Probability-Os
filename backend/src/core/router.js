/**
 * parseInput — Single source of truth for intent routing.
 * Converts raw Telegram message text into a typed intent object.
 *
 * Supported intents:
 *   { type: "analyze", symbol: "TCS" }
 *   { type: "chat" }
 */
export function parseInput(message) {
  if (!message) return { type: "chat" };

  const clean = message.trim();
  const upper = clean.toUpperCase();

  // /analyze TCS  or  /analyze
  if (/^\/analyze\b/i.test(clean)) {
    const symbol = clean.replace(/^\/analyze\s*/i, "").trim().toUpperCase();
    return { type: "analyze", symbol: symbol || null };
  }

  // "Analyze TCS"  or  "analyze tcs"
  if (/^analyze\s+/i.test(clean)) {
    const symbol = clean.replace(/^analyze\s+/i, "").trim().toUpperCase();
    return { type: "analyze", symbol: symbol || null };
  }

  // Pure ticker — 3–15 uppercase letters only
  if (/^[A-Z]{3,15}$/.test(upper)) {
    return { type: "analyze", symbol: upper };
  }

  return { type: "chat" };
}

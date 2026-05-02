import { isPro } from "./user.js";

/**
 * buildMessage — The ONLY place a footer is ever appended.
 *
 * PRO users:  returns text unchanged (no footer, ever)
 * FREE users: appends usage counter footer
 *
 * @param {string} text        - The response message body
 * @param {object|null} user   - User row from DB (or null)
 * @param {string} footer      - Footer string from processUsage (empty string for PRO)
 * @returns {string}
 */
export function buildMessage(text, user, footer) {
  if (isPro(user)) return text;           // PRO: never append footer
  if (!footer) return text;               // No footer computed: pass through
  return `${text}\n\n${footer}`;          // FREE: append usage footer
}

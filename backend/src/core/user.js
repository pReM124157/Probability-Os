/**
 * isPro — Single source of truth for PRO user detection.
 *
 * Checks both is_pro flag AND plan field (case-insensitive)
 * so it works regardless of whether DB stores "PRO" or "pro".
 *
 * Returns false if user is null/undefined (new user = FREE).
 */
export function isPro(user) {
  if (!user) return false;
  if (user.is_pro === true) return true;
  if (typeof user.plan === "string" && user.plan.toLowerCase() === "pro") return true;
  return false;
}

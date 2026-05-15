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

  const status = typeof user.status === "string"
    ? user.status.toLowerCase()
    : "";
  const expiry = user.expires_at || user.subscription_end || null;
  const hasEntitlementFlag =
    user.is_pro === true ||
    (typeof user.plan === "string" && user.plan.toLowerCase() === "pro");

  if (!hasEntitlementFlag) return false;
  if (status && !["active", "trialing", "grace"].includes(status)) return false;
  if (expiry && new Date(expiry) <= new Date()) return false;

  return true;
}

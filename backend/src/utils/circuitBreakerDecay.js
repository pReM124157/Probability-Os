/**
 * CIRCUIT BREAKER RECOVERY DECAY
 *
 * Prevents over-aggressive provider suppression by:
 * 1. Applying exponential DECAY to failure scores on each successful fetch
 * 2. Separating LIVE and HISTORICAL provider health scores
 * 3. Auto-resetting a provider to HEALTHY after enough consecutive successes
 *
 * Design:
 * - Each success: failureScore = max(0, failureScore - DECAY_FACTOR)
 * - DECAY_FACTOR is larger when recovery consecutive successes are recent
 * - Fully separate live/historical namespaces to prevent cross-poisoning
 */

const DECAY_FACTOR_BASE = 0.5;           // Baseline decay per success
const DECAY_FACTOR_STREAK = 1.0;         // Extra decay after 3+ consecutive successes
const CONSECUTIVE_RESET_THRESHOLD = 5;  // After N successes, full reset

// Separate live/historical failure score maps
const liveFailureScore = new Map();
const historicalFailureScore = new Map();
const consecutiveSuccessCount = new Map();

// ─── API ──────────────────────────────────────────────────────────────────────

/**
 * Record a provider success and apply decay to its failure score.
 * @param {string} provider  e.g. "yahoo", "twelvedata", "alpha_vantage"
 * @param {"live"|"historical"} scope
 */
export function recordCircuitSuccess(provider, scope = "live") {
  const scoreMap = scope === "historical" ? historicalFailureScore : liveFailureScore;
  const streakKey = `${provider}:${scope}`;
  const current = scoreMap.get(provider) || 0;
  const streak = (consecutiveSuccessCount.get(streakKey) || 0) + 1;
  consecutiveSuccessCount.set(streakKey, streak);

  // Full reset after enough consecutive successes
  if (streak >= CONSECUTIVE_RESET_THRESHOLD) {
    scoreMap.set(provider, 0);
    consecutiveSuccessCount.set(streakKey, 0);
    return { provider, scope, score: 0, action: "FULL_RESET", streak };
  }

  // Exponential decay — larger reduction when on a success streak
  const decayFactor = streak >= 3 ? DECAY_FACTOR_STREAK : DECAY_FACTOR_BASE;
  const newScore = Math.max(0, current - decayFactor);
  scoreMap.set(provider, newScore);

  return { provider, scope, score: newScore, action: "DECAY", streak, decayFactor };
}

/**
 * Record a provider failure and increment its failure score.
 * @param {string} provider
 * @param {"live"|"historical"} scope
 */
export function recordCircuitFailure(provider, scope = "live") {
  const scoreMap = scope === "historical" ? historicalFailureScore : liveFailureScore;
  const streakKey = `${provider}:${scope}`;
  const current = scoreMap.get(provider) || 0;
  const newScore = current + 1;
  scoreMap.set(provider, newScore);
  // Reset success streak on failure
  consecutiveSuccessCount.set(streakKey, 0);
  return { provider, scope, score: newScore, action: "INCREMENT" };
}

/**
 * Get current failure score for a provider+scope.
 */
export function getCircuitScore(provider, scope = "live") {
  const scoreMap = scope === "historical" ? historicalFailureScore : liveFailureScore;
  return scoreMap.get(provider) || 0;
}

/**
 * Determine whether a provider should be skipped based on its score.
 * Uses separate thresholds for live (more lenient) vs historical (stricter).
 */
export function shouldCircuitBreak(provider, scope = "live") {
  const score = getCircuitScore(provider, scope);
  const threshold = scope === "historical" ? 6 : 8;  // Historical trips faster
  return score >= threshold;
}

/**
 * Get health snapshot for all providers.
 */
export function getCircuitBreakerSnapshot() {
  const all = new Set([
    ...liveFailureScore.keys(),
    ...historicalFailureScore.keys()
  ]);

  const snapshot = {};
  for (const provider of all) {
    const liveScore = liveFailureScore.get(provider) || 0;
    const histScore = historicalFailureScore.get(provider) || 0;
    snapshot[provider] = {
      live: {
        failureScore: liveScore,
        status: liveScore >= 8 ? "TRIPPED" : liveScore >= 4 ? "DEGRADED" : "HEALTHY"
      },
      historical: {
        failureScore: histScore,
        status: histScore >= 6 ? "TRIPPED" : histScore >= 3 ? "DEGRADED" : "HEALTHY"
      }
    };
  }
  return snapshot;
}

/**
 * Force-reset a provider circuit breaker (used in tests or admin recovery).
 */
export function resetCircuitBreaker(provider, scope = "both") {
  if (scope === "live" || scope === "both") {
    liveFailureScore.set(provider, 0);
    consecutiveSuccessCount.set(`${provider}:live`, 0);
  }
  if (scope === "historical" || scope === "both") {
    historicalFailureScore.set(provider, 0);
    consecutiveSuccessCount.set(`${provider}:historical`, 0);
  }
}

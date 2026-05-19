import supabase, { isSupabaseSchemaMissing, logInfraFallbackOnce } from "./supabase.service.js";
import { logEvent } from "./telemetry.service.js";

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const DEFAULT_THRESHOLD      = 5;
const AUTH_FAIL_THRESHOLD    = 3;   // Auth failures trip cooldown faster
const DEFAULT_COOLDOWN_S     = 60;
const AUTH_COOLDOWN_S        = 300;  // 5 min on auth failures
const ESCALATED_COOLDOWN_S   = 900;  // 15 min on 5+ failures
const DEFAULT_SKIP_CODE      = "PROVIDER_COOLDOWN_ACTIVE";
const localProviderHealth    = new Map();
const providerStats = new Map();

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function isAuthError(error) {
  const msg = String(error?.message || "").toLowerCase();
  return (
    msg.includes("crumb") ||
    msg.includes("401") ||
    msg.includes("unauthorized") ||
    msg.includes("csrf") ||
    msg.includes("too many requests") ||
    msg.includes("403")
  );
}

function computeCooldownSeconds(failures, isAuth) {
  if (isAuth && failures >= AUTH_FAIL_THRESHOLD) return AUTH_COOLDOWN_S;
  if (failures >= DEFAULT_THRESHOLD)             return ESCALATED_COOLDOWN_S;
  if (failures >= 3)                             return DEFAULT_COOLDOWN_S;
  return 0; // No cooldown yet
}

// ─── CAN USE PROVIDER ─────────────────────────────────────────────────────────

export async function canUseProvider(provider) {
  try {
    const { data, error } = await supabase
      .from("provider_health")
      .select("cooldown_until")
      .eq("provider", provider)
      .maybeSingle();
    if (error) throw error;
    if (!data?.cooldown_until) return true;
    return new Date(data.cooldown_until) <= new Date();
  } catch (error) {
    if (!isSupabaseSchemaMissing(error)) throw error;
    logInfraFallbackOnce("provider_health_can_use", "[infra] provider_health table missing, using local fallback");
    const local = localProviderHealth.get(provider);
    if (!local?.cooldownUntil) return true;
    return new Date(local.cooldownUntil) <= new Date();
  }
}

// ─── RECORD SUCCESS ───────────────────────────────────────────────────────────

export async function recordProviderSuccess(provider) {
  try {
    const { error } = await supabase
      .from("provider_health")
      .upsert({
        provider,
        consecutive_failures: 0,
        cooldown_until: null,
        last_success_at: new Date().toISOString(),
        last_error: null,
        updated_at: new Date().toISOString()
      }, { onConflict: "provider" });
    if (error) throw error;
  } catch (error) {
    if (!isSupabaseSchemaMissing(error)) throw error;
    localProviderHealth.set(provider, {
      consecutiveFailures: 0,
      cooldownUntil: null,
      lastSuccessAt: new Date().toISOString(),
      lastError: null
    });
  }

  // Emit recovery event if provider was previously cooling down
  const local = localProviderHealth.get(provider);
  if (local?.cooldownUntil) {
    logEvent("provider.recovered", { provider });
    logEvent("provider.cooldown.expired", { provider });
  }

  logEvent("provider.success", { provider });
}

// ─── RECORD FAILURE ───────────────────────────────────────────────────────────

export async function recordProviderFailure(provider, errorMessage, threshold = DEFAULT_THRESHOLD, cooldownSeconds = DEFAULT_COOLDOWN_S) {
  let failures = 1;
  let shouldCooldown = false;
  let cooldownUntil = null;
  const isAuth = isAuthError({ message: errorMessage });

  if (isAuth) {
    logEvent("provider.auth_failure", { provider, errorMessage });
  }

  try {
    const { data, error } = await supabase
      .from("provider_health")
      .select("consecutive_failures")
      .eq("provider", provider)
      .maybeSingle();
    if (error) throw error;

    failures = Number(data?.consecutive_failures || 0) + 1;
    const derivedCooldown = computeCooldownSeconds(failures, isAuth);
    shouldCooldown = derivedCooldown > 0;
    cooldownUntil = shouldCooldown
      ? new Date(Date.now() + derivedCooldown * 1000).toISOString()
      : null;

    const { error: upsertError } = await supabase
      .from("provider_health")
      .upsert({
        provider,
        consecutive_failures: failures,
        cooldown_until: cooldownUntil,
        last_failure_at: new Date().toISOString(),
        last_error: errorMessage || null,
        updated_at: new Date().toISOString()
      }, { onConflict: "provider" });
    if (upsertError) throw upsertError;
  } catch (error) {
    if (!isSupabaseSchemaMissing(error)) throw error;
    const current = localProviderHealth.get(provider) || { consecutiveFailures: 0 };
    failures = Number(current.consecutiveFailures || 0) + 1;
    const derivedCooldown = computeCooldownSeconds(failures, isAuth);
    shouldCooldown = derivedCooldown > 0;
    cooldownUntil = shouldCooldown
      ? new Date(Date.now() + derivedCooldown * 1000).toISOString()
      : null;
    localProviderHealth.set(provider, {
      consecutiveFailures: failures,
      cooldownUntil,
      lastFailureAt: new Date().toISOString(),
      lastError: errorMessage || null
    });
  }

  logEvent("provider.failure", { provider, failures, shouldCooldown, cooldownUntil, isAuth, errorMessage: errorMessage || null });

  if (shouldCooldown) {
    logEvent("provider.cooldown.activated", { provider, failures, cooldownUntil, reason: isAuth ? "AUTH_FAILURE" : "CONSECUTIVE_FAILURES" });
  }
}

// ─── PROVIDER RECOVERY ────────────────────────────────────────────────────────

/**
 * recoverProviderHealth — checks if cooldown has expired and clears it.
 * Called opportunistically before each provider attempt.
 * Supports exponential cooldown decay: partial success reduces failure count.
 */
export async function recoverProviderHealth(provider) {
  try {
    const { data, error } = await supabase
      .from("provider_health")
      .select("cooldown_until, consecutive_failures")
      .eq("provider", provider)
      .maybeSingle();
    if (error) throw error;

    if (data?.cooldown_until && new Date(data.cooldown_until) <= new Date()) {
      // Cooldown has expired — reset to allow retry
      await supabase.from("provider_health").upsert({
        provider,
        cooldown_until: null,
        consecutive_failures: Math.max(0, Number(data.consecutive_failures || 0) - 1),
        updated_at: new Date().toISOString()
      }, { onConflict: "provider" });
      logEvent("provider.cooldown.expired", { provider });
      logEvent("provider.health.degraded", { provider, status: "RECOVERING" });
      return true; // Now usable
    }
  } catch (error) {
    if (!isSupabaseSchemaMissing(error)) return false;
    const local = localProviderHealth.get(provider);
    if (local?.cooldownUntil && new Date(local.cooldownUntil) <= new Date()) {
      localProviderHealth.set(provider, {
        ...local,
        cooldownUntil: null,
        consecutiveFailures: Math.max(0, Number(local.consecutiveFailures || 0) - 1)
      });
      logEvent("provider.cooldown.expired", { provider });
      return true;
    }
  }
  return false;
}

export function resetProviderHealthForTest(provider) {
  localProviderHealth.delete(provider);
  providerStats.delete(provider);
}

// ─── WITH PROVIDER GUARD ──────────────────────────────────────────────────────

export async function withProviderGuard(provider, operation, options = {}) {
  const skipWhenCoolingDown = options.skipWhenCoolingDown !== false;

  if (skipWhenCoolingDown) {
    // Try recovery first (expired cooldown)
    await recoverProviderHealth(provider);

    const available = await canUseProvider(provider);
    if (!available) {
      const cooldownError = new Error(`${provider} is cooling down`);
      cooldownError.code = DEFAULT_SKIP_CODE;
      throw cooldownError;
    }
  }

  const startedAt = Date.now();
  try {
    const started = Date.now();
    const result = await operation();
    const stats = providerStats.get(provider) || { success: 0, fail: 0, latencyMs: 0, bursts: 0, timeout: 0 };
    stats.success += 1;
    stats.latencyMs = Math.round((stats.latencyMs * 0.7) + ((Date.now() - started) * 0.3));
    stats.bursts = Math.max(0, stats.bursts - 1);
    providerStats.set(provider, stats);
    await recordProviderSuccess(provider);
    logEvent("provider.latency", { provider, durationMs: Date.now() - startedAt });
    return result;
  } catch (error) {
    const stats = providerStats.get(provider) || { success: 0, fail: 0, latencyMs: 0, bursts: 0, timeout: 0 };
    stats.fail += 1;
    stats.bursts += 1;
    if (String(error?.message || "").toLowerCase().includes("timeout")) stats.timeout += 1;
    providerStats.set(provider, stats);
    await recordProviderFailure(provider, error?.message || "Unknown provider error");
    throw error;
  }
}

// ─── AUTH FAILURE EXPORT ──────────────────────────────────────────────────────
export { isAuthError as isProviderAuthFailure };

export function trackProviderSuccessRate(provider) {
  const stats = providerStats.get(provider) || { success: 0, fail: 0 };
  const total = stats.success + stats.fail;
  return total > 0 ? Number((stats.success / total).toFixed(4)) : 1;
}

export function trackProviderLatency(provider) {
  const stats = providerStats.get(provider) || { latencyMs: 0 };
  return Number(stats.latencyMs || 0);
}

export function trackProviderFailureBursts(provider) {
  const stats = providerStats.get(provider) || { bursts: 0 };
  return Number(stats.bursts || 0);
}

export function calculateDynamicCooldown(provider) {
  const burst = trackProviderFailureBursts(provider);
  const latency = trackProviderLatency(provider);
  return Math.min(30 * 60, 60 + (burst * 45) + Math.floor(latency / 250));
}

export function calculateProviderReliability(provider) {
  const successRate = trackProviderSuccessRate(provider);
  const latencyScore = Math.max(0, 1 - (trackProviderLatency(provider) / 5000));
  const burstPenalty = Math.min(1, trackProviderFailureBursts(provider) / 10);
  const timeoutPenalty = Math.min(1, (providerStats.get(provider)?.timeout || 0) / 10);
  return Number(((successRate * 0.55) + (latencyScore * 0.25) + ((1 - burstPenalty) * 0.1) + ((1 - timeoutPenalty) * 0.1)).toFixed(4));
}

export function dynamicCooldownRecovery(provider) {
  const stats = providerStats.get(provider);
  if (!stats) return;
  stats.bursts = Math.max(0, stats.bursts - 1);
  providerStats.set(provider, stats);
}

export function partialProviderRecovery(provider) {
  const stats = providerStats.get(provider);
  if (!stats) return;
  stats.fail = Math.max(0, stats.fail - 1);
  providerStats.set(provider, stats);
}

export function cooldownDecay(provider) {
  dynamicCooldownRecovery(provider);
  partialProviderRecovery(provider);
}

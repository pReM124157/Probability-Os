import supabase from "./supabase.service.js";
import { logEvent } from "./telemetry.service.js";

const DEFAULT_THRESHOLD = 5;
const DEFAULT_COOLDOWN_SECONDS = 60;
const DEFAULT_SKIP_ERROR_CODE = "PROVIDER_COOLDOWN_ACTIVE";

export async function canUseProvider(provider) {
  const { data, error } = await supabase
    .from("provider_health")
    .select("cooldown_until")
    .eq("provider", provider)
    .maybeSingle();
  if (error) throw error;
  if (!data?.cooldown_until) return true;
  return new Date(data.cooldown_until) <= new Date();
}

export async function recordProviderSuccess(provider) {
  const { error } = await supabase
    .from("provider_health")
    .upsert({
      provider,
      consecutive_failures: 0,
      cooldown_until: null,
      last_success_at: new Date().toISOString(),
      last_error: null,
      updated_at: new Date().toISOString()
    }, {
      onConflict: "provider"
    });
  if (error) throw error;
  logEvent("provider.success", { provider });
}

export async function recordProviderFailure(provider, errorMessage, threshold = DEFAULT_THRESHOLD, cooldownSeconds = DEFAULT_COOLDOWN_SECONDS) {
  const { data, error } = await supabase
    .from("provider_health")
    .select("consecutive_failures")
    .eq("provider", provider)
    .maybeSingle();
  if (error) throw error;

  const failures = Number(data?.consecutive_failures || 0) + 1;
  const shouldCooldown = failures >= threshold;
  const cooldownUntil = shouldCooldown
    ? new Date(Date.now() + cooldownSeconds * 1000).toISOString()
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
    }, {
      onConflict: "provider"
    });
  if (upsertError) throw upsertError;
  logEvent("provider.failure", {
    provider,
    failures,
    shouldCooldown,
    cooldownUntil,
    errorMessage: errorMessage || null
  });
}

export async function withProviderGuard(provider, operation, options = {}) {
  const threshold = options.threshold || DEFAULT_THRESHOLD;
  const cooldownSeconds = options.cooldownSeconds || DEFAULT_COOLDOWN_SECONDS;
  const skipWhenCoolingDown = options.skipWhenCoolingDown !== false;

  if (skipWhenCoolingDown) {
    const available = await canUseProvider(provider);
    if (!available) {
      const cooldownError = new Error(`${provider} is cooling down`);
      cooldownError.code = DEFAULT_SKIP_ERROR_CODE;
      throw cooldownError;
    }
  }

  const startedAt = Date.now();
  try {
    const result = await operation();
    await recordProviderSuccess(provider);
    logEvent("provider.latency", {
      provider,
      durationMs: Date.now() - startedAt
    });
    return result;
  } catch (error) {
    await recordProviderFailure(provider, error?.message || "Unknown provider error", threshold, cooldownSeconds);
    throw error;
  }
}

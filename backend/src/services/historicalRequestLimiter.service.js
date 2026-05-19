import { logEvent } from "./telemetry.service.js";

const PROVIDER_LIMITS = {
  yahoo: 2,
  twelvedata: 2,
  alpha_vantage: 1
};

const activeByProvider = new Map(Object.keys(PROVIDER_LIMITS).map((k) => [k, 0]));
const waitQueues = new Map(Object.keys(PROVIDER_LIMITS).map((k) => [k, []]));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function calculateHistoricalLoad() {
  const providers = {};
  for (const provider of Object.keys(PROVIDER_LIMITS)) {
    providers[provider] = {
      active: activeByProvider.get(provider) || 0,
      limit: PROVIDER_LIMITS[provider],
      queued: (waitQueues.get(provider) || []).length
    };
  }
  return providers;
}

export function detectProviderSaturation(provider) {
  const limit = PROVIDER_LIMITS[provider] || 1;
  const active = activeByProvider.get(provider) || 0;
  return active >= limit;
}

export async function acquireHistoricalProviderSlot(provider) {
  const normalized = PROVIDER_LIMITS[provider] ? provider : "yahoo";
  const limit = PROVIDER_LIMITS[normalized] || 1;
  const active = activeByProvider.get(normalized) || 0;

  if (active < limit) {
    activeByProvider.set(normalized, active + 1);
    return;
  }

  await new Promise((resolve) => {
    const queue = waitQueues.get(normalized) || [];
    queue.push(resolve);
    waitQueues.set(normalized, queue);
  });

  const nextActive = activeByProvider.get(normalized) || 0;
  activeByProvider.set(normalized, nextActive + 1);
}

export function releaseHistoricalProviderSlot(provider) {
  const normalized = PROVIDER_LIMITS[provider] ? provider : "yahoo";
  const active = Math.max(0, (activeByProvider.get(normalized) || 0) - 1);
  activeByProvider.set(normalized, active);

  const queue = waitQueues.get(normalized) || [];
  const wake = queue.shift();
  waitQueues.set(normalized, queue);
  if (wake) wake();
}

export async function queueHistoricalRequest(provider, requestFn) {
  const normalized = PROVIDER_LIMITS[provider] ? provider : "yahoo";
  await acquireHistoricalProviderSlot(normalized);
  try {
    return await requestFn();
  } finally {
    releaseHistoricalProviderSlot(normalized);
  }
}

export function calculateProviderCooldown(baseMs = 400, failureCount = 0) {
  const bounded = Math.max(0, Math.min(6, Number(failureCount || 0)));
  return baseMs * (2 ** bounded);
}

export function applyExponentialBackoff(baseMs = 400, failureCount = 0) {
  return calculateProviderCooldown(baseMs, failureCount);
}

export async function delayHistoricalRetry(ms) {
  await sleep(Math.max(0, Number(ms || 0)));
}

export function detectRepeatedProviderFailures(failures = []) {
  if (!Array.isArray(failures) || failures.length < 3) return false;
  const recent = failures.slice(-3);
  return recent.every(Boolean);
}

export function detectProviderExhaustion(providerState = {}) {
  return Number(providerState?.failureScore || 0) >= 6;
}

export function calculateProviderHealth(providerState = {}) {
  const successRate = Number(providerState.successRate || 0.5);
  const latencyPenalty = Math.min(1, Number(providerState.avgLatencyMs || 0) / 5000);
  const failurePenalty = Math.min(1, Number(providerState.failureScore || 0) / 10);
  return Number((successRate * 0.6 + (1 - latencyPenalty) * 0.2 + (1 - failurePenalty) * 0.2).toFixed(4));
}

export function shouldSkipProvider(providerState = {}) {
  const exhausted = detectProviderExhaustion(providerState);
  const health = calculateProviderHealth(providerState);
  return exhausted || health < 0.25;
}

export function logHistoricalLimiterTelemetry() {
  logEvent("historical.limiter.load", { load: calculateHistoricalLoad() });
}

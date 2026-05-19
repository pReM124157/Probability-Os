import { calculateProviderReliability, trackProviderFailureBursts, trackProviderLatency, trackProviderSuccessRate } from "./providerHealth.service.js";

let lastExecutionAt = null;
let schedulerStatus = "INITIALIZING";

export function markPortfolioDefenseExecution() {
  lastExecutionAt = new Date().toISOString();
  schedulerStatus = "RUNNING";
}

export function getPortfolioDefenseHealth() {
  const providers = ["yahoo", "twelvedata", "alpha_vantage"];
  return {
    schedulerStatus,
    lastExecutionAt,
    providerHealth: Object.fromEntries(providers.map((provider) => [provider, {
      reliability: calculateProviderReliability(provider),
      successRate: trackProviderSuccessRate(provider),
      latencyMs: trackProviderLatency(provider),
      failureBursts: trackProviderFailureBursts(provider)
    }])),
    queueHealth: {
      redisConfigured: Boolean(process.env.REDIS_URL)
    },
    dbWriteHealth: "UNKNOWN",
    alertGenerationStatus: "UNKNOWN"
  };
}

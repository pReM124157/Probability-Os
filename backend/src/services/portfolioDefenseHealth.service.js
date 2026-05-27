import { calculateProviderReliability, trackProviderFailureBursts, trackProviderLatency, trackProviderSuccessRate } from "./providerHealth.service.js";

let lastExecutionAt = null;
let schedulerStatus = "INITIALIZING";
let lastStressTestAt = null;
let lastCorrelationScanAt = null;

export function markPortfolioDefenseExecution() {
  lastExecutionAt = new Date().toISOString();
  schedulerStatus = "RUNNING";
}

export function markStressTestExecution() {
  lastStressTestAt = new Date().toISOString();
}

export function markCorrelationScanExecution() {
  lastCorrelationScanAt = new Date().toISOString();
}

export function getPortfolioDefenseHealth() {
  const providers = ["yahoo", "twelvedata", "alpha_vantage"];
  return {
    schedulerStatus,
    lastExecutionAt,
    lastStressTestAt,
    lastCorrelationScanAt,
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

import { logEvent, logMetric } from "./telemetry.service.js";

export function trackDefenseCycleRuntime(runtimeMs) { logMetric("portfolio.defense.runtime_ms", Number(runtimeMs || 0), {}); }
export function trackSchedulerExecution(name, details = {}) { logEvent("portfolio.scheduler.execution", { name, ...details }); }
export function trackHistoricalFetchPressure(load = {}) { logEvent("portfolio.historical.fetch_pressure", { load }); }
export function trackProviderExhaustion(provider, details = {}) { logEvent("portfolio.provider.exhaustion", { provider, ...details }); }
export function trackQueueBacklog(queueName, backlog) { logMetric("portfolio.queue.backlog", Number(backlog || 0), { queueName }); }
export function trackPortfolioDefenseSuccess(details = {}) { logEvent("portfolio.defense.success", details); }

export function trackMonteCarloRuntime(runtimeMs, details = {}) { logMetric("portfolio.montecarlo.runtime_ms", Number(runtimeMs || 0), details); }
export function trackStressTestLatency(runtimeMs, details = {}) { logMetric("portfolio.stress.runtime_ms", Number(runtimeMs || 0), details); }
export function trackOptimizationRuntime(runtimeMs, details = {}) { logMetric("portfolio.optimization.runtime_ms", Number(runtimeMs || 0), details); }
export function trackCovarianceGenerationTime(runtimeMs, details = {}) { logMetric("portfolio.covariance.runtime_ms", Number(runtimeMs || 0), details); }
export function trackWorkerHealth(details = {}) { logEvent("portfolio.worker.health", details); }
export function trackQueueCongestion(details = {}) { logEvent("portfolio.queue.congestion", details); }
export function trackProviderPressure(details = {}) { logEvent("portfolio.provider.pressure", details); }
export function trackQuantComputationLoad(details = {}) { logEvent("portfolio.quant.load", details); }

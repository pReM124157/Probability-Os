import { enqueueJob, startQueueWorker } from "./_base.queue.js";
import { runMonteCarloSimulation } from "../services/probabilisticForecast.service.js";

export const MONTE_CARLO_QUEUE = "monte-carlo-quant";

export function enqueueMonteCarloJob(payload = {}, options = {}) {
  return enqueueJob(MONTE_CARLO_QUEUE, payload, options);
}

export function startMonteCarloWorker() {
  return startQueueWorker(MONTE_CARLO_QUEUE, async (data) => runMonteCarloSimulation(data), { concurrency: 2 });
}

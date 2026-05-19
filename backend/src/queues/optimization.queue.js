import { enqueueJob, startQueueWorker } from "./_base.queue.js";
import { calculateOptimalAllocation } from "../services/portfolioOptimization.service.js";

export const OPTIMIZATION_QUEUE = "optimization-quant";

export function enqueueOptimizationJob(payload = {}, options = {}) {
  return enqueueJob(OPTIMIZATION_QUEUE, payload, options);
}

export function startOptimizationWorker() {
  return startQueueWorker(OPTIMIZATION_QUEUE, async (data) => calculateOptimalAllocation(data.positions || [], data.options || {}), { concurrency: 2 });
}

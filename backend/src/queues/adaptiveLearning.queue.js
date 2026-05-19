import { enqueueJob, startQueueWorker } from "./_base.queue.js";
import { recalibrateStrategyState } from "../services/adaptiveLearning.service.js";

export const ADAPTIVE_LEARNING_QUEUE = "adaptive-learning-quant";

export function enqueueAdaptiveLearningJob(payload = {}, options = {}) {
  return enqueueJob(ADAPTIVE_LEARNING_QUEUE, payload, options);
}

export function startAdaptiveLearningWorker() {
  return startQueueWorker(ADAPTIVE_LEARNING_QUEUE, async (data) => recalibrateStrategyState(data), { concurrency: 2 });
}

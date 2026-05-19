import { enqueueJob, startQueueWorker } from "./_base.queue.js";
import { generateCorrelationIntel } from "../services/quantCorrelation.service.js";

export const CORRELATION_QUEUE = "correlation-quant";

export function enqueueCorrelationJob(payload = {}, options = {}) {
  return enqueueJob(CORRELATION_QUEUE, payload, options);
}

export function startCorrelationWorker() {
  return startQueueWorker(CORRELATION_QUEUE, async (data) => generateCorrelationIntel(data), { concurrency: 2 });
}

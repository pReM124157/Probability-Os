import { enqueueJob, startQueueWorker } from "./_base.queue.js";
import { generateStressScenarioReport } from "../services/stressTesting.service.js";

export const STRESS_TESTING_QUEUE = "stress-testing-quant";

export function enqueueStressTestingJob(payload = {}, options = {}) {
  return enqueueJob(STRESS_TESTING_QUEUE, payload, options);
}

export function startStressTestingWorker() {
  return startQueueWorker(STRESS_TESTING_QUEUE, async (data) => generateStressScenarioReport(data.holdings || []), { concurrency: 2 });
}

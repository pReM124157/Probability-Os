import { startMonteCarloWorker } from "../queues/monteCarlo.queue.js";
import { startStressTestingWorker } from "../queues/stressTesting.queue.js";
import { startCorrelationWorker } from "../queues/correlation.queue.js";
import { startOptimizationWorker } from "../queues/optimization.queue.js";
import { startAdaptiveLearningWorker } from "../queues/adaptiveLearning.queue.js";
import { startPortfolioDefenseWorker } from "../queues/portfolioDefense.queue.js";

export function startInstitutionalWorkers() {
  startMonteCarloWorker();
  startStressTestingWorker();
  startCorrelationWorker();
  startOptimizationWorker();
  startAdaptiveLearningWorker();
  startPortfolioDefenseWorker();
}

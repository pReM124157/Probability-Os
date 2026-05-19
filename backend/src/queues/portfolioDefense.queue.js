import { enqueueJob, startQueueWorker } from "./_base.queue.js";
import { runPortfolioDefenseCycle } from "../agents/portfolioDefense.agent.js";

export const PORTFOLIO_DEFENSE_QUEUE = "portfolio-defense-quant";

export function enqueuePortfolioDefenseJob(payload = {}, options = {}) {
  return enqueueJob(PORTFOLIO_DEFENSE_QUEUE, payload, options);
}

export function startPortfolioDefenseWorker() {
  return startQueueWorker(PORTFOLIO_DEFENSE_QUEUE, async () => runPortfolioDefenseCycle(), { concurrency: 1 });
}

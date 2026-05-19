import { startQuantWorkers } from "../services/quantWorkerQueue.service.js";
import { runPortfolioDefenseCycle } from "../agents/portfolioDefense.agent.js";

startQuantWorkers({
  portfolio_defense_cycle: async () => runPortfolioDefenseCycle()
});

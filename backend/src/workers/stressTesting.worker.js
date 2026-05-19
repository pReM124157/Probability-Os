import { startQuantWorkers } from "../services/quantWorkerQueue.service.js";
import { generateStressScenarioReport } from "../services/stressTesting.service.js";

startQuantWorkers({
  stress_testing: async (data) => generateStressScenarioReport(data.holdings || [])
});

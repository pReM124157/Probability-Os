import { startQuantWorkers } from "../services/quantWorkerQueue.service.js";
import { getHistoricalCandles } from "../services/marketData.service.js";

startQuantWorkers({
  historical_fetch: async (data) => {
    return getHistoricalCandles(data.symbol, data.options || {});
  }
});

import app from "./app.js";
import { startMonitoringJob } from "./scheduler/monitor.job.js";
import { startPortfolioScheduler } from "./scheduler/portfolio.scheduler.js";
import { startBot } from "./services/telegram.service.js";

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  startBot();
  startPortfolioScheduler();
  startMonitoringJob();
});
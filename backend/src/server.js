import app from "./app.js";
import { startMonitoringJob } from "./scheduler/monitor.job.js";
import { startPortfolioScheduler } from "./scheduler/portfolio.scheduler.js";

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  startPortfolioScheduler();
  startMonitoringJob();
});
import app from "./app.js";
import { startMonitoringJob } from "./scheduler/monitor.job.js";
import { startPortfolioScheduler } from "./scheduler/portfolio.scheduler.js";
import { startBot } from "./services/telegram.service.js";

const PORT = process.env.PORT || 5000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
  
  // DEFERRED STARTUP: Ensure health check passes before heavy jobs start
  setTimeout(() => {
    console.log("Initializing background services...");
    startBot();
    startPortfolioScheduler();
    startMonitoringJob();
  }, 2000);
});
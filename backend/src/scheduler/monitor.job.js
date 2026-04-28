import cron from "node-cron";
import supabase from "../services/supabase.service.js";

import { runRiskAgent } from "../agents/risk.agent.js";
import { analyzePortfolio as runPortfolioAgent } from "../agents/portfolioAgent.js";
import { runRebalancingAgent } from "../agents/rebalancing.agent.js";
import { scannerAgent } from "../agents/scanner.agent.js";

import { sendTelegramAlert } from "../services/alert.service.js";

export const startMonitoringJob = () => {
  console.log("🚀 Monitoring Job Started");

  /*
    Runs every hour
    Cron Format:
    ┌──────── minute (0 - 59)
    │ ┌────── hour (0 - 23)
    │ │ ┌──── day of month (1 - 31)
    │ │ │ ┌── month (1 - 12)
    │ │ │ │ ┌ day of week (0 - 7)
    │ │ │ │ │
    │ │ │ │ │
    0 * * * *
  */

  cron.schedule("30 8 * * *", async () => {
    try {
      console.log("⏰ Morning Scanner Alert Triggered");
      const opportunities = await scannerAgent();
      if (!opportunities.length) {
        console.log("No opportunities found");
        return;
      }
      let message = "🏆 TOP OPPORTUNITIES TODAY\n\n";
      opportunities.slice(0, 3).forEach((stock, index) => {
        message += `#${index + 1} ${stock.stock}\n`;
        message += `🎯 Confidence: ${stock.confidenceScore}/10\n`;
        message += `🏆 Priority: ${stock.priorityLevel}\n`;
        message += `💰 Allocation: ${stock.allocation}\n`;
        message += `⚡ Entry: ${stock.entrySignal}\n`;
        message += `📊 Urgency: ${stock.entryUrgency}\n\n`;
      });
      message += "⚠️ For educational purposes only.\n";
      message += "Not SEBI registered investment advice.";
      
      await sendTelegramAlert(message);
      console.log("✅ Morning scanner alert sent");
    } catch (error) {
      console.log("Monitor Job Error:", error.message);
    }
  });
};
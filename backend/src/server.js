import express from "express";
import { initializePortfolioDefenseAgent } from "./agents/portfolioDefense.agent.js";
import { initializeInfrastructure } from "./services/infrastructure.service.js";
import { staggerSchedulerExecution } from "./services/schedulerStagger.service.js";
import { startInstitutionalWorkers } from "./workers/index.js";
import { warmupYahooSession } from "./services/marketData.service.js";

const PORT = process.env.PORT || 5000;
const RENDER_DEMO_MODE = String(process.env.RENDER_DEMO_MODE || "")
  .trim()
  .toLowerCase() === "true";

console.log("[BOOT CONFIG]", {
  nodeEnv: process.env.NODE_ENV || null,
  renderDemoMode: RENDER_DEMO_MODE,
  rawRenderDemoMode: process.env.RENDER_DEMO_MODE || null
});
const app = express();
let backgroundServicesInitialized = false;

async function startSchedulerSafely(name, starter) {
  try {
    await starter();
    console.log(`✅ Scheduler started: ${name}`);
  } catch (error) {
    console.error(`❌ Scheduler failed to start: ${name}`, error);
  }
}

// 1. START SERVER IMMEDIATELY FOR HEALTH CHECK
app.get("/", (req, res) => {
  res.status(200).send("OK");
});


// Health check aliases for local/dev/deployment probes
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    service: "finsight-backend",
    timestamp: new Date().toISOString()
  });
});

app.get("/healthz", (req, res) => {
  res.status(200).send("OK");
});

app.get("/api/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    service: "finsight-backend",
    timestamp: new Date().toISOString()
  });
});


app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server listening on 0.0.0.0:${PORT}`);
  console.log("✅ Health check path / is now responsive.");

  warmupYahooSession()
    .then(() => {
      console.log("[BOOT] Yahoo session warmup completed");
    })
    .catch((error) => {
      console.error("[BOOT] Yahoo session warmup failed:", error?.message || error);
    });
});

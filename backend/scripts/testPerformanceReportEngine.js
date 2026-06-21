import dotenv from "dotenv";
dotenv.config();

import { buildKalshiPerformanceReport } from "../src/kalshi/backtest/performanceReportEngine.js";

async function main() {
  console.log("=== Probability OS Performance Report Test ===");

  const report = buildKalshiPerformanceReport({
    limit: 10000,
  });

  console.log("\n[SUMMARY]");
  console.log(JSON.stringify(report.summary, null, 2));

  console.log("\n[PROBABILITY BUCKETS]");
  console.log(JSON.stringify(report.probabilityBuckets, null, 2));

  console.log("\n[OUTSIDE TRACKED BUCKETS]");
  console.log(JSON.stringify(report.outsideTrackedBuckets, null, 2));

  console.log("\n[FULL REPORT]");
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

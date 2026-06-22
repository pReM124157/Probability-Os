import {
  getPaperSettlementSchedulerStatus,
  runPaperSettlementOnce,
} from "../src/kalshi/scheduler/paperSettlementScheduler.js";
import { getPaperTradingStats } from "../src/kalshi/execution/paperTradingEngine.js";

async function main() {
  console.log("=== Paper Settlement Scheduler Test ===");

  console.log("\n[BEFORE STATUS]");
  console.log(JSON.stringify(getPaperSettlementSchedulerStatus(), null, 2));

  const result = await runPaperSettlementOnce();
  console.log("\n[RUN RESULT]");
  console.log(JSON.stringify(result, null, 2));

  console.log("\n[AFTER STATUS]");
  console.log(JSON.stringify(getPaperSettlementSchedulerStatus(), null, 2));

  console.log("\n[PAPER STATS]");
  console.log(JSON.stringify(getPaperTradingStats(), null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

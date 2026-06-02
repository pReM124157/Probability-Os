import { masterAgent } from "./agents/master.agent.js";
import dotenv from "dotenv";
dotenv.config();

const test = async () => {
  try {
    const symbol = process.argv[2] || "TCS";
    console.log(`[TEST RUN] Running masterAgent for symbol: ${symbol}`);
    const result = await masterAgent(symbol);
    console.log("RESULT:", JSON.stringify(result, null, 2));
  } catch (err) {
    console.error("TEST FAILED:", err);
  }
};

test();


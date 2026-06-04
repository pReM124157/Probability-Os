import dotenv from "dotenv";

dotenv.config();

import { runPriceAlertScan } from "./scheduler/priceAlert.scheduler.js";

const result = await runPriceAlertScan({ traceId: "manual:test_price_alert_scan" });
console.log("PRICE ALERT SCAN RESULT:", result);

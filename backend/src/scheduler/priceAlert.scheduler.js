import cron from "node-cron";
import bot from "../services/telegram.service.js";
import { getLiveMarketData } from "../services/marketData.service.js";
import {
  getActivePriceAlerts,
  isPriceAlertTriggered,
  markPriceAlertTriggered
} from "../services/priceAlert.service.js";
import { runWithSchedulerLease } from "../services/schedulerLease.service.js";
import { preventSchedulerOverlap } from "../services/schedulerStagger.service.js";
import { logEvent, logError } from "../services/telemetry.service.js";

let priceAlertSchedulerStarted = false;

function formatAlertMessage({ alert, currentPrice, source }) {
  const direction = alert.condition === "below" ? "fell below" : "crossed above";

  return (
    `🚨 *Price Alert Triggered*\n\n` +
    `*${alert.symbol}* ${direction} *₹${alert.target_price}*\n` +
    `Current price: *₹${currentPrice}*\n` +
    `Source: *${source || "UNKNOWN"}*`
  );
}

export async function runPriceAlertScan({ traceId = "manual:price_alert_scan" } = {}) {
  const alerts = await getActivePriceAlerts(100);

  let checked = 0;
  let triggered = 0;
  let failed = 0;

  for (const alert of alerts) {
    checked += 1;

    try {
      const liveData = await getLiveMarketData(alert.symbol);
      const currentPrice = Number(
        liveData?.currentPrice ||
        liveData?.price ||
        liveData?.regularMarketPrice ||
        0
      );

      const source = liveData?.priceSource || liveData?.source || "UNKNOWN";

      if (!isPriceAlertTriggered(alert, currentPrice)) continue;

      const updated = await markPriceAlertTriggered(alert.id, currentPrice, source);

      await bot.telegram.sendMessage(
        alert.chat_id,
        formatAlertMessage({ alert: updated, currentPrice, source }),
        { parse_mode: "Markdown" }
      );

      triggered += 1;

      logEvent("price_alert.triggered", {
        traceId,
        alertId: alert.id,
        chatId: alert.chat_id,
        symbol: alert.symbol,
        condition: alert.condition,
        targetPrice: alert.target_price,
        currentPrice,
        source
      });
    } catch (error) {
      failed += 1;
      logError("price_alert.scan_item_failed", error, {
        traceId,
        alertId: alert?.id,
        symbol: alert?.symbol
      });
    }
  }

  logEvent("price_alert.scan.completed", {
    traceId,
    checked,
    triggered,
    failed
  });

  return { checked, triggered, failed };
}

export function startPriceAlertScheduler() {
  if (priceAlertSchedulerStarted) {
    console.log("🚨 Price Alert Scheduler already started — skipping duplicate registration");
    return;
  }

  priceAlertSchedulerStarted = true;
  console.log("🚨 Price Alert Scheduler Started");

  cron.schedule("* * * * *", async () => {
    if (!preventSchedulerOverlap("price_alert_scan", 55 * 1000)) return;

    await runWithSchedulerLease("scheduler:price_alert_scan", async ({ traceId }) => {
      await runPriceAlertScan({ traceId });
    }).catch((error) => logError("price_alert.scheduler.error", error));
  }, {
    timezone: "Asia/Kolkata"
  });
}

import cron from "node-cron";
import supabase from "../services/supabase.service.js";
import { Telegraf } from "telegraf";
import { runWithSchedulerLease } from "../services/schedulerLease.service.js";
import { logError, logEvent } from "../services/telemetry.service.js";

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
let spikeHookSchedulerStarted = false;

export function startSpikeHook() {
  if (spikeHookSchedulerStarted) {
    console.log("⏰ Random Spike Hook Scheduler already started — skipping duplicate registration");
    return;
  }
  spikeHookSchedulerStarted = true;
  console.log("⏰ Random Spike Hook Scheduler Started");

  // Run at 14:00 IST (which is 08:30 UTC) every day, targeting the afternoon session
  cron.schedule("30 8 * * *", async () => {
    await runWithSchedulerLease("scheduler:random_spike_hook", async ({ traceId, assertLease }) => {
      // Only send this on random days (about 30% chance) to make it unpredictable
      if (Math.random() > 0.3) {
        logEvent("scheduler.random_spike_hook.skipped", { traceId, reason: "random_gate" });
        return;
      }

      const { data: users, error } = await supabase
        .from("subscribers")
        .select("telegram_chat_id");

      if (error) throw error;
      if (!users) return;

      const message = `
⚠️ Quick signal:
A setup is forming in banking stocks.
This doesn't stay clean for long.
Want a quick look?
`.trim();

      // Send to a random subset of users (50%) to keep it exclusive
      const selectedUsers = users.filter(() => Math.random() > 0.5);
      logEvent("scheduler.random_spike_hook.recipients", {
        traceId,
        count: selectedUsers.length
      });

      for (const user of selectedUsers) {
        assertLease();
        if (user.telegram_chat_id) {
          try {
            await bot.telegram.sendMessage(user.telegram_chat_id, message);
          } catch (err) {
            logError("scheduler.random_spike_hook.delivery_error", err, {
              traceId,
              chatId: user.telegram_chat_id
            });
          }
        }
      }
      logEvent("scheduler.random_spike_hook.completed", { traceId });
    }, {
      ttlSeconds: 20 * 60
    }).catch((err) => {
      logError("scheduler.random_spike_hook.error", err);
    });
  }, {
    timezone: "Asia/Kolkata"
  });
}

import cron from "node-cron";
import supabase from "../services/supabase.service.js";
import { Telegraf } from "telegraf";
import { isPro } from "../core/user.js";
import { runMorningBriefing } from "../scanner/morningScheduler.js";
import { runWithSchedulerLease } from "../services/schedulerLease.service.js";
import { logError, logEvent } from "../services/telemetry.service.js";

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

function isMorningBriefingEligible(user) {
  if (!user?.telegram_chat_id) return false;
  if (!isPro(user)) return false;

  const status = String(user.status || "").toLowerCase();
  if (status && !["active", "trialing"].includes(status)) {
    return false;
  }

  const expiry = user.expires_at || user.subscription_end;
  if (expiry && new Date(expiry) < new Date()) {
    return false;
  }

  return true;
}

function buildTelegramMorningMessage(packet) {
  const reportText = packet?.report?.report || "Morning briefing unavailable.";
  return [
    "FinSight Pro Morning Briefing",
    "",
    reportText,
    "",
    "Educational only. Not SEBI-registered investment advice."
  ].join("\n");
}

export function startDailyHook() {
  console.log("⏰ Morning Briefing Scheduler Started");

  // Run at 7:30 AM IST (02:00 UTC) every trading day
  cron.schedule("0 2 * * *", async () => {
    await runWithSchedulerLease("scheduler:daily_morning_briefing", async ({ traceId, assertLease }) => {
      logEvent("scheduler.daily_morning_briefing.started", { traceId });
      const packet = await runMorningBriefing();
      const message = buildTelegramMorningMessage(packet);

      const { data: users, error } = await supabase
        .from("subscribers")
        .select("telegram_chat_id, is_pro, plan, status, expires_at, subscription_end");

      if (error) throw error;
      if (!users) return;

      const recipients = users.filter(isMorningBriefingEligible);
      logEvent("scheduler.daily_morning_briefing.recipients", {
        traceId,
        count: recipients.length
      });

      for (const user of recipients) {
        assertLease();
        try {
          await bot.telegram.sendMessage(user.telegram_chat_id, message);
        } catch (err) {
          logError("scheduler.daily_morning_briefing.delivery_error", err, {
            traceId,
            chatId: user.telegram_chat_id
          });
        }
      }
      logEvent("scheduler.daily_morning_briefing.completed", { traceId });
    }, {
      ttlSeconds: 30 * 60
    }).catch((err) => {
      logError("scheduler.daily_morning_briefing.error", err);
    });
  }, {
    timezone: "UTC"
  });
}

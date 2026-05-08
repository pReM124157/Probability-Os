import cron from "node-cron";
import supabase from "../services/supabase.service.js";
import { Telegraf } from "telegraf";
import { isPro } from "../core/user.js";
import { runMorningBriefing } from "../scanner/morningScheduler.js";

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
    console.log("Running scheduled morning briefing...");
    try {
      const packet = await runMorningBriefing();
      const message = buildTelegramMorningMessage(packet);

      const { data: users, error } = await supabase
        .from("subscribers")
        .select("telegram_chat_id, is_pro, plan, status, expires_at, subscription_end");

      if (error) throw error;
      if (!users) return;

      const recipients = users.filter(isMorningBriefingEligible);
      console.log(`Morning briefing recipients: ${recipients.length}`);

      for (const user of recipients) {
        try {
          await bot.telegram.sendMessage(user.telegram_chat_id, message);
        } catch (err) {
          console.error("Failed to send morning briefing to:", user.telegram_chat_id);
        }
      }
    } catch (err) {
      console.error("Morning Briefing Error:", err.message);
    }
  }, {
    timezone: "UTC"
  });
}

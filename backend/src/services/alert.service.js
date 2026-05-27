import TelegramBot from "node-telegram-bot-api";
import supabase from "./supabase.service.js";

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, {
  polling: false,
});

export const sendTelegramAlert = async (message) => {
  try {
    console.log("=== STARTING TELEGRAM DELIVERY ===");
    console.log("=== FETCHING SUBSCRIBERS ===");
    const { data: subscribers, error: subscribersError } = await supabase
      .from("subscribers")
      .select("telegram_chat_id,status")
      .eq("status", "active");
    if (subscribersError) {
      console.error("[SUBSCRIBER FETCH ERROR]", subscribersError.message);
    }
    console.log("=== SUBSCRIBERS FETCHED ===");
    const activeSubscribers = (subscribers || [])
      .map((sub) => String(sub?.telegram_chat_id || "").trim())
      .filter((chatId, index, arr) => /^-?\d+$/.test(chatId) && arr.indexOf(chatId) === index);
    console.log("Subscribers found:", activeSubscribers.length);
    console.log("=== ACTIVE SUBSCRIBERS ===");
    console.log(activeSubscribers.length);

    if (activeSubscribers.length === 0) {
      console.log("No active subscribers available for Telegram alert delivery.");
      return;
    }

    console.log("=== SENDING TELEGRAM SIGNAL ===");
    for (const chatId of activeSubscribers) {
      console.log("=== SENDING TO SUBSCRIBER ===");
      console.log(chatId);
      console.log("TELEGRAM_SEND_START", new Date().toISOString());
      const response = await bot.sendMessage(chatId, message, {
        parse_mode: "Markdown",
      });
      console.log("TELEGRAM_SEND_SUCCESS", new Date().toISOString());
      console.log("=== TELEGRAM DELIVERY SUCCESS ===");
      console.log("=== TELEGRAM SIGNAL SENT ===");
      console.log("✅ Alert sent to Telegram", {
        chatId,
        messageId: response?.message_id || null
      });
    }
  } catch (error) {
    console.error("=== TELEGRAM DELIVERY FAILED ===");
    console.error(error.message);
    console.error("=== TELEGRAM ERROR ===");
    console.error(error?.response?.description || error.message);
    console.error("Telegram alert error:", error.message);
  }
};
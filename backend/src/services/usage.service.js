import supabase from './supabase.service.js';
import { formatIST } from "../utils/time.js";

const LIMIT = 10;
const WINDOW = 24 * 60 * 60 * 1000;

export async function getUsageUser(chatId) {
  const { data } = await supabase
    .from("subscribers")
    .select("plan, free_usage_count, usage_started_at")
    .eq("telegram_chat_id", chatId.toString())
    .maybeSingle();
  return data || { plan: "free", free_usage_count: 0, usage_started_at: null };
}

export function processUsage(user) {
  const now = Date.now();
  let usage = user.free_usage_count || 0;
  let start = user.usage_started_at
    ? new Date(user.usage_started_at).getTime()
    : now;
  // RESET AFTER 24 HOURS
  if (now - start > WINDOW) {
    usage = 0;
    start = now;
  }
  // BLOCK IF LIMIT REACHED
  if (usage >= LIMIT) {
    return {
      allowed: false,
      usage: LIMIT,
      start,
      footer: `⛔ Limit reached (10/10)
You can chat again at ${formatIST(start + WINDOW)}
💎 Want unlimited access?
👉 /subscribe`
    };
  }
  // INCREMENT
  usage += 1;
  return {
    allowed: true,
    usage,
    start,
    footer: `📈 Requests: ${usage}/10`
  };
}

export async function updateUsage(chatId, usage, start) {
  await supabase
    .from("subscribers")
    .update({
      free_usage_count: usage,
      usage_started_at: new Date(start).toISOString()
    })
    .eq("telegram_chat_id", chatId);
}

import supabase from './supabase.service.js';

const LIMIT = 10;
const WINDOW_MS = 24 * 60 * 60 * 1000;

function formatTime(date) {
  return date.toLocaleString("en-IN", {
    hour: "numeric",
    minute: "2-digit",
    day: "numeric",
    month: "short"
  });
}

export async function getUsageUser(chatId) {
  const { data } = await supabase
    .from("subscribers")
    .select("plan, status, expires_at, free_usage_count, usage_started_at")
    .eq("telegram_chat_id", chatId.toString())
    .maybeSingle();
  return data || { plan: "free", free_usage_count: 0, usage_started_at: null };
}

export function isProPlan(user = {}) {
  const now = new Date();
  return user.plan === "pro" && (
    user.status === "active" ||
    (user.status === "grace" && user.expires_at && new Date(user.expires_at) > now)
  );
}

export async function processUsage(user) {
  const now = Date.now();

  if (isProPlan(user)) {
    return {
      allowed: true,
      footer: "",
      remaining: "∞"
    };
  }

  let usage = user?.free_usage_count || 0;
  let start = user?.usage_started_at ? new Date(user.usage_started_at).getTime() : now;

  if (now - start > WINDOW_MS) {
    usage = 0;
    start = now;
  }

  if (usage >= LIMIT) {
    const resetTime = new Date(start + WINDOW_MS);
    return {
      allowed: false,
      footer: `⛔ Limit reached (10/10)\nYou can chat again at ${formatTime(resetTime)}`
    };
  }

  usage += 1;
  const remaining = LIMIT - usage;
  return {
    allowed: true,
    usage,
    start,
    remaining,
    footer: `📈 Requests: ${usage}/10`
  };
}

export async function updateUsage(chatId, payload) {
  await supabase
    .from("subscribers")
    .upsert({
      telegram_chat_id: chatId.toString(),
      ...payload
    }, {
      onConflict: "telegram_chat_id"
    });
}

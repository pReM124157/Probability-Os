import supabase from './supabase.service.js';

const FREE_LIMIT = 10;

export async function checkAndIncrementUsage(chatId) {
  const { data } = await supabase
    .from('subscribers')
    .select('plan, free_usage_count, free_usage_reset_at')
    .eq('telegram_chat_id', chatId.toString())
    .maybeSingle();

  let count = data?.free_usage_count || 0;
  let resetAt = data?.free_usage_reset_at;
  const now = new Date();

  if (!resetAt || now > new Date(resetAt)) {
    count = 0;
    const IST_OFFSET = 5.5 * 60 * 60 * 1000;
    const istNow = new Date(now.getTime() + IST_OFFSET);
    const nextReset = new Date(istNow);
    nextReset.setHours(istNow.getHours() + 12, 0, 0, 0);
    resetAt = new Date(nextReset.getTime() - IST_OFFSET).toISOString();
  }

  if (count >= FREE_LIMIT) {
    return { allowed: false, remaining: 0 };
  }

  count += 1;

  await supabase.from('subscribers').upsert({
    telegram_chat_id: chatId.toString(),
    free_usage_count: count,
    free_usage_reset_at: resetAt
  });

  return { allowed: true, remaining: FREE_LIMIT - count };
}

export async function getRemainingUsage(chatId) {
  const { data } = await supabase
    .from('subscribers')
    .select('free_usage_count, free_usage_reset_at')
    .eq('telegram_chat_id', chatId.toString())
    .maybeSingle();

  if (!data) return FREE_LIMIT;

  let count = data.free_usage_count || 0;
  let resetAt = data.free_usage_reset_at;
  const now = new Date();

  if (!resetAt || now > new Date(resetAt)) {
    return FREE_LIMIT;
  }

  return Math.max(0, FREE_LIMIT - count);
}

export { FREE_LIMIT };

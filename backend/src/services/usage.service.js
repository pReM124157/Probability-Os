import supabase from './supabase.service.js';

export async function handleUsage(chatId) {
  try {
    const { data, error } = await supabase.rpc("handle_usage", {
      p_chat_id: chatId.toString()
    });
    if (error) {
      console.error("USAGE RPC ERROR:", error);
      return {
        allowed: false,
        count: null,
        reset_time: null,
        reason: "USAGE_UNAVAILABLE"
      };
    }
    return data;
  } catch (err) {
    console.error("USAGE SYSTEM FAIL:", err);
    return {
      allowed: false,
      count: null,
      reset_time: null,
      reason: "USAGE_UNAVAILABLE"
    };
  }
}

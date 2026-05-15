import supabase from "./supabase.service.js";
import { safeString } from "../core/safety.js";

function stateKey(namespace, id) {
  return `${namespace}:${safeString(id)}`;
}

export async function putState(namespace, id, value, ttlSeconds = null) {
  const { error } = await supabase.rpc("put_distributed_state", {
    p_state_key: stateKey(namespace, id),
    p_state_value: value,
    p_ttl_seconds: ttlSeconds
  });
  if (error) throw error;
}

export async function getState(namespace, id) {
  const key = stateKey(namespace, id);
  const { data, error } = await supabase
    .from("distributed_state")
    .select("state_value, expires_at")
    .eq("state_key", key)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  if (data.expires_at && new Date(data.expires_at) <= new Date()) return null;
  return data.state_value;
}

export async function deleteState(namespace, id) {
  const { error } = await supabase
    .from("distributed_state")
    .delete()
    .eq("state_key", stateKey(namespace, id));
  if (error) throw error;
}

export async function consumeState(namespace, id) {
  const { data, error } = await supabase.rpc("consume_distributed_state", {
    p_state_key: stateKey(namespace, id)
  });
  if (error) throw error;
  return data || null;
}

export async function claimEphemeralKey(namespace, id, ownerId, ttlSeconds) {
  const { data, error } = await supabase.rpc("claim_ephemeral_key", {
    p_state_key: stateKey(namespace, id),
    p_owner_id: ownerId,
    p_ttl_seconds: ttlSeconds
  });
  if (error) throw error;
  return data === true;
}

export async function appendChatMemory(chatId, userMessage, assistantMessage, ttlSeconds = 86400, limit = 4) {
  const { data, error } = await supabase.rpc("append_chat_memory", {
    p_state_key: stateKey("chat_memory", chatId),
    p_user_message: userMessage,
    p_assistant_message: assistantMessage,
    p_ttl_seconds: ttlSeconds,
    p_limit: limit
  });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

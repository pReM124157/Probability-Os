import "dotenv/config";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import supabase from "../src/services/supabase.service.js";
import { isPro } from "../src/core/user.js";
import { handleUsage } from "../src/services/usage.service.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendDir = path.resolve(__dirname, "..");
const schedulerModuleUrl = pathToFileURL(path.join(backendDir, "src/scheduler/subscriptionLifecycle.scheduler.js")).href;
const chatId = String(process.env.TELEGRAM_CHAT_ID || "").trim();

const reminderNowIso = "2026-06-27T00:00:00.000Z";
const reminderExpiryIso = "2026-06-30T00:00:00.000Z";
const expiredNowIso = "2026-06-27T00:00:00.000Z";
const expiredExpiryIso = "2026-06-26T00:00:00.000Z";
const reminderEventId = `subscription.renewal_reminder:${chatId}:2026-06-30`;
const expiredEventId = `subscription.expired:${chatId}:2026-06-26`;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function section(title, value) {
  console.log(`\n=== ${title} ===`);
  if (value !== undefined) {
    console.log(typeof value === "string" ? value : JSON.stringify(value, null, 2));
  }
}

async function getSubscriberState() {
  const { data, error } = await supabase
    .from("subscribers")
    .select("telegram_chat_id,status,plan,is_pro,expires_at,subscription_end,cancel_at_period_end,razorpay_subscription_id,free_usage_count,usage_started_at,last_payment_at")
    .eq("telegram_chat_id", chatId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function getEventState(eventId) {
  const { data, error } = await supabase
    .from("subscription_events")
    .select("event_id,event_type,subscription_id,telegram_chat_id,payload_preview,processed_at")
    .eq("event_id", eventId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function assertFreshEventIds() {
  const { data, error } = await supabase
    .from("subscription_events")
    .select("event_id")
    .in("event_id", [reminderEventId, expiredEventId]);
  if (error) throw error;
  assert((data || []).length === 0, `Test event IDs already exist: ${(data || []).map((row) => row.event_id).join(", ")}`);
}

async function applySubscriberState(patch) {
  const payload = {
    telegram_chat_id: chatId,
    ...patch
  };
  const { error } = await supabase
    .from("subscribers")
    .upsert(payload, { onConflict: "telegram_chat_id" });
  if (error) throw error;
  return getSubscriberState();
}

async function restoreOriginalState(originalState) {
  if (!originalState) {
    const { error } = await supabase
      .from("subscribers")
      .delete()
      .eq("telegram_chat_id", chatId);
    if (error) throw error;
    return;
  }

  const { error } = await supabase
    .from("subscribers")
    .update({
      status: originalState.status,
      plan: originalState.plan,
      is_pro: originalState.is_pro,
      expires_at: originalState.expires_at,
      subscription_end: originalState.subscription_end,
      cancel_at_period_end: originalState.cancel_at_period_end,
      razorpay_subscription_id: originalState.razorpay_subscription_id,
      free_usage_count: originalState.free_usage_count,
      usage_started_at: originalState.usage_started_at,
      last_payment_at: originalState.last_payment_at
    })
    .eq("telegram_chat_id", chatId);
  if (error) throw error;
}

function runSchedulerTick(nowIso) {
  const evalCode = `
    import "dotenv/config";
    import { runSubscriptionLifecycleSchedulerTick } from ${JSON.stringify(schedulerModuleUrl)};
    const result = await runSubscriptionLifecycleSchedulerTick({ now: new Date(${JSON.stringify(nowIso)}) });
    console.log("FORCED_SCHEDULER_RESULT", JSON.stringify(result, null, 2));
  `;

  const result = spawnSync("node", ["--input-type=module", "-e", evalCode], {
    cwd: backendDir,
    encoding: "utf8"
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error([result.stdout, result.stderr].filter(Boolean).join("\n"));
  }

  return {
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim()
  };
}

function pickDelivery(eventRow) {
  return eventRow?.payload_preview?._delivery || null;
}

const originalState = await getSubscriberState();
assert(chatId, "TELEGRAM_CHAT_ID is required for forced lifecycle verification.");

section("TARGET CHAT", { chatId });
section("ORIGINAL SUBSCRIBER STATE", originalState);

try {
  await assertFreshEventIds();

  const reminderBefore = await applySubscriberState({
    status: "active",
    plan: "PRO",
    is_pro: true,
    expires_at: reminderExpiryIso,
    subscription_end: reminderExpiryIso,
    cancel_at_period_end: false,
    razorpay_subscription_id: originalState?.razorpay_subscription_id || "force_sub_reminder_20260630",
    free_usage_count: originalState?.free_usage_count ?? 0,
    usage_started_at: originalState?.usage_started_at || new Date(reminderNowIso).toISOString(),
    last_payment_at: originalState?.last_payment_at || new Date(reminderNowIso).toISOString()
  });
  section("REMINDER BEFORE STATE", reminderBefore);

  const reminderRun1 = runSchedulerTick(reminderNowIso);
  const reminderEventAfterRun1 = await getEventState(reminderEventId);
  const reminderAfterRun1 = await getSubscriberState();
  section("REMINDER ELIGIBILITY + DELIVERY LOGS RUN 1", reminderRun1.stdout || reminderRun1.stderr);
  section("REMINDER EVENT STATE RUN 1", reminderEventAfterRun1);
  section("REMINDER FINAL STATE RUN 1", reminderAfterRun1);

  const reminderRun2 = runSchedulerTick(reminderNowIso);
  const reminderEventAfterRun2 = await getEventState(reminderEventId);
  section("REMINDER DUPLICATE CHECK RUN 2", reminderRun2.stdout || reminderRun2.stderr);
  section("REMINDER DELIVERY CHECKPOINT AFTER RUN 2", pickDelivery(reminderEventAfterRun2));

  const expiredBefore = await applySubscriberState({
    status: "active",
    plan: "PRO",
    is_pro: true,
    expires_at: expiredExpiryIso,
    subscription_end: expiredExpiryIso,
    cancel_at_period_end: false,
    razorpay_subscription_id: originalState?.razorpay_subscription_id || "force_sub_expired_20260626",
    free_usage_count: 0,
    usage_started_at: new Date(expiredNowIso).toISOString(),
    last_payment_at: originalState?.last_payment_at || new Date(expiredNowIso).toISOString()
  });
  section("EXPIRED BEFORE STATE", expiredBefore);

  const expiredRun1 = runSchedulerTick(expiredNowIso);
  const expiredEventAfterRun1 = await getEventState(expiredEventId);
  const expiredAfterRun1 = await getSubscriberState();
  const freeGateProbe = await handleUsage(chatId);
  const expiredAfterGateProbe = await getSubscriberState();
  section("EXPIRED ELIGIBILITY + DELIVERY LOGS RUN 1", expiredRun1.stdout || expiredRun1.stderr);
  section("EXPIRED EVENT STATE RUN 1", expiredEventAfterRun1);
  section("EXPIRED FINAL STATE RUN 1", expiredAfterRun1);
  section("FREE TIER GATE PROBE", {
    isProAfterDowngrade: isPro(expiredAfterRun1),
    usageResult: freeGateProbe,
    subscriberAfterProbe: expiredAfterGateProbe
  });

  const expiredDuplicateProbeBefore = await applySubscriberState({
    status: "active",
    plan: "PRO",
    is_pro: true,
    expires_at: expiredExpiryIso,
    subscription_end: expiredExpiryIso,
    cancel_at_period_end: false,
    razorpay_subscription_id: originalState?.razorpay_subscription_id || "force_sub_expired_20260626",
    free_usage_count: 0,
    usage_started_at: new Date(expiredNowIso).toISOString(),
    last_payment_at: originalState?.last_payment_at || new Date(expiredNowIso).toISOString()
  });
  const expiredRun2 = runSchedulerTick(expiredNowIso);
  const expiredEventAfterRun2 = await getEventState(expiredEventId);
  const expiredAfterRun2 = await getSubscriberState();
  section("EXPIRED DUPLICATE PROBE BEFORE RUN 2", expiredDuplicateProbeBefore);
  section("EXPIRED DUPLICATE CHECK RUN 2", expiredRun2.stdout || expiredRun2.stderr);
  section("EXPIRED DELIVERY CHECKPOINT AFTER RUN 2", pickDelivery(expiredEventAfterRun2));
  section("EXPIRED STATE AFTER DUPLICATE PROBE", expiredAfterRun2);
} finally {
  await restoreOriginalState(originalState);
  section("RESTORED ORIGINAL STATE", await getSubscriberState());
}

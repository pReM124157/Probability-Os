import bot from "./telegram.service.js";
import supabase from "./supabase.service.js";
import { logError, logEvent } from "./telemetry.service.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const RENEWAL_REMINDER_DAYS = 3;
const EXPIRY_WARNING_DAYS = 1;

function formatDateLabel(value) {
  const ts = value ? new Date(value) : null;
  if (!ts || Number.isNaN(ts.getTime())) return null;
  return ts.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC"
  });
}

function getDeliveryCheckpoint(eventRow = {}) {
  const delivery = eventRow?.payload_preview?._delivery || {};
  return {
    status: String(delivery.status || "PENDING").toUpperCase(),
    attempts: Number(delivery.attempts || 0),
    messageId: delivery.message_id ? String(delivery.message_id) : null
  };
}

function withDeliveryCheckpoint(payloadPreview, patch) {
  return {
    ...(payloadPreview || {}),
    _delivery: {
      ...((payloadPreview || {})._delivery || {}),
      ...patch
    }
  };
}

function buildSubscriptionLifecycleMessage(kind, context = {}) {
  const formattedDate = formatDateLabel(context.subscriptionEnd);

  if (kind === "subscription.renewal_reminder") {
    return [
      "🔔 SUBSCRIPTION RENEWAL REMINDER",
      `Your Finsight Pro plan renews in ${context.daysUntilExpiry} days.`,
      formattedDate ? "Renewal Date:" : null,
      formattedDate,
      "Premium Access Includes:",
      "• Live Signals",
      "• Institutional Reports",
      "• Trade Lifecycle Updates"
    ].filter(Boolean).join("\n");
  }

  if (kind === "subscription.expiry_warning") {
    return [
      "⚠️ SUBSCRIPTION EXPIRING",
      "Your premium access expires tomorrow.",
      "Renew to continue receiving:",
      "• Institutional Intelligence",
      "• Live Trading Signals"
    ].join("\n");
  }

  if (kind === "subscription.expired") {
    return [
      "❌ SUBSCRIPTION EXPIRED",
      "Your premium access has ended.",
      "You are now on the free tier.",
      "Premium features paused."
    ].join("\n");
  }

  return null;
}

async function getSubscriptionEventRecord(eventId) {
  const { data, error } = await supabase
    .from("subscription_events")
    .select("event_id,event_type,subscription_id,telegram_chat_id,payload_preview,processed_at")
    .eq("event_id", eventId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function ensureSubscriptionEventRecord({ eventId, eventType, subscriptionId, chatId, payloadPreview }) {
  const { error } = await supabase
    .from("subscription_events")
    .insert({
      event_id: eventId,
      event_type: eventType,
      subscription_id: subscriptionId,
      telegram_chat_id: chatId,
      payload_preview: payloadPreview || {}
    });

  if (error && error.code !== "23505") {
    throw error;
  }

  return getSubscriptionEventRecord(eventId);
}

async function persistSubscriptionDeliveryCheckpoint(eventId, eventRow, patch) {
  const payloadPreview = withDeliveryCheckpoint(eventRow?.payload_preview, patch);
  const { data, error } = await supabase
    .from("subscription_events")
    .update({ payload_preview: payloadPreview })
    .eq("event_id", eventId)
    .select();
  if (error) throw error;
  return Array.isArray(data) && data.length > 0
    ? data[0]
    : { ...(eventRow || {}), payload_preview: payloadPreview };
}

async function deliverSubscriptionLifecycleMessage({ eventId, eventType, chatId, message }) {
  if (!eventId || !chatId || !message) {
    return { status: "SKIPPED", eventId };
  }

  const eventRow = await getSubscriptionEventRecord(eventId);
  const checkpoint = getDeliveryCheckpoint(eventRow);
  if (checkpoint.status === "SENT") {
    return { status: "SENT", eventId, messageId: checkpoint.messageId, skipped: true };
  }

  const nextAttempts = checkpoint.attempts + 1;
  const claimedRow = await persistSubscriptionDeliveryCheckpoint(eventId, eventRow, {
    status: "RETRY_SCHEDULED",
    attempts: nextAttempts,
    last_attempt_at: new Date().toISOString(),
    error: null
  });

  try {
    console.log("=== STARTING TELEGRAM DELIVERY ===");
    console.log("SUBSCRIPTION_EVENT_ID", eventId);
    console.log("SUBSCRIPTION_EVENT_TYPE", eventType);
    console.log("TELEGRAM_SEND_START", new Date().toISOString());
    const response = await bot.telegram.sendMessage(chatId, message);
    console.log("TELEGRAM_SEND_SUCCESS", new Date().toISOString());
    console.log("=== TELEGRAM DELIVERY SUCCESS ===");

    await persistSubscriptionDeliveryCheckpoint(eventId, claimedRow, {
      status: "SENT",
      attempts: nextAttempts,
      message_id: response?.message_id ? String(response.message_id) : null,
      sent_at: new Date().toISOString(),
      error: null
    });

    logEvent("subscription.delivery.sent", {
      eventId,
      eventType,
      chatId,
      attempts: nextAttempts,
      messageId: response?.message_id || null
    });

    return { status: "SENT", eventId, messageId: response?.message_id || null };
  } catch (error) {
    await persistSubscriptionDeliveryCheckpoint(eventId, claimedRow, {
      status: "FAILED",
      attempts: nextAttempts,
      error: String(error?.message || "UNKNOWN_DELIVERY_ERROR").slice(0, 500)
    });
    throw error;
  }
}

function getExpiryDate(row) {
  const raw = row?.expires_at || row?.subscription_end || null;
  if (!raw) return null;
  const ts = new Date(raw);
  return Number.isNaN(ts.getTime()) ? null : ts;
}

function getDaysUntilExpiry(expiryAt, now) {
  return Math.ceil((expiryAt.getTime() - now.getTime()) / DAY_MS);
}

async function sendScheduledLifecycleEvent({
  row,
  eventType,
  eventId,
  payloadPreview,
  message
}) {
  const eventRow = await ensureSubscriptionEventRecord({
    eventId,
    eventType,
    subscriptionId: row.razorpay_subscription_id || null,
    chatId: row.telegram_chat_id,
    payloadPreview
  });

  const checkpoint = getDeliveryCheckpoint(eventRow);
  if (checkpoint.status === "SENT") {
    return { status: "SUPPRESSED", eventId };
  }

  return deliverSubscriptionLifecycleMessage({
    eventId,
    eventType,
    chatId: row.telegram_chat_id,
    message
  });
}

async function downgradeExpiredSubscriber(row, now) {
  const { error } = await supabase
    .from("subscribers")
    .update({
      status: "expired",
      plan: "FREE",
      is_pro: false,
      expires_at: null,
      subscription_end: null,
      free_usage_count: 0,
      usage_started_at: now.toISOString(),
      cancel_at_period_end: false
    })
    .eq("telegram_chat_id", row.telegram_chat_id);
  if (error) throw error;
}

export async function processSubscriptionLifecycleBatch({ now = new Date() } = {}) {
  const { data: rows, error } = await supabase
    .from("subscribers")
    .select("telegram_chat_id,status,plan,is_pro,expires_at,subscription_end,cancel_at_period_end,razorpay_subscription_id,free_usage_count,usage_started_at")
    .in("status", ["active", "grace"]);

  if (error) throw error;

  const activeSubscribers = (rows || []).filter((row) => {
    const status = String(row.status || "").toLowerCase();
    const isActiveStatus = status === "active" || status === "grace";
    return isActiveStatus && row.plan === "PRO" && row.is_pro === true;
  });

  console.log("=== ACTIVE SUBSCRIPTIONS ===");
  console.log(activeSubscribers.length);

  let remindersSent = 0;
  let warningsSent = 0;
  let downgrades = 0;
  let duplicateSuppressed = 0;

  for (const row of activeSubscribers) {
    const expiryAt = getExpiryDate(row);
    if (!expiryAt) continue;

    const daysUntilExpiry = getDaysUntilExpiry(expiryAt, now);
    console.log({
      telegram_chat_id: row.telegram_chat_id,
      subscription_end: row.subscription_end || row.expires_at,
      daysUntilExpiry
    });

    if (expiryAt.getTime() <= now.getTime()) {
      const eventId = `subscription.expired:${row.telegram_chat_id}:${expiryAt.toISOString().slice(0, 10)}`;
      const existingEvent = await getSubscriptionEventRecord(eventId);
      const checkpoint = getDeliveryCheckpoint(existingEvent);
      if (checkpoint.status === "SENT") {
        duplicateSuppressed += 1;
        continue;
      }

      await downgradeExpiredSubscriber(row, now);
      await sendScheduledLifecycleEvent({
        row,
        eventType: "subscription.expired",
        eventId,
        payloadPreview: {
          scheduler: "subscription_lifecycle",
          kind: "expired",
          subscriptionEnd: expiryAt.toISOString()
        },
        message: buildSubscriptionLifecycleMessage("subscription.expired", {
          subscriptionEnd: expiryAt.toISOString()
        })
      });
      downgrades += 1;
      continue;
    }

    if (String(row.status || "").toLowerCase() === "active" && !row.cancel_at_period_end && daysUntilExpiry === RENEWAL_REMINDER_DAYS) {
      const eventId = `subscription.renewal_reminder:${row.telegram_chat_id}:${expiryAt.toISOString().slice(0, 10)}`;
      const result = await sendScheduledLifecycleEvent({
        row,
        eventType: "subscription.renewal_reminder",
        eventId,
        payloadPreview: {
          scheduler: "subscription_lifecycle",
          kind: "renewal_reminder",
          daysUntilExpiry,
          subscriptionEnd: expiryAt.toISOString()
        },
        message: buildSubscriptionLifecycleMessage("subscription.renewal_reminder", {
          daysUntilExpiry,
          subscriptionEnd: expiryAt.toISOString()
        })
      });
      if (result.status === "SUPPRESSED") duplicateSuppressed += 1;
      else remindersSent += 1;
      continue;
    }

    if ((row.cancel_at_period_end || String(row.status || "").toLowerCase() === "grace") && daysUntilExpiry === EXPIRY_WARNING_DAYS) {
      const eventId = `subscription.expiry_warning:${row.telegram_chat_id}:${expiryAt.toISOString().slice(0, 10)}`;
      const result = await sendScheduledLifecycleEvent({
        row,
        eventType: "subscription.expiry_warning",
        eventId,
        payloadPreview: {
          scheduler: "subscription_lifecycle",
          kind: "expiry_warning",
          daysUntilExpiry,
          subscriptionEnd: expiryAt.toISOString()
        },
        message: buildSubscriptionLifecycleMessage("subscription.expiry_warning", {
          daysUntilExpiry,
          subscriptionEnd: expiryAt.toISOString()
        })
      });
      if (result.status === "SUPPRESSED") duplicateSuppressed += 1;
      else warningsSent += 1;
    }
  }

  return {
    activeSubscribers: activeSubscribers.length,
    remindersSent,
    warningsSent,
    downgrades,
    duplicateSuppressed
  };
}

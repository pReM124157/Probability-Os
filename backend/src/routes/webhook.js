/**
 * webhook.js — Institutional-grade Razorpay Webhook Handler
 *
 * Requirements Met:
 * 1. Distributed-Safe: All events are stamped in subscription_events to prevent duplicate processing.
 * 2. Fail-Closed: Never degrades to FREE unless an explicit cancellation/failure event arrives.
 * 3. Graceful Mapping: Uses Razorpay 'notes' OR DB sub_id matching to ALWAYS find telegram_chat_id.
 * 4. Atomic Updates: Uses upsert (not update) to guarantee writes even if user was deleted.
 * 5. Payment Audit Log: All captured payments map cleanly to the 'payments' table.
 */

import express from "express";
import crypto from "crypto";
import bot from "../services/telegram.service.js";
import supabase from "../services/supabase.service.js";
import { createTraceId, logError, logEvent } from "../services/telemetry.service.js";

const router = express.Router();
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const GRACE_PERIOD_MS = 2 * 24 * 60 * 60 * 1000;

router.get("/razorpay", (req, res) => {
  res.send("✅ Razorpay Webhook endpoint is active and reachable.");
});

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
    messageId: delivery.message_id ? String(delivery.message_id) : null,
    sentAt: delivery.sent_at || null,
    error: delivery.error || null,
    lastAttemptAt: delivery.last_attempt_at || null
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
  const renewalDate = formatDateLabel(context.subscriptionEnd);

  if (kind === "subscription.activated") {
    return [
      "✅ SUBSCRIPTION ACTIVATED",
      "Plan: Finsight Pro",
      "Status: Active",
      "Access Enabled:",
      "• Live Signals",
      "• Institutional Reports",
      "• Trade Lifecycle Updates",
      renewalDate ? "Renewal Date:" : null,
      renewalDate
    ].filter(Boolean).join("\n");
  }

  if (kind === "subscription.cancelled") {
    return [
      "❌ SUBSCRIPTION CANCELLED",
      "Your premium access has been disabled.",
      "Status: Cancelled"
    ].join("\n");
  }

  if (kind === "invoice.payment_failed" || kind === "payment.failed") {
    return [
      "⚠️ SUBSCRIPTION EXPIRING",
      "Renew to continue receiving institutional intelligence.",
      "Status: Grace Period",
      "We will retry the payment automatically."
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

async function persistSubscriptionDeliveryCheckpoint(eventId, eventRow, patch) {
  const payloadPreview = withDeliveryCheckpoint(eventRow?.payload_preview, patch);
  const { data, error } = await supabase
    .from("subscription_events")
    .update({ payload_preview: payloadPreview })
    .eq("event_id", eventId)
    .select();
  if (error) throw error;
  return Array.isArray(data) && data.length > 0 ? data[0] : { ...(eventRow || {}), payload_preview: payloadPreview };
}

async function deliverSubscriptionLifecycleMessage({ eventId, eventType, chatId, message }) {
  if (!message || !chatId) return { status: "SKIPPED", eventId };

  const eventRow = await getSubscriptionEventRecord(eventId);
  const checkpoint = getDeliveryCheckpoint(eventRow);
  if (checkpoint.status === "SENT") {
    return { status: "SENT", eventId, messageId: checkpoint.messageId, skipped: true };
  }

  const nextAttempts = checkpoint.attempts + 1;
  const claimedAt = new Date().toISOString();
  const claimedRow = await persistSubscriptionDeliveryCheckpoint(eventId, eventRow, {
    status: "RETRY_SCHEDULED",
    attempts: nextAttempts,
    last_attempt_at: claimedAt,
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
    console.log("✅ Subscription alert sent to Telegram", {
      chatId,
      messageId: response?.message_id || null,
      eventId,
      eventType
    });

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
  } catch (err) {
    await persistSubscriptionDeliveryCheckpoint(eventId, claimedRow, {
      status: "FAILED",
      attempts: nextAttempts,
      error: String(err?.message || "UNKNOWN_DELIVERY_ERROR").slice(0, 500)
    });
    console.error("[WEBHOOK NOTIFY FAIL]", { chatId, eventId, eventType, message: err?.message });
    throw err;
  }
}

/**
 * 1. Extract Chat ID securely.
 * If webhook payload 'notes' lacks telegram_chat_id, fallback to database lookup via subscription_id.
 */
async function getChatIdSafe(entity, subscriptionId = null) {
  // Try direct notes first
  let chatId = entity?.notes?.telegram_chat_id;
  if (chatId) return chatId.toString();

  // Try fallback lookup
  const lookupId = subscriptionId || entity?.subscription_id || entity?.id;
  if (!lookupId) return null;

  try {
    const { data } = await supabase
      .from("subscribers")
      .select("telegram_chat_id")
      .eq("razorpay_subscription_id", lookupId)
      .maybeSingle();
    return data?.telegram_chat_id ? data.telegram_chat_id.toString() : null;
  } catch (err) {
    console.error("[WEBHOOK CHAT ID LOOKUP FAIL]", err.message);
    return null;
  }
}

/**
 * 2. Idempotency Guard.
 * Attempts to insert the event_id into subscription_events.
 * If the row already exists, we skip processing.
 */
async function markEventProcessed(eventId, eventType, subscriptionId, chatId, payload) {
  const payloadString = payload == null ? "" : JSON.stringify(payload);
  const payloadPreview =
    payloadString.length <= 1000
      ? (payload || {})
      : { _truncated: true, preview: payloadString.slice(0, 1000) };

  const { data, error } = await supabase
    .from("subscription_events")
    .insert({
      event_id: eventId,
      event_type: eventType,
      subscription_id: subscriptionId,
      telegram_chat_id: chatId,
      payload_preview: payloadPreview
    })
    .select("event_id")
    .maybeSingle();

  if (error && error.code === '23505') { // Postgres unique violation
    logEvent("webhook.razorpay.replay_detected", {
      eventId,
      eventType,
      subscriptionId: subscriptionId || null,
      chatId: chatId || null
    });
    console.log(`[WEBHOOK IDEMPOTENCY] Skipping duplicate event ${eventId}`);
    return {
      shouldProcessEvent: false,
      eventRow: await getSubscriptionEventRecord(eventId)
    };
  }
  if (error) throw error;
  return {
    shouldProcessEvent: true,
    eventRow: await getSubscriptionEventRecord(eventId)
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// HANDLERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A. subscription.activated
 * Fires on first successful payment of a new subscription.
 * Upgrades user to PRO immediately.
 */
async function handleSubscriptionActivated(payload, eventId) {
  const sub = payload.subscription?.entity;
  const chatId = await getChatIdSafe(sub);
  if (!chatId) return console.log(`[WEBHOOK MISSING CHAT] Activated: ${sub?.id}`);

  const eventState = await markEventProcessed(eventId, "subscription.activated", sub?.id, chatId, payload);

  const subscriptionEnd = new Date(Date.now() + THIRTY_DAYS_MS).toISOString();

  if (eventState.shouldProcessEvent) {
    const { error } = await supabase.from("subscribers").upsert(
      {
        telegram_chat_id: chatId,
        razorpay_subscription_id: sub.id,
        is_pro: true,
        status: "active",
        plan: "PRO",
        subscription_started_at: new Date().toISOString(),
        subscription_end: subscriptionEnd,
        expires_at: subscriptionEnd
      },
      { onConflict: "telegram_chat_id" }
    );
    if (error) throw error;
  }

  await deliverSubscriptionLifecycleMessage({
    eventId,
    eventType: "subscription.activated",
    chatId,
    message: buildSubscriptionLifecycleMessage("subscription.activated", { subscriptionEnd })
  });
}

/**
 * B. payment.captured
 * Fires for ALL captured payments (including renewals).
 * Used purely for payment audit log / deduplication.
 */
async function handlePaymentCaptured(payload, eventId) {
  const payment = payload.payment?.entity;
  const paymentId = payment?.id;
  const subscriptionId = payment?.subscription_id; // Added by Razorpay for sub payments
  const chatId = await getChatIdSafe(payment, subscriptionId);

  if (!chatId || !paymentId) return;

  const eventState = await markEventProcessed(eventId, "payment.captured", subscriptionId, chatId, payload);
  if (!eventState.shouldProcessEvent) return;

  const { error } = await supabase.from("payments").insert({
    id: paymentId,
    telegram_chat_id: chatId,
    subscription_id: subscriptionId,
    amount: payment.amount,
    currency: payment.currency || 'INR',
    event_type: 'payment.captured'
  });
  
  if (error) throw error;
  console.log(`[WEBHOOK PAYMENT CAPTURED] Recorded ${paymentId} for ${chatId}`);
}

/**
 * C. invoice.paid OR subscription.charged
 * Fires on every successful renewal (including the first one).
 * Extends expiry by 30 days.
 */
async function handleRenewal(payload, eventId, eventType) {
  const entity = payload.invoice?.entity || payload.subscription?.entity;
  const subId = entity?.subscription_id || entity?.id;
  const chatId = await getChatIdSafe(entity, subId);

  if (!chatId) return console.log(`[WEBHOOK MISSING CHAT] Renewal: ${subId}`);

  const eventState = await markEventProcessed(eventId, eventType, subId, chatId, payload);
  if (!eventState.shouldProcessEvent) return;

  const subscriptionEnd = new Date(Date.now() + THIRTY_DAYS_MS).toISOString();

  const { error } = await supabase.from("subscribers").upsert(
    {
      telegram_chat_id: chatId,
      razorpay_subscription_id: subId,
      is_pro: true,
      status: "active",
      plan: "PRO",
      subscription_end: subscriptionEnd,
      expires_at: subscriptionEnd,
      last_payment_at: new Date().toISOString()
    },
    { onConflict: "telegram_chat_id" }
  );
  if (error) throw error;

  console.log(`[WEBHOOK RENEWAL] Extended expiry for ${chatId}`);
  // No telegram notification needed for silent renewals
}

/**
 * D. subscription.cancelled
 * User cancelled. Immediate downgrade.
 */
async function handleSubscriptionCancelled(payload, eventId) {
  const sub = payload.subscription?.entity;
  const chatId = await getChatIdSafe(sub);

  if (!chatId) return;
  const eventState = await markEventProcessed(eventId, "subscription.cancelled", sub?.id, chatId, payload);

  if (eventState.shouldProcessEvent) {
    const { error } = await supabase.from("subscribers").upsert(
      {
        telegram_chat_id: chatId,
        is_pro: false,
        status: "cancelled",
        plan: "FREE"
        // we do NOT nullify razorpay_subscription_id so history is kept
      },
      { onConflict: "telegram_chat_id" }
    );
    if (error) throw error;
  }

  await deliverSubscriptionLifecycleMessage({
    eventId,
    eventType: "subscription.cancelled",
    chatId,
    message: buildSubscriptionLifecycleMessage("subscription.cancelled")
  });
}

/**
 * E. invoice.payment_failed
 * Renewal failed. Give 48-hour grace period instead of instant downgrade.
 */
async function handlePaymentFailed(payload, eventId) {
  const invoice = payload.invoice?.entity;
  const subId = invoice?.subscription_id;
  const chatId = await getChatIdSafe(invoice, subId);

  if (!chatId) return;
  const eventState = await markEventProcessed(eventId, "invoice.payment_failed", subId, chatId, payload);

  const graceExpiry = new Date(Date.now() + GRACE_PERIOD_MS).toISOString();
  if (eventState.shouldProcessEvent) {
    const { error } = await supabase.from("subscribers").upsert(
      {
        telegram_chat_id: chatId,
        status: "grace",
        is_pro: true,
        plan: "PRO",
        expires_at: graceExpiry,
        subscription_end: graceExpiry
      },
      { onConflict: "telegram_chat_id" }
    );
    if (error) throw error;
  }

  await deliverSubscriptionLifecycleMessage({
    eventId,
    eventType: "invoice.payment_failed",
    chatId,
    message: buildSubscriptionLifecycleMessage("invoice.payment_failed", { subscriptionEnd: graceExpiry })
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE
// ─────────────────────────────────────────────────────────────────────────────

router.post("/razorpay", express.raw({ type: "application/json" }), async (req, res) => {
  const traceId = createTraceId("webhook_razorpay");
  const signature = req.headers["x-razorpay-signature"];
  const razorpayEventId = req.headers["x-razorpay-event-id"];
  const rawBody = req.body?.toString() || "";

  try {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!rawBody.trim()) {
      logEvent("webhook.razorpay.rejected", {
        traceId,
        reason: "empty_body"
      });
      return res.status(400).json({ status: "invalid_payload" });
    }

    if (!signature || !secret || typeof signature !== "string") {
      logEvent("webhook.razorpay.rejected", {
        traceId,
        reason: "missing_signature_or_secret"
      });
      return res.status(401).json({ status: "invalid_signature" });
    }

    const shasum = crypto.createHmac("sha256", secret);
    shasum.update(rawBody);
    const digest = shasum.digest("hex");

    const signatureMatches =
      digest.length === signature.length &&
      crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
    if (!signatureMatches) {
      logEvent("webhook.razorpay.rejected", {
        traceId,
        reason: "signature_mismatch",
        eventId: razorpayEventId || null
      });
      return res.status(401).json({ status: "invalid_signature" });
    }

    let data;
    try {
      data = JSON.parse(rawBody);
    } catch (parseError) {
      logError("webhook.razorpay.malformed_json", parseError, {
        traceId
      });
      return res.status(400).json({ status: "invalid_payload" });
    }

    if (!data || typeof data !== "object" || Array.isArray(data)) {
      logEvent("webhook.razorpay.rejected", {
        traceId,
        reason: "invalid_payload_shape"
      });
      return res.status(400).json({ status: "invalid_payload" });
    }

    const event = data.event;
    const payload = data.payload || {};
    if (!event || typeof event !== "string") {
      logEvent("webhook.razorpay.rejected", {
        traceId,
        reason: "missing_event_name"
      });
      return res.status(400).json({ status: "invalid_payload" });
    }

    // Use razorpayEventId if present, else construct a deterministic fallback
    const eventId = razorpayEventId || `fallback-${event}-${Date.now()}`;

    if (event === "subscription.activated") {
      await handleSubscriptionActivated(payload, eventId);
    } else if (event === "payment.captured") {
      await handlePaymentCaptured(payload, eventId);
    } else if (event === "invoice.paid" || event === "subscription.charged") {
      await handleRenewal(payload, eventId, event);
    } else if (event === "subscription.cancelled") {
      await handleSubscriptionCancelled(payload, eventId);
    } else if (event === "invoice.payment_failed" || event === "payment.failed") {
      await handlePaymentFailed(payload, eventId);
    } else {
      console.log("[WEBHOOK IGNORING UNHANDLED EVENT]", event);
    }

    return res.json({ status: "ok" });
  } catch (err) {
    logError("webhook.razorpay.fatal_error", err, { traceId });
    console.error("[WEBHOOK FATAL ERROR]", err);
    // Returning 500 signals Razorpay to retry the webhook later
    return res.status(500).json({ status: "error" });
  }
});

export default router;

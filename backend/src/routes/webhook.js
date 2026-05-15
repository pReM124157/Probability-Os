import express from "express";
import crypto from "crypto";
import bot from "../services/telegram.service.js";
import supabase from "../services/supabase.service.js";

const router = express.Router();
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const GRACE_PERIOD_MS = 2 * 24 * 60 * 60 * 1000;

router.get("/razorpay", (req, res) => {
  res.send("✅ Razorpay Webhook endpoint is active and reachable.");
});

async function notifyTelegram(chatId, message, options = {}) {
  try {
    await bot.telegram.sendMessage(chatId, message, options);
  } catch (err) {
    console.error("Webhook Telegram notify failed:", {
      chatId,
      message: err?.message || "Unknown error"
    });
  }
}

async function findChatIdBySubscriptionId(subscriptionId) {
  if (!subscriptionId) return null;
  const { data, error } = await supabase
    .from("subscribers")
    .select("telegram_chat_id")
    .eq("razorpay_subscription_id", subscriptionId)
    .maybeSingle();

  if (error) throw error;
  return data?.telegram_chat_id || null;
}

async function handlePaymentCaptured(payload) {
  const payment = payload.payment?.entity;
  const chatId = payment?.notes?.telegram_chat_id;
  const paymentId = payment?.id;

  if (!chatId || !paymentId) {
    console.log("❌ Missing payment capture identifiers");
    return;
  }

  const { data: existing, error: existingError } = await supabase
    .from("payments")
    .select("id")
    .eq("id", paymentId)
    .maybeSingle();
  if (existingError) throw existingError;

  if (existing) {
    console.log("⚠️ Duplicate webhook ignored:", paymentId);
    return;
  }

  const subscriptionEnd = new Date(Date.now() + THIRTY_DAYS_MS).toISOString();
  const { error: upgradeError } = await supabase
    .from("subscribers")
    .upsert(
      {
        telegram_chat_id: chatId.toString(),
        plan: "PRO",
        is_pro: true,
        status: "active",
        subscription_end: subscriptionEnd,
        expires_at: subscriptionEnd,
        last_payment_at: new Date().toISOString()
      },
      { onConflict: "telegram_chat_id" }
    );
  if (upgradeError) throw upgradeError;

  const { error: paymentError } = await supabase
    .from("payments")
    .insert({
      id: paymentId,
      telegram_chat_id: chatId.toString(),
      amount: payment.amount,
      created_at: new Date().toISOString()
    });
  if (paymentError) throw paymentError;

  console.log("✅ PRO upgrade success for:", chatId);
}

async function handlePaymentFailed(payload) {
  const payment = payload.payment?.entity;
  const chatId = payment?.notes?.telegram_chat_id;
  if (!chatId) return;

  const { error } = await supabase
    .from("subscribers")
    .update({
      plan: "FREE",
      is_pro: false,
      status: "payment_failed",
      expires_at: null,
      subscription_end: null,
      free_usage_count: 0,
      usage_started_at: new Date().toISOString()
    })
    .eq("telegram_chat_id", chatId.toString());
  if (error) throw error;

  console.log("⚠️ Downgraded user due to payment failure:", chatId);
}

async function handleSubscriptionActivated(payload) {
  const sub = payload.subscription?.entity;
  let chatId = sub?.notes?.telegram_chat_id || null;
  if (!chatId) {
    chatId = await findChatIdBySubscriptionId(sub?.id);
  }
  if (!chatId) {
    console.log("❌ chatId missing for subscription.activated:", sub?.id);
    return;
  }

  const subscriptionEnd = new Date(Date.now() + THIRTY_DAYS_MS).toISOString();
  const { error } = await supabase
    .from("subscribers")
    .update({
      is_pro: true,
      status: "active",
      plan: "PRO",
      subscription_started_at: new Date().toISOString(),
      subscription_end: subscriptionEnd,
      expires_at: subscriptionEnd
    })
    .eq("telegram_chat_id", chatId.toString());
  if (error) throw error;

  await notifyTelegram(chatId, "🎉 Subscription Activated! You are now on FinSight Pro.");
}

async function handleInvoicePaidOrSubscriptionCharged(payload, event) {
  const invoice = payload.invoice?.entity || payload.subscription?.entity;
  const subId = invoice?.subscription_id || invoice?.id;
  const chatId = await findChatIdBySubscriptionId(subId);

  if (!chatId) {
    console.log(`❌ No chatId for ${event}:`, subId);
    return;
  }

  const subscriptionEnd = new Date(Date.now() + THIRTY_DAYS_MS).toISOString();
  const { error } = await supabase
    .from("subscribers")
    .update({
      is_pro: true,
      status: "active",
      plan: "PRO",
      subscription_end: subscriptionEnd,
      expires_at: subscriptionEnd,
      last_payment_at: new Date().toISOString(),
      subscription_started_at: new Date().toISOString()
    })
    .eq("telegram_chat_id", chatId.toString());
  if (error) throw error;

  await notifyTelegram(
    chatId,
    "🎉 Subscription Activated! You now have unlimited access to FinSight Pro."
  );
}

async function handleSubscriptionCancelled(payload) {
  const sub = payload.subscription?.entity;
  let chatId = sub?.notes?.telegram_chat_id || null;
  if (!chatId) {
    chatId = await findChatIdBySubscriptionId(sub?.id);
  }
  if (!chatId) {
    console.log("❌ No chatId for subscription.cancelled:", sub?.id);
    return;
  }

  const { error } = await supabase
    .from("subscribers")
    .update({
      is_pro: false,
      status: "cancelled",
      plan: "FREE"
    })
    .eq("telegram_chat_id", chatId.toString());
  if (error) throw error;

  await notifyTelegram(chatId, "❌ Your FinSight Pro subscription has been cancelled.");
}

async function handleInvoicePaymentFailed(payload) {
  const invoice = payload.invoice?.entity;
  let chatId = invoice?.notes?.telegram_chat_id || null;
  if (!chatId && invoice?.subscription_id) {
    chatId = await findChatIdBySubscriptionId(invoice.subscription_id);
  }
  if (!chatId) {
    console.log("❌ No chatId for invoice.payment_failed:", invoice?.id);
    return;
  }

  const graceExpiry = new Date(Date.now() + GRACE_PERIOD_MS).toISOString();
  const { error } = await supabase
    .from("subscribers")
    .update({
      status: "grace",
      is_pro: true,
      plan: "PRO",
      expires_at: graceExpiry,
      subscription_end: graceExpiry
    })
    .eq("telegram_chat_id", chatId.toString());
  if (error) throw error;

  await notifyTelegram(
    chatId,
    `⚠️ *Payment failed*\n\nWe'll retry automatically.\nYou still have access for 48 hours.\nUpdate payment method to avoid interruption.`,
    { parse_mode: "Markdown" }
  );
}

router.post("/razorpay", express.raw({ type: "application/json" }), async (req, res) => {
  console.log("🔥 RAW WEBHOOK RECEIVED");
  const signature = req.headers["x-razorpay-signature"];
  const rawBody = req.body?.toString() || "";
  console.log("SIGNATURE HEADER:", signature);
  console.log("BODY PREVIEW:", rawBody.slice(0, 100));

  try {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!signature || !secret) {
      console.log("❌ Missing signature or webhook secret");
      return res.status(401).json({ status: "invalid_signature" });
    }

    const shasum = crypto.createHmac("sha256", secret);
    shasum.update(rawBody);
    const digest = shasum.digest("hex");

    if (digest !== signature) {
      console.error("❌ Invalid signature");
      console.log("EXPECTED:", digest);
      console.log("RECEIVED:", signature);
      return res.status(401).json({ status: "invalid_signature" });
    }

    const data = JSON.parse(rawBody);
    console.log("🔥 WEBHOOK HIT", data.event);
    console.log("BODY:", JSON.stringify(data, null, 2));

    const event = data.event;
    const payload = data.payload || {};

    if (event === "payment.captured") {
      await handlePaymentCaptured(payload);
    } else if (event === "payment.failed") {
      await handlePaymentFailed(payload);
    } else if (event === "subscription.activated") {
      await handleSubscriptionActivated(payload);
    } else if (event === "invoice.paid" || event === "subscription.charged") {
      await handleInvoicePaidOrSubscriptionCharged(payload, event);
    } else if (event === "subscription.cancelled") {
      await handleSubscriptionCancelled(payload);
    } else if (event === "invoice.payment_failed") {
      await handleInvoicePaymentFailed(payload);
    } else {
      console.log("ℹ️ Unhandled webhook event:", event);
    }

    return res.json({ status: "ok" });
  } catch (err) {
    console.error("❌ WEBHOOK ERROR FULL:", err);
    return res.status(500).json({ status: "error" });
  }
});

export default router;

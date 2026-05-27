import Razorpay from "razorpay";
import supabase from "./supabase.service.js";
import { isPro } from "../core/user.js";
import { logError, logEvent } from "./telemetry.service.js";

const razorpay = process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET
  ? new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET
    })
  : null;

function normalizeSubscriptionEnd(subscription) {
  return subscription?.current_end
    ? new Date(Number(subscription.current_end) * 1000).toISOString()
    : null;
}

function normalizeLastPaymentAt(subscription) {
  return subscription?.current_start
    ? new Date(Number(subscription.current_start) * 1000).toISOString()
    : new Date().toISOString();
}

export async function fetchProviderSubscription(subscriptionId) {
  if (!razorpay || !subscriptionId) return null;
  return razorpay.subscriptions.fetch(subscriptionId);
}

export async function reconcileSubscriberEntitlement(chatId, user) {
  if (!razorpay || !user?.razorpay_subscription_id || isPro(user)) {
    return user;
  }

  const currentStatus = String(user.status || "").toLowerCase();
  if (!["pending", "free", "cancelled", "expired", ""].includes(currentStatus)) {
    return user;
  }

  try {
    const subscription = await fetchProviderSubscription(user.razorpay_subscription_id);
    if (String(subscription?.status || "").toLowerCase() !== "active") {
      return user;
    }

    const subscriptionEnd = normalizeSubscriptionEnd(subscription);
    const lastPaymentAt = normalizeLastPaymentAt(subscription);
    const nextUser = {
      ...user,
      plan: "PRO",
      is_pro: true,
      status: "active",
      expires_at: subscriptionEnd,
      subscription_end: subscriptionEnd,
      cancel_at_period_end: Boolean(subscription.has_scheduled_changes),
      last_payment_at: lastPaymentAt
    };

    const { error } = await supabase
      .from("subscribers")
      .update({
        plan: "PRO",
        is_pro: true,
        status: "active",
        expires_at: subscriptionEnd,
        subscription_end: subscriptionEnd,
        cancel_at_period_end: Boolean(subscription.has_scheduled_changes),
        last_payment_at: lastPaymentAt
      })
      .eq("telegram_chat_id", chatId);

    if (error) throw error;

    logEvent("subscription.reconciled_from_provider", {
      chatId,
      subscriptionId: user.razorpay_subscription_id,
      providerStatus: subscription.status,
      subscriptionEnd
    });

    return nextUser;
  } catch (error) {
    logError("subscription.reconcile_failed", error, {
      chatId,
      subscriptionId: user.razorpay_subscription_id
    });
    return user;
  }
}

export async function reconcilePendingSubscriptions({ limit = 25 } = {}) {
  const { data: rows, error } = await supabase
    .from("subscribers")
    .select("telegram_chat_id,status,plan,is_pro,expires_at,subscription_end,cancel_at_period_end,razorpay_subscription_id,last_payment_at")
    .eq("status", "pending")
    .not("razorpay_subscription_id", "is", null)
    .limit(limit);

  if (error) throw error;

  let checked = 0;
  let repaired = 0;

  for (const row of rows || []) {
    checked += 1;
    const nextUser = await reconcileSubscriberEntitlement(row.telegram_chat_id, row);
    if (String(nextUser?.status || "").toLowerCase() === "active" && String(row.status || "").toLowerCase() !== "active") {
      repaired += 1;
    }
  }

  return {
    checked,
    repaired
  };
}

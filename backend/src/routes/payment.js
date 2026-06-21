/**
 * payment.js — Razorpay Subscription Payment Flow
 *
 * Architecture: Razorpay Subscriptions (NOT Payment Links).
 *
 * Flow:
 *   1. createSubscriptionLink(chatId) → creates a Razorpay Subscription
 *      using RAZORPAY_PLAN_ID, stores sub ID in DB, returns hosted page URL.
 *   2. User pays → Razorpay fires subscription.activated → webhook activates PRO.
 *   3. Renewals fire invoice.paid / subscription.charged → webhook extends expiry.
 *   4. Cancellations fire subscription.cancelled → webhook downgrades.
 *
 * CONTRACT:
 *   - telegram_chat_id is ALWAYS stored in notes at subscription creation time.
 *   - razorpay_subscription_id is ALWAYS written to subscribers before returning URL.
 *   - All lifecycle events can find the user via razorpay_subscription_id lookup.
 */

import Razorpay from 'razorpay';
import supabase from '../services/supabase.service.js';
import { logEvent, logError } from '../services/telemetry.service.js';
import { fetchProviderSubscription, reconcileSubscriberEntitlement } from '../services/subscriptionReconciliation.service.js';

const hasRazorpayConfig =
  Boolean(process.env.RAZORPAY_KEY_ID) &&
  Boolean(process.env.RAZORPAY_KEY_SECRET);

const razorpay = hasRazorpayConfig
  ? new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET
    })
  : null;

if (!hasRazorpayConfig) {
  console.warn('[PAYMENT] Razorpay disabled: missing RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET');
}

function createPaymentProviderNotConfiguredError() {
  const error = new Error('Razorpay is not configured in this environment.');
  error.code = 'PAYMENT_PROVIDER_NOT_CONFIGURED';
  error.statusCode = 503;
  error.success = false;
  return error;
}

function requireRazorpay() {
  if (!razorpay) {
    throw createPaymentProviderNotConfiguredError();
  }

  return razorpay;
}

/**
 * Creates a Razorpay Subscription and returns its hosted payment page URL.
 * Stores the subscription ID in the DB immediately so webhook events can map
 * the subscription back to the telegram_chat_id.
 *
 * @param {string} chatId - Telegram chat ID (string)
 * @returns {{ url: string, subscriptionId: string }}
 */
export async function createSubscriptionLink(chatId) {
  const configuredRazorpay = requireRazorpay();
  const planId = process.env.RAZORPAY_PLAN_ID;
  if (!planId) {
    throw new Error('RAZORPAY_PLAN_ID environment variable is not set');
  }

  const { data: existingSubscriber, error: existingSubscriberError } = await supabase
    .from('subscribers')
    .select('telegram_chat_id,status,plan,is_pro,expires_at,subscription_end,cancel_at_period_end,razorpay_subscription_id,last_payment_at')
    .eq('telegram_chat_id', chatId.toString())
    .maybeSingle();

  if (existingSubscriberError) {
    throw existingSubscriberError;
  }

  const reconciledSubscriber = await reconcileSubscriberEntitlement(chatId.toString(), existingSubscriber);
  if (reconciledSubscriber?.razorpay_subscription_id) {
    const existingSubscription = await fetchProviderSubscription(reconciledSubscriber.razorpay_subscription_id).catch(() => null);
    if (String(existingSubscription?.status || '').toLowerCase() === 'active') {
      return {
        url: existingSubscription.short_url,
        subscriptionId: existingSubscription.id,
        alreadyActive: true
      };
    }
  }

  // Create a Razorpay Subscription object
  // total_count=120 means 120 billing cycles (10 years) — effectively perpetual.
  // The subscription fires subscription.activated, then invoice.paid on each renewal.
  const subscription = await configuredRazorpay.subscriptions.create({
    plan_id: planId,
    total_count: 120,
    quantity: 1,
    notes: {
      telegram_chat_id: chatId.toString()   // PRIMARY mapping — used by all webhook handlers
    }
  });

  logEvent('subscription.created', {
    subscriptionId: subscription.id,
    chatId,
    planId,
    status: subscription.status
  });

  // Write subscription ID to DB BEFORE returning the URL.
  // This ensures that even if the user pays immediately, the webhook handler
  // can always resolve telegram_chat_id from razorpay_subscription_id.
  const { error } = await supabase
    .from('subscribers')
    .upsert(
      {
        telegram_chat_id: chatId.toString(),
        razorpay_subscription_id: subscription.id,
        status: 'pending',
        plan: 'FREE',
        is_pro: false
      },
      { onConflict: 'telegram_chat_id' }
    );

  if (error) {
    logError('subscription.db_pre_write_failed', error, { chatId, subscriptionId: subscription.id });
    // We still return the URL — the webhook handler has a DB fallback lookup.
    // This prevents a DB hiccup from blocking the payment flow entirely.
    console.error('[PAYMENT] Pre-write to subscribers failed:', error.message);
  }

  // short_url is the hosted payment page Razorpay provides
  return {
    url: subscription.short_url,
    subscriptionId: subscription.id,
    alreadyActive: false
  };
}

// ─── Keep the old name as an alias so telegram.service.js import still works ─
// telegram.service.js calls: const { url } = await createPaymentLink(chatId);
// We rename the function but alias it for zero-touch migration.
export const createPaymentLink = createSubscriptionLink;


/**
 * Immediately cancels a Razorpay Subscription (no refund).
 * Razorpay will fire subscription.cancelled which the webhook handles.
 */
export async function cancelSubscriptionNow(subscriptionId) {
  const configuredRazorpay = requireRazorpay();
  return await configuredRazorpay.subscriptions.cancel(subscriptionId, false);
}

/**
 * Cancels a Razorpay Subscription at end of current billing cycle.
 * Razorpay fires subscription.cancelled after the cycle ends.
 */
export async function cancelSubscriptionLater(subscriptionId) {
  const configuredRazorpay = requireRazorpay();
  return await configuredRazorpay.subscriptions.cancel(subscriptionId, true);
}

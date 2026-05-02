import Razorpay from 'razorpay';
import supabase from '../services/supabase.service.js';

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

export async function createSubscriptionLink(chatId) {
  try {
    const subscription = await razorpay.subscriptions.create({
      plan_id: process.env.RAZORPAY_PLAN_ID,
      total_count: 12,
      customer_notify: 1,
      notes: {
        telegram_chat_id: chatId
      }
    });

    await supabase.from('subscribers').upsert({
      telegram_chat_id: chatId,
      razorpay_subscription_id: subscription.id,
      status: 'pending'
    });

    return { 
      url: subscription.short_url || `https://rzp.io/i/${subscription.id}`, 
      id: subscription.id 
    };
  } catch (err) {
    console.error("RAZORPAY SUBSCRIPTION CREATE ERROR:", JSON.stringify(err, null, 2));
    throw err;
  }
}

export async function cancelSubscriptionNow(subscriptionId) {
  return await razorpay.subscriptions.cancel(subscriptionId);
}

export async function cancelSubscriptionLater(subscriptionId) {
  return await razorpay.subscriptions.update(subscriptionId, {
    cancel_at_cycle_end: 1
  });
}
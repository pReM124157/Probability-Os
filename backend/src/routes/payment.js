import Razorpay from 'razorpay';
import supabase from '../services/supabase.service.js';

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

export async function createPaymentLink(chatId) {
  try {
    const link = await razorpay.paymentLink.create({
      amount: 59900, // ₹599
      currency: "INR",
      description: "FinSight Pro",
      customer: {
        name: "FinSight User"
      },
      notify: {
        sms: false,
        email: false
      },
      notes: {
        telegram_chat_id: chatId
      }
    });

    await supabase.from('subscribers').upsert({
      telegram_chat_id: chatId,
      status: 'pending',
      razorpay_payment_link_id: link.id
    });

    return { 
      url: link.short_url, 
      id: link.id 
    };
  } catch (err) {
    console.error("PAYMENT LINK ERROR:", err);
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

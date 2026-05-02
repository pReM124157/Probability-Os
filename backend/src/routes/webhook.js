import express from 'express';
import crypto from 'crypto';
import bot from '../services/telegram.service.js';
import supabase from '../services/supabase.service.js';

const router = express.Router();

router.post('/razorpay', express.raw({ type: 'application/json' }), async (req, res) => {
  console.log('🔥 Webhook endpoint HIT');

  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  const signature = req.headers['x-razorpay-signature'];

  if (!signature) {
    console.log('No signature found');
    return res.status(400).send('No signature');
  }

  const shasum = crypto.createHmac('sha256', secret);
  shasum.update(req.body);
  const digest = shasum.digest('hex');

  if (digest !== signature) {
    console.error('Invalid signature');
    return res.status(400).send('Invalid signature');
  }

  try {
    const data = JSON.parse(req.body);
    const event = data.event;
    const payload = data.payload;
    console.log("Webhook received:", event);


    if (event === 'subscription.activated') {
      const sub = payload.subscription.entity;
      let chatId = sub.notes?.telegram_chat_id;
      if (!chatId) {
        const { data } = await supabase
          .from('subscribers')
          .select('telegram_chat_id')
          .eq('razorpay_subscription_id', sub.id)
          .single();
        chatId = data?.telegram_chat_id;
      }
      console.log("ACTIVATING USER:", chatId);
      if (!chatId) return res.json({ status: 'no_user' });
      await supabase.from('subscribers').update({
        status: 'active',
        plan: 'pro',
        subscription_started_at: new Date(),
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      }).eq('telegram_chat_id', chatId);
      try {
        await bot.telegram.sendMessage(chatId,
          "🎉 Subscription Activated! You are now on FinSight Pro."
        );
      } catch(err) {}
    }

    if (event === 'invoice.paid') {
      const invoice = payload.invoice.entity;
      let chatId = invoice.notes?.telegram_chat_id;
      if (!chatId && invoice.subscription_id) {
        const { data: user } = await supabase
          .from('subscribers')
          .select('telegram_chat_id')
          .eq('razorpay_subscription_id', invoice.subscription_id)
          .single();
        chatId = user?.telegram_chat_id;
      }
      if (!chatId) {
        console.log("❌ No chatId for invoice:", invoice.id);
        return res.json({ status: 'no chat id' });
      }
      console.log("RENEWAL FOR:", chatId);
      await supabase
        .from('subscribers')
        .update({
          expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          status: 'active',
          plan: 'pro',
          last_payment_at: new Date().toISOString()
        })
        .eq('telegram_chat_id', chatId.toString());
      try {
        if (invoice.billing_reason === 'subscription_cycle') {
           await bot.telegram.sendMessage(chatId, "✅ FinSight Pro Subscription Renewed successfully!");
        }
      } catch(err) {}
    }

    if (event === 'subscription.cancelled') {
      const sub = payload.subscription.entity;
      let chatId = sub.notes?.telegram_chat_id;
      if (!chatId) {
        const { data: user } = await supabase
          .from('subscribers')
          .select('telegram_chat_id')
          .eq('razorpay_subscription_id', sub.id)
          .single();
        chatId = user?.telegram_chat_id;
      }
      if (!chatId) {
        console.log("❌ No chatId for cancellation:", sub.id);
        return res.json({ status: 'no chat id' });
      }
      console.log("CANCELLED:", chatId);
      await supabase
        .from('subscribers')
        .update({
          status: 'cancelled',
          plan: 'free'
        })
        .eq('telegram_chat_id', chatId.toString());
      try {
        await bot.telegram.sendMessage(chatId, "❌ Your FinSight Pro subscription has been cancelled.");
      } catch(err) {}
    }

    if (event === 'invoice.payment_failed') {
      const invoice = payload.invoice.entity;
      let chatId = invoice.notes?.telegram_chat_id;
      if (!chatId && invoice.subscription_id) {
        const { data: user } = await supabase
          .from('subscribers')
          .select('telegram_chat_id')
          .eq('razorpay_subscription_id', invoice.subscription_id)
          .single();
        chatId = user?.telegram_chat_id;
      }
      if (!chatId) {
        console.log("❌ No chatId for payment failed:", invoice.id);
        return res.json({ status: 'no chat id' });
      }
      const graceExpiry = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
      await supabase.from('subscribers')
        .update({
          status: 'grace',
          expires_at: graceExpiry
        })
        .eq('telegram_chat_id', chatId.toString());
      try {
        await bot.telegram.sendMessage(
          chatId,
          `⚠️ *Payment failed*\n\n` +
          `We'll retry automatically.\n` +
          `You still have access for 48 hours.\n` +
          `Update payment method to avoid interruption.`,
          { parse_mode: 'Markdown' }
        );
      } catch(err) {}
    }

    res.json({ status: 'ok' });
  } catch (err) {
    console.error("WEBHOOK ERROR:", JSON.stringify(err, null, 2));
    res.status(500).json({ error: 'Webhook processing error' });
  }
});

export default router;

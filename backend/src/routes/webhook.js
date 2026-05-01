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

  if (digest === signature) {
    const data = JSON.parse(req.body);
    console.log('Webhook received:', data.event);
    
    if (data.event === 'payment.captured' || data.event === 'payment_link.paid') {
      const paymentId = data.payload?.payment?.entity?.id;
      
      // 1. Idempotency check: Don't process the same payment twice
      const { data: existing } = await supabase
        .from('subscribers')
        .select('razorpay_payment_id')
        .eq('razorpay_payment_id', paymentId)
        .maybeSingle();

      if (existing) {
        console.log('⚠️ Duplicate payment ignored:', paymentId);
        return res.json({ status: 'duplicate' });
      }

      let chatId = null;
      if (data.payload?.payment?.entity?.notes?.telegram_chat_id) {
        chatId = data.payload.payment.entity.notes.telegram_chat_id;
      } else if (data.payload?.payment_link?.entity?.notes?.telegram_chat_id) {
        chatId = data.payload.payment_link.entity.notes.telegram_chat_id;
      }

      if (chatId) {
        try {
          // 2. Save/Activate subscriber in database
          await supabase.from('subscribers').upsert({
            telegram_chat_id: chatId.toString(),
            razorpay_payment_id: paymentId,
            status: 'active',
            plan: 'pro',
            expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
            updated_at: new Date()
          });

          // 3. Send Telegram confirmation
          await bot.telegram.sendMessage(
            chatId, 
            `🎉 Payment Successful! Welcome to FinSight Pro. Your premium access is now active.`
          );
          console.log(`✅ Confirmation sent to ${chatId} for payment ${paymentId}`);
        } catch (err) {
          console.error('Failed to process payment/confirmation:', err);
        }
      } else {
        console.log('No telegram_chat_id found in notes');
      }
    }
    res.json({ status: 'ok' });
  } else {
    console.error('Invalid signature');
    res.status(400).send('Invalid signature');
  }
});

export default router;

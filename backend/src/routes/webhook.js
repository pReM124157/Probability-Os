import express from 'express';
import crypto from 'crypto';
import bot from '../services/telegram.service.js';

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
      let chatId = null;
      if (data.payload?.payment?.entity?.notes?.telegram_chat_id) {
        chatId = data.payload.payment.entity.notes.telegram_chat_id;
      } else if (data.payload?.payment_link?.entity?.notes?.telegram_chat_id) {
        chatId = data.payload.payment_link.entity.notes.telegram_chat_id;
      }

      if (chatId) {
        try {
          await bot.telegram.sendMessage(
            chatId, 
            `🎉 Payment Successful! Welcome to FinSight Pro. Your premium access is now active.`
          );
        } catch (err) {
          console.error('Failed to send telegram confirmation:', err);
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

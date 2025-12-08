import { Router } from 'express';
import { config } from '../config.js';
import { findOrCreateConversationByPhone, addMessage } from '../services/conversationStore.js';
import { handleIncomingCustomerMessage } from '../services/botService.js';
import { sendTextMessage } from '../services/whatsappService.js';

const router = Router();

router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === config.whatsappVerifyToken) {
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

router.post('/', async (req, res, next) => {
  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];

    const customerPhone = message?.from;
    const messageId = message?.id;
    const messageText = message?.text?.body || '';

    console.log('Incoming WhatsApp message', {
      messageId,
      from: customerPhone,
      hasText: Boolean(messageText)
    });

    if (customerPhone && messageId) {
      const conversation = findOrCreateConversationByPhone(customerPhone);
      addMessage(conversation.id, 'CUSTOMER', messageText, messageId);
      await handleIncomingCustomerMessage(conversation, messageText);
    }

    res.sendStatus(200);
  } catch (err) {
    next(err);
  }
});

router.post('/debug/send', async (req, res, next) => {
  try {
    const { to, text } = req.body || {};
    if (!to || !text) {
      return res.status(400).json({ error: 'Expected body: { to, text }' });
    }

    await sendTextMessage(to, text);
    res.json({ status: 'sent' });
  } catch (err) {
    next(err);
  }
});

export default router;

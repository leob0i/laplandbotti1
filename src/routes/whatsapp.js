import { Router } from 'express';
import { config } from '../config.js';
import { findOrCreateConversationByPhone, addMessage } from '../services/conversationStore.js';
import { handleIncomingCustomerMessage } from '../services/botService.js';
import { sendTextMessage } from '../services/whatsappService.js';

const router = Router();

// WEBHOOK VERIFY (GET)
router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const rawToken = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const token = typeof rawToken === 'string' ? rawToken.trim() : '';
  const expected = (config.WHATSAPP_VERIFY_TOKEN || '').trim();

  if (mode === 'subscribe' && token && expected && token === expected && challenge) {
    console.log('[WHATSAPP] Webhook verify OK');
    return res.status(200).send(challenge);
  }

  console.warn('[WHATSAPP] Webhook verify FAILED', {
    mode,
    tokenReceived: token,
    expectedTokenLength: expected.length,
  });

  return res.sendStatus(403);
});

// INCOMING MESSAGES (POST)
router.post('/', async (req, res, next) => {
  try {
        // DEBUG: logataan koko raakadata, jotta nähdään mitä Meta oikeasti lähettää
    console.log('[WhatsApp] RAW WEBHOOK BODY:', JSON.stringify(req.body));

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

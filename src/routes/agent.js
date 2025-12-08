import { Router } from 'express';
import {
  listConversations,
  listMessages,
  getConversationById,
  addMessage,
  updateConversationStatus
} from '../services/conversationStore.js';
import { sendTextMessage } from '../services/whatsappService.js';
import { config } from "../config.js";

const router = Router();

/**
 * Simple Agent API auth middleware
 * - käyttää AGENT_API_KEY-env-muuttujaa
 * - jos AGENT_API_KEY on tyhjä → ei pakota authia (helpottaa dev/testikäyttöä)
 */
router.use((req, res, next) => {
  const expectedKey = config.AGENT_API_KEY;

  // Jos avainta ei ole konffattu, ei laiteta lukkoa päälle
  if (!expectedKey) {
    return next();
  }

  const providedKey =
    req.header("X-AGENT-KEY") ||
    req.header("x-agent-key") ||
    req.query.agentKey;

  if (!providedKey || providedKey !== expectedKey) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  next();
});

router.get('/conversations', (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const limit = parsePositiveInt(req.query.limit, 50);
  const offset = parsePositiveInt(req.query.offset, 0);

  const conversations = listConversations({ status, limit, offset });
  res.json({ conversations });
});

router.get('/conversations/:id/messages', (req, res) => {
  const conversation = getConversationById(req.params.id);
  if (!conversation) {
    return res.status(404).json({ error: 'Conversation not found' });
  }
  const messages = listMessages(req.params.id);
  res.json({ messages });
});

router.post('/conversations/:id/reply', async (req, res, next) => {
  try {
    const conversation = getConversationById(req.params.id);
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!text) {
      return res.status(400).json({ error: 'Missing text' });
    }

    addMessage(conversation.id, 'AGENT', text);
    updateConversationStatus(conversation.id, 'HUMAN');

    await sendTextMessage(conversation.customerPhone, text);

    res.status(202).json({ status: 'sent' });
  } catch (err) {
    next(err);
  }
});

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 0) return fallback;
  return parsed;
}

export default router;

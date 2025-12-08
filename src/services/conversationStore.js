import crypto from 'node:crypto';

const conversations = new Map(); // id -> conversation
const messages = new Map(); // conversationId -> Message[]

export function findOrCreateConversationByPhone(customerPhone) {
  const phone = typeof customerPhone === 'string' ? customerPhone.trim() : '';
  if (!phone) return null;

  const existing = [...conversations.values()].find((conv) => conv.customerPhone === phone);
  if (existing) return existing;

  const id = crypto.randomUUID();
  const now = new Date();
  const conversation = {
    id,
    customerPhone: phone,
    status: 'AUTO',
    lastMessageAt: now,
    createdAt: now,
    lastCustomerMessageAt: null,
    lastAgentReplyAt: null

  };
  conversations.set(id, conversation);
  messages.set(id, []);
  return conversation;
}

export function getConversationById(id) {
  return conversations.get(id) || null;
}

export function listConversations(options = {}) {
  const status = normalizeStatus(options.status);
  const offset = toSafeInteger(options.offset, 0);
  const limit = toSafeInteger(options.limit, 50);

  const filtered = [...conversations.values()].filter((conv) => {
    return status ? conv.status === status : true;
  });

  return filtered
    .sort((a, b) => b.lastMessageAt - a.lastMessageAt)
    .slice(offset, offset + limit);
}

export function updateConversationStatus(id, status) {
  const nextStatus = normalizeStatus(status);
  if (!nextStatus) return null;

  const conversation = conversations.get(id);
  if (!conversation) return null;
  conversation.status = nextStatus;
  return conversation;
}

export function addMessage(conversationId, from, text, waMessageId) {
  const conversation = conversations.get(conversationId);
  if (!conversation) return null;

  const bucket = messages.get(conversationId) || [];
  if (!messages.has(conversationId)) {
    messages.set(conversationId, bucket);
  }

  const now = new Date();
  const message = {
    id: crypto.randomUUID(),
    conversationId,
    from,
    text: typeof text === 'string' ? text : '',
    waMessageId,
    createdAt: now
  };

  bucket.push(message);
  conversation.lastMessageAt = now;

  // UUSI: pidetään kirjaa asiakkaan ja agentin viimeisistä viesteistä
  if (from === 'CUSTOMER') {
    conversation.lastCustomerMessageAt = now;
  } else if (from === 'AGENT') {
    conversation.lastAgentReplyAt = now;
  }

  return message;
}

export function listMessages(conversationId) {
  const bucket = messages.get(conversationId);
  return bucket ? [...bucket] : [];
}

function normalizeStatus(status) {
  return status === 'AUTO' || status === 'HUMAN' ? status : null;
}

function toSafeInteger(value, fallback) {
  const num = Number.parseInt(value, 10);
  if (Number.isNaN(num) || num < 0) return fallback;
  return num;
}

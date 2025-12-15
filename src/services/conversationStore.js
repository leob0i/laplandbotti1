import crypto from 'node:crypto';

const conversations = new Map(); // id -> conversation
const conversationIdByPhone = new Map(); // normalizedPhone -> conversationId

const messages = new Map(); // conversationId -> Message[]
const waMessageIndex = new Map(); // waMessageId -> { conversationId, messageId }

function normalizePhone(customerPhone) {
  const raw = typeof customerPhone === 'string' ? customerPhone.trim() : '';
  if (!raw) return null;

  // WhatsApp-webhookit antavat usein numeron ilman +:aa.
  // Normalisoidaan niin, että kaikki on pelkkiä numeroita.
  const digitsOnly = raw.replace(/[^\d]/g, '');
  return digitsOnly || null;
}

export function findOrCreateConversationByPhone(customerPhone) {
  const phone = normalizePhone(customerPhone);
  if (!phone) return null;

  const existingId = conversationIdByPhone.get(phone);
  if (existingId) {
    return conversations.get(existingId) || null;
  }

  const id = crypto.randomUUID();
  const now = new Date();

  const conversation = {
    id,
    customerPhone: phone,
    status: 'AUTO',
    lastMessageAt: now,
    createdAt: now,
    lastCustomerMessageAt: null,
    lastAgentReplyAt: null,
      // UUSI: peräkkäisten epävarmojen laskuri (1 = kysy tarkennus, 2 = HUMAN)
    uncertainCount: 0,

    // UUSI: (seuraavaa vaihetta varten) jos käyttäjä pyytää ihmistä, varmistetaan ensin kyllä/ei
     handoffConfirmPending: false

  };

  conversations.set(id, conversation);
  conversationIdByPhone.set(phone, id);
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

  // DEDUPE: WhatsApp/Meta voi retryttää saman eventin.
  // Jos tämä waMessageId on jo tallessa, palautetaan se olemassa oleva viesti.
  if (waMessageId && waMessageIndex.has(waMessageId)) {
    const ref = waMessageIndex.get(waMessageId);
    const bucket = messages.get(ref.conversationId) || [];
    return bucket.find((m) => m.id === ref.messageId) || null;
  }

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

  if (waMessageId) {
    waMessageIndex.set(waMessageId, { conversationId, messageId: message.id });
  }

  conversation.lastMessageAt = now;

  // pidetään kirjaa asiakkaan ja agentin viimeisistä viesteistä
  if (from === 'CUSTOMER') {
    conversation.lastCustomerMessageAt = now;
  } else if (from === 'AGENT') {
  conversation.lastAgentReplyAt = now;

  // COEXISTENCE-KRIITTINEN: jos ihminen vastasi, botti hiljenee
  conversation.status = 'HUMAN';

  // UUSI: agentti otti keissin -> nollataan botin "epävarmuus"-tila
  conversation.uncertainCount = 0;
  conversation.handoffConfirmPending = false;
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

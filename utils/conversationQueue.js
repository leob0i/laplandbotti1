// src/utils/conversationQueue.js
const chains = new Map(); // key (conversationId) -> Promise chain

export function enqueueConversation(conversationId, taskFn) {
  const prev = chains.get(conversationId) || Promise.resolve();

  // Ketjutetaan aina perään, ja varmistetaan että chain ei "katkea" virheeseen
  const next = prev
    .catch(() => {}) // swallow, ettei yksittäinen virhe blokkaa ketjua
    .then(() => taskFn());

  chains.set(conversationId, next);
  return next;
}

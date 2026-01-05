// src/utils/conversationQueue.js
const chains = new Map(); // key -> Promise chain

export function enqueueConversation(key, taskFn) {
  const k = String(key || "unknown");

  const prev = chains.get(k) || Promise.resolve();

  const next = prev
    .catch(() => {})      // swallow, ettei yksittäinen virhe blokkaa ketjua
    .then(taskFn)         // taskFn voi olla async
    .finally(() => {
      // siivoa vain jos ketju ei ole vaihtunut sillä välin
      if (chains.get(k) === next) chains.delete(k);
    });

  chains.set(k, next);
  return next;
}

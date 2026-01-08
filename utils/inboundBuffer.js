// utils/inboundBuffer.js
import { isAckOnly } from "./messageHeuristics.js";

/**
 * Buffer incoming messages per queueKey for a short window.
 * - Merges bursts into one combined message.
 * - Removes ACK-only lines if there is any real (non-ACK) content.
 * - Removes pure greeting-only lines if there is at least one question line.
 */

const buffers = new Map(); // queueKey -> { parts: string[], lastMeta: object, timer: Timeout }

function normalizeLite(s = "") {
  return s
    .toLowerCase()
    .trim()
    .replace(/[\p{P}\p{S}]+/gu, "") // punctuation/symbols/emojis
    .replace(/\s+/g, " ");
}

function isGreetingOnlyLine(line = "") {
  const t = normalizeLite(line);
  const greetings = new Set([
    "hi",
    "hello",
    "hey",
    "good morning",
    "good afternoon",
    "good evening",
    "morning",
    "evening",
    "hei",
    "moi",
    "moro",
  ]);
  return greetings.has(t);
}

function hasQuestionLine(lines = []) {
  return lines.some((l) => (l || "").includes("?"));
}

/**
 * @param {string} queueKey
 * @param {string} text
 * @param {object} meta - any metadata you want to pass through (e.g. { from, messageId })
 * @param {(combinedText: string, meta: object) => Promise<void>} flushFn
 * @param {number} delayMs
 */
export function bufferIncomingText(queueKey, text, meta, flushFn, delayMs = 1200) {
  const clean = (text || "").trim();
  if (!clean) return;

  const entry = buffers.get(queueKey) || { parts: [], lastMeta: {}, timer: null };

  entry.parts.push(clean);
  entry.lastMeta = { ...(entry.lastMeta || {}), ...(meta || {}) };

  if (entry.timer) clearTimeout(entry.timer);

  entry.timer = setTimeout(async () => {
    buffers.delete(queueKey);

    const parts = entry.parts.filter(Boolean);

    // 1) Drop ACK-only lines if any real content exists
    const hasNonAck = parts.some((p) => !isAckOnly(p));
    let filtered = hasNonAck ? parts.filter((p) => !isAckOnly(p)) : parts;

    // 2) If there is a question line, drop pure greeting lines (they cause noise)
    if (hasQuestionLine(filtered)) {
      filtered = filtered.filter((p) => !isGreetingOnlyLine(p));
    }

    const combined = filtered.join("\n").trim();
    if (!combined) return;

    try {
      await flushFn(combined, entry.lastMeta);
    } catch (err) {
      console.error("[BOT] inbound buffer flush failed:", err?.message || err);
    }
  }, delayMs);

  buffers.set(queueKey, entry);
}

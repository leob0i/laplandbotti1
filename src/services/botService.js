// src/services/botService.js
import { isBotActiveNow } from "./timeService.js";
import { findBestFaqMatch } from "./faqService.js";
import { sendTextMessage } from "./whatsappService.js";
import {
  addMessage,
  updateConversationStatus,
} from "./conversationStore.js";
import { config } from "../config.js";
import { rewriteFaqAnswer } from "./openaiService.js";

/**
 * Main handler for new customer messages.
 * - kuntautuu AUTO/HUMAN-tilaan (coexistence)
 * - huomioi aukioloajat
 * - käyttää FAQ-matchausta + OpenAI-rewritea
 */
export async function handleIncomingCustomerMessage(conversation, messageText) {
  if (!conversation || !conversation.id) {
    console.warn(
      "[Bot] handleIncomingCustomerMessage called without valid conversation"
    );
    return;
  }

  const timeoutMinutes = config.HUMAN_TIMEOUT_MINUTES;

  // 1. Jos HUMAN-tila, tarkista saako botti ottaa keissin takaisin
  if (conversation.status === "HUMAN") {
    // Jos timeout ei ole asetettu (>0), botti ei koskaan ota keissiä takaisin
    if (!timeoutMinutes || timeoutMinutes <= 0) {
      console.log(
        `[Bot] Conversation ${conversation.id} in HUMAN mode, no timeout configured -> bot stays silent.`
      );
      return;
    }

    const lastAgentReplyAt = conversation.lastAgentReplyAt;

    if (!lastAgentReplyAt) {
      // Ei tietoa agentin vastauksista → oletetaan että ihminen "omistaa" keissin
      console.log(
        `[Bot] Conversation ${conversation.id} in HUMAN mode but no lastAgentReplyAt -> bot stays silent.`
      );
      return;
    }

    const now = new Date();
    const lastAgentDate =
      lastAgentReplyAt instanceof Date
        ? lastAgentReplyAt
        : new Date(lastAgentReplyAt);

    const diffMs = now.getTime() - lastAgentDate.getTime();
    const timeoutMs = timeoutMinutes * 60 * 1000;

    if (diffMs < timeoutMs) {
      // Ihmisellä on vielä aikaa vastata → botti hiljaa
      console.log(
        `[Bot] Conversation ${conversation.id} in HUMAN mode, timeout not yet passed -> bot stays silent.`
      );
      return;
    }

    // 🔹 Timeout umpeutunut → botti saa yrittää taas.
    updateConversationStatus(conversation.id, "AUTO");
    conversation.status = "AUTO";
    console.log(
      `[Bot] HUMAN timeout passed for conversation ${conversation.id}, switching back to AUTO.`
    );
  }

  // 2. Tarkista aukioloajat
  const active = isBotActiveNow();
  if (!active) {
    console.log(
      `[Bot] Outside bot active hours, marking conversation ${conversation.id} as HUMAN (no auto reply).`
    );
    updateConversationStatus(conversation.id, "HUMAN");
    return;
  }

  // 3. Yritä FAQ-match
  const { faq, score } = await findBestFaqMatch(messageText);

  console.log(
    `[Bot] FAQ match for ${conversation.id}: score=${score.toFixed(
      3
    )}, faqId=${faq?.id}`
  );

  if (!faq || score < config.CONFIDENCE_THRESHOLD) {
    // Ei tarpeeksi varma → annetaan ihmiselle
    console.log(
      `[Bot] Score too low or no FAQ (score=${score.toFixed(
        3
      )}, threshold=${config.CONFIDENCE_THRESHOLD}) -> marking ${conversation.id} as HUMAN.`
    );
    updateConversationStatus(conversation.id, "HUMAN");
    return;
  }

  // 4. Varma FAQ-osuma → OpenAI voi säätää sitä (Phase 5)
  let replyText = faq.answer;

  const rewritten = await rewriteFaqAnswer(messageText, faq.answer);

  // Jos OpenAI sanoo että FAQ ei kata tätä → hiljaa ja HUMAN
  if (rewritten === "NO_VALID_ANSWER") {
    console.log(
      `[Bot] OpenAI returned NO_VALID_ANSWER for conversation ${conversation.id} -> marking as HUMAN.`
    );
    updateConversationStatus(conversation.id, "HUMAN");
    return;
  }

  // Muuten käytetään OpenAI:n hiottua tekstiä jos sellainen on
  if (rewritten && typeof rewritten === "string") {
    replyText = rewritten.trim();
  }

  if (!replyText) {
    console.log(
      `[Bot] replyText is empty after OpenAI rewrite for conversation ${conversation.id} -> marking as HUMAN.`
    );
    updateConversationStatus(conversation.id, "HUMAN");
    return;
  }

  // 5. Lähetä vastaus WhatsAppiin
  try {
    await sendTextMessage(conversation.customerPhone, replyText);
    console.log(
      `[Bot] Sent reply to ${conversation.customerPhone} for conversation ${conversation.id}.`
    );
  } catch (err) {
    console.error(
      `[Bot] Failed to send reply to ${conversation.customerPhone}:`,
      err?.message || err
    );
    // Lähetys epäonnistui → älä pakota statusta, anna agentin/monitoroinnin päättää
    return;
  }

  // 6. Tallenna BOT-viesti
  addMessage(conversation.id, "BOT", replyText);

  // Keskustelu jää AUTO-tilaan (botti saa vastata jatkossakin).
  console.log(
    `[Bot] Conversation ${conversation.id} remains in AUTO mode after bot reply.`
  );
}

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
 * - respects AUTO/HUMAN status
 * - respects working hours
 * - tries FAQ match
 */
export async function handleIncomingCustomerMessage(conversation, messageText) {
  const timeoutMinutes = config.HUMAN_TIMEOUT_MINUTES;

  // 1. Jos HUMAN-tila, tarkista saako botti ottaa keissin takaisin
  if (conversation.status === "HUMAN") {
    // Jos timeout ei ole asetettu (>0), botti ei koskaan ota keissiä takaisin
    if (!timeoutMinutes || timeoutMinutes <= 0) {
      return;
    }

    const lastAgentReplyAt = conversation.lastAgentReplyAt;
    if (!lastAgentReplyAt) {
      // Ei tietoa agentin vastauksista → oletetaan että ihminen "omistaa" keissin
      return;
    }

    const now = new Date();
    const diffMs = now.getTime() - lastAgentReplyAt.getTime();
    const timeoutMs = timeoutMinutes * 60 * 1000;

    if (diffMs < timeoutMs) {
      // Ihmisellä on vielä aikaa vastata → botti hiljaa
      return;
    }

    // 🔹 Timeout umpeutunut → botti saa yrittää taas.
    // Vaihdetaan tila takaisin AUTO ennen logiikan jatkamista.
    updateConversationStatus(conversation.id, "AUTO");
    conversation.status = "AUTO";
  }

  // 2. Tarkista aukioloajat
  const active = isBotActiveNow();
  if (!active) {
    // Bot should not auto-reply
    updateConversationStatus(conversation.id, "HUMAN");
    return;
  }

  // 3. Yritä FAQ-match
  const { faq, score } = await findBestFaqMatch(messageText);

  if (!faq || score < config.CONFIDENCE_THRESHOLD) {
    // Ei tarpeeksi varma → annetaan ihmiselle
    updateConversationStatus(conversation.id, "HUMAN");
    return;
  }

  // 4. Varma FAQ-osuma → OpenAI voi säätää sitä (Phase 5)
  let replyText = faq.answer;

  const rewritten = await rewriteFaqAnswer(messageText, faq.answer);

  // Jos OpenAI sanoo että FAQ ei kata tätä → hiljaa ja HUMAN
  if (rewritten === "NO_VALID_ANSWER") {
    updateConversationStatus(conversation.id, "HUMAN");
    return;
  }

  // Muuten käytetään OpenAI:n hiottua tekstiä jos sellainen on
  if (rewritten && typeof rewritten === "string") {
    replyText = rewritten;
  }

  await sendTextMessage(conversation.customerPhone, replyText);

  // 5. Tallenna BOT-viesti
  addMessage(conversation.id, "BOT", replyText);

  // Keskustelu jää AUTO-tilaan (botti saa vastata jatkossakin).
}

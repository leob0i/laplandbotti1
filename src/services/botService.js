// src/services/botService.js
import { isBotActiveNow } from "./timeService.js";
import { findBestFaqMatch, findTopFaqCandidates } from "./faqService.js";
import { sendTextMessage } from "./whatsappService.js";
import { addMessage, updateConversationStatus } from "./conversationStore.js";
import { config } from "../config.js";
import { rewriteFaqAnswer, decideFaqAnswerFromCandidates } from "./openaiService.js";

function detectLang(text) {
  const t = (text || "").toLowerCase();

  // kevyt heuristiikka: riittää clarify/handoff -viesteihin
  const fiHints = [
    "ä",
    "ö",
    "moi",
    "hei",
    "haluan",
    "miten",
    "paljon",
    "kiitos",
    "voinko",
    "onko",
  ];
  const score = fiHints.reduce((s, w) => s + (t.includes(w) ? 1 : 0), 0);

  return score >= 2 ? "fi" : "en";
}

function clarifyText(lang) {
  return lang === "fi"
    ? "Varmistaisitko vielä: mitä tarkalleen tarkoitat? (Esim. minkä palvelun/aktiviteetin tai asian kysymys koskee.)"
    : "Could you clarify what you mean? (For example, which service/activity or topic your question is about.)";
}

function handoffText(lang) {
  return lang === "fi"
    ? "Kiitos. En ole tästä riittävän varma FAQ:n perusteella, joten ohjaan tämän ihmiselle. Saat vastauksen heti kun ihminen ehtii mukaan."
    : "Thanks. I’m not confident based on the FAQ, so I’m handing this over to a human. You’ll get a reply as soon as a person joins.";
}

function isHumanRequest(text) {
  const t = (text || "").toLowerCase();
  return [
    "haluan jutella ihmisen kanssa",
    "haluan puhua ihmiselle",
    "ihminen",
    "asiakaspalvelija",
    "agent",
    "human",
    "real person",
    "talk to a human",
    "speak to a human",
    "customer service",
  ].some((p) => t.includes(p));
}

function isYes(text) {
  const t = (text || "").trim().toLowerCase();
  // hyväksyy myös "kyll�" / "kylla" / "kyllä kiitos" jne.
  return /^(yes|y|yeah|yep|ok|okay|sure|kyll|joo|juu)\b/.test(t);
}

function isNo(text) {
  const t = (text || "").trim().toLowerCase();
  return /^(no|n|nope|nah|ei|en)\b/.test(t);
}

function isGreeting(text = "") {
  // Tunnistaa "pelkän tervehdyksen" jotta "hi what is..." ei jää jumiin greetingiin
  const t = String(text)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9äöå\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // hyväksytään lyhyet tervehdysviestit (1–3 sanaa)
  const words = t ? t.split(" ") : [];
  if (words.length === 0 || words.length > 3) return false;

  return /^(hi|hello|hey|moi|hei|morjens|terve)$/.test(words[0]);
}

function greetingReply(lang) {
  return lang === "fi"
    ? "Hei! Voin auttaa retkiin, aikatauluihin, tapaamispaikkoihin, hintoihin ja varauksiin liittyvissä kysymyksissä. Mitä haluaisit tietää?"
    : "Hi! I can help with questions about our tours, schedules, meeting points, pricing, and bookings. What would you like to know?";
}


function humanConfirmText(lang) {
  return lang === "fi"
    ? "Pyydänkö ihmisen tähän keskusteluun? Silloin saatat joutua odottamaan hetken, kunnes ihminen ehtii vastaamaan. (Vastaa: kyllä / ei)"
    : "Do you want me to bring a human into this chat? You may need to wait a moment until a person replies. (Reply: yes / no)";
}

function stayWithBotText(lang) {
  return lang === "fi"
    ? "Selvä — jatketaan botin kanssa. Kerro vielä tarkemmin kysymyksesi."
    : "Okay — we can continue with the bot. Please tell me your question in a bit more detail.";
}

function humanHandoffText(lang) {
  return lang === "fi"
    ? "Kiitos. Ohjaan keskustelun ihmiselle. Saat vastauksen heti kun ihminen ehtii mukaan."
    : "Thanks. I’m handing this over to a human. You’ll get a reply as soon as a person joins.";
}


async function sendAndStoreBotMessage(conversation, text) {
  try {
    await sendTextMessage(conversation.customerPhone, text);
  } catch (err) {
    console.error(
      `[Bot] sendTextMessage failed (storing anyway) to ${conversation.customerPhone}:`,
      err?.message || err
    );
  }
  addMessage(conversation.id, "BOT", text);
}

async function handleUncertain(conversation, messageText, clarifyOverride) {
  const lang = detectLang(messageText);

  const current = Number.isFinite(conversation.uncertainCount)
    ? conversation.uncertainCount
    : 0;

  const next = current + 1;

  // 2 epävarmaa peräkkäin -> HUMAN (ei varmistuskysymystä, koska käyttäjä ei pyytänyt ihmistä)
  if (next >= 2) {
    updateConversationStatus(conversation.id, "HUMAN");
    conversation.status = "HUMAN";
    conversation.uncertainCount = 0;

    const text = handoffText(lang);
    try {
      await sendAndStoreBotMessage(conversation, text);
    } catch (err) {
      console.error(
        `[Bot] Failed to send HUMAN handoff message to ${conversation.customerPhone}:`,
        err?.message || err
      );
    }
    return;
  }

  // 1 epävarma -> kysy tarkennus ja pysy AUTO-tilassa
  const text =
    typeof clarifyOverride === "string" && clarifyOverride.trim()
      ? clarifyOverride.trim()
      : clarifyText(lang);

  try {
    await sendAndStoreBotMessage(conversation, text);
    conversation.uncertainCount = next; // kirjataan vasta onnistuneen lähetyksen jälkeen
  } catch (err) {
    console.error(
      `[Bot] Failed to send clarify message to ${conversation.customerPhone}:`,
      err?.message || err
    );
  }
}



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

    // 2.5) Jos odotetaan varmistusta ihmiseen siirrosta (kyllä/ei)
  if (conversation.handoffConfirmPending) {
    const lang = detectLang(messageText);

    if (isYes(messageText)) {
      conversation.handoffConfirmPending = false;
      conversation.uncertainCount = 0;

      updateConversationStatus(conversation.id, "HUMAN");
      conversation.status = "HUMAN";

      try {
        await sendTextMessage(conversation.customerPhone, humanHandoffText(lang));
        addMessage(conversation.id, "BOT", humanHandoffText(lang));
      } catch (err) {
        console.error(`[Bot] Failed to send human handoff confirm message:`, err?.message || err);
      }
      return;
    }

    if (isNo(messageText)) {
      conversation.handoffConfirmPending = false;
      conversation.uncertainCount = 0;

      try {
        await sendTextMessage(conversation.customerPhone, stayWithBotText(lang));
        addMessage(conversation.id, "BOT", stayWithBotText(lang));
      } catch (err) {
        console.error(`[Bot] Failed to send stay-with-bot message:`, err?.message || err);
      }
      return;
    }

    // Jos vastaus ei ole selkeä kyllä/ei -> kysytään sama varmistus uudelleen
    try {
      await sendTextMessage(conversation.customerPhone, humanConfirmText(lang));
      addMessage(conversation.id, "BOT", humanConfirmText(lang));
    } catch (err) {
      console.error(`[Bot] Failed to send human confirm prompt:`, err?.message || err);
    }
    return;
  }

  // 2.6) Jos käyttäjä pyytää ihmistä -> varmistetaan (ei lukita heti)
  if (isHumanRequest(messageText)) {
    const lang = detectLang(messageText);
    conversation.handoffConfirmPending = true;

    try {
      await sendTextMessage(conversation.customerPhone, humanConfirmText(lang));
      addMessage(conversation.id, "BOT", humanConfirmText(lang));
    } catch (err) {
      console.error(`[Bot] Failed to send human confirm prompt:`, err?.message || err);
    }
    return;
  }

    // 2.7) Pelkkä tervehdys -> vastaa ammattimaisesti (ei FAQ/OpenAI)
  if (isGreeting(messageText)) {
    const lang = detectLang(messageText);
    const text = greetingReply(lang);

    try {
      await sendAndStoreBotMessage(conversation, text);
      conversation.uncertainCount = 0; // tervehdys ei ole "epävarma"
    } catch (err) {
      console.error(
        `[Bot] Failed to send greeting to ${conversation.customerPhone}:`,
        err?.message || err
      );
    }
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
  console.log(
    `[Bot] Score too low or no FAQ (score=${score.toFixed(
      3
    )}, threshold=${config.CONFIDENCE_THRESHOLD}) -> trying OpenAI decider (count=${
      conversation.uncertainCount || 0
    }).`
  );

  // 1) hae top-N FAQ-ehdokkaat
const candidates = await findTopFaqCandidates(messageText, config.OPENAI_DECIDER_TOPK);


  // 2) jos ei avainta tai ei ehdokkaita -> vanha käytös
  if (!config.OPENAI_API_KEY || !candidates || candidates.length === 0) {
    await handleUncertain(conversation, messageText);
    return;
  }

  // 3) OpenAI päättää: answer vs clarify (FAQ-only)
  const decision = await decideFaqAnswerFromCandidates(messageText, candidates);
  const minConf = Number(config.OPENAI_DECIDER_MIN_CONFIDENCE ?? 0.65);
const hasIds = Array.isArray(decision?.faqIdsUsed) && decision.faqIdsUsed.length > 0;


  // 4) jos OpenAI pystyy vastaamaan, vastaa heti ja nollaa uncertainCount
  if (
  decision?.type === "answer" &&
  typeof decision?.confidence === "number" &&
  decision.confidence >= minConf &&
  hasIds &&
  typeof decision.text === "string" &&
  decision.text.trim()
) {
  const replyText = decision.text.trim();

  console.log(
    `[Bot] Decider ANSWER for ${conversation.id}: confidence=${decision.confidence.toFixed(
      2
    )}, faqIdsUsed=${decision.faqIdsUsed.join(",")}`
  );

  try {
    await sendTextMessage(conversation.customerPhone, replyText);
    console.log(
      `[Bot] Sent decider reply to ${conversation.customerPhone} for conversation ${conversation.id}.`
    );
    conversation.uncertainCount = 0;
  } catch (err) {
    console.error(
      `[Bot] Failed to send decider reply to ${conversation.customerPhone}:`,
      err?.message || err
    );
    return;
  }

  addMessage(conversation.id, "BOT", replyText);
  console.log(
    `[Bot] Conversation ${conversation.id} remains in AUTO mode after decider reply.`
  );
  return;
}


  // 5) muuten: clarify (1x) / HUMAN (2x) käyttäen deciderin kysymystä jos sellainen on
  const clarifyOverride =
    typeof decision?.text === "string" && decision.text.trim() ? decision.text.trim() : null;

  await handleUncertain(conversation, messageText, clarifyOverride);
  return;
}

  // 4. Varma FAQ-osuma → OpenAI voi säätää sitä (Phase 5)
  let replyText = faq.answer;

  const rewritten = await rewriteFaqAnswer(messageText, faq.answer);

  // Jos OpenAI sanoo että FAQ ei kata tätä → clarify (1x) tai HUMAN (2x)
  if (rewritten === "NO_VALID_ANSWER") {
    console.log(
      `[Bot] OpenAI returned NO_VALID_ANSWER for conversation ${conversation.id} -> uncertain (count=${
        conversation.uncertainCount || 0
      }).`
    );

    await handleUncertain(conversation, messageText);
    return;
  }

  // Muuten käytetään OpenAI:n hiottua tekstiä jos sellainen on
  if (rewritten && typeof rewritten === "string") {
    replyText = rewritten.trim();
  }

  if (!replyText) {
    console.log(
      `[Bot] replyText is empty after OpenAI rewrite for conversation ${conversation.id} -> uncertain (count=${
        conversation.uncertainCount || 0
      }).`
    );

    await handleUncertain(conversation, messageText);
    return;
  }

  // 5. Lähetä vastaus WhatsAppiin
  try {
    await sendTextMessage(conversation.customerPhone, replyText);
    console.log(
      `[Bot] Sent reply to ${conversation.customerPhone} for conversation ${conversation.id}.`
    );

    // UUSI: onnistunut vastaus -> nollataan epävarmuuslaskuri
    conversation.uncertainCount = 0;
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

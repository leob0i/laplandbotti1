// src/services/botService.js
import { isBotActiveNow } from "./timeService.js";
import { sendTextMessage } from "./whatsappService.js";
import { addMessage, updateConversationStatus } from "./conversationStore.js";
import { config } from "../config.js";
import { rewriteFaqAnswer, decideFaqAnswerFromCandidates } from "./openaiService.js";
import { fingerprint } from "../../utils/textFingerprint.js";
import {
  isQuestion,
  looksLikeIntroOrBooking,
  extractFirstName,
  isShortClarifier,
  isAckOnly,
} from "../../utils/messageHeuristics.js";

import { findBestFaqMatch, findTopFaqCandidates, getFaqById } from "./faqService.js";






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
    ? "TÄSSÄ KOHTAA BOTTI HILJENEE JA ODOTTAA ETTÄ IHMINEN VASTAA. TESTI VAIHEESSA BOTTI KUITENIKN PALAA NOIN 1MIN SISÄLLÄ TAKAISIN. TUOTANNOSSA ESIM 10/UUDENVIESTIN TAI BOTTI EI ENÄÄN PALAA TAKAISIN.)"
    : "TÄSSÄ KOHTAA BOTTI HILJENEE JA ODOTTAA ETTÄ IHMINEN VASTAA. TESTI VAIHEESSA BOTTI KUITENIKN PALAA NOIN 1MIN SISÄLLÄ TAKAISIN. TUOTANNOSSA ESIM 10/UUDENVIESTIN TAI BOTTI EI ENÄÄN PALAA TAKAISIN.)";
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

function isLikelyFollowUp(text = "") {
  const t = String(text).trim().toLowerCase();
  if (!t) return false;

  // tyypillisesti follow-upit ovat lyhyitä
  if (t.length > 45) return false;

  const signals = [
    "it",
    "this",
    "that",
    "guarantee",
    "guaranteed",
    "quaranteed",
    "really",
    "yes",
    "no",
    "ok",
    "okay",
    "sure",
    "taattu",
    "takuu",
    "hyvitys",
    "rahanpalautus",
    "uusinta",
  ];

  return signals.some((s) => t.includes(s));
}

function looksLikeGuaranteeIntent(text = "") {
  const t = String(text).toLowerCase();
  return [
    "guarantee",
    "guaranteed",
    "quaranteed",
    "100%",
    "refund",
    "money back",
    "rebook",
    "retry",
    "taattu",
    "takuu",
    "hyvitys",
    "rahanpalautus",
    "uusinta",
  ].some((k) => t.includes(k));
}

/**
 * Rakentaa "tehokkaamman" FAQ-hakutekstin:
 * - follow-up: yhdistää edellisen merkityksellisen viestin
 * - intent boost: jos kysymys on guarantee-tyyppinen, lisätään vahvistavat sanat
 */
function buildFaqQueryText(messageText, prevMeaningfulText) {
  const clean = String(messageText || "").trim();
  let q = clean;

  if (prevMeaningfulText && isLikelyFollowUp(clean)) {
    q = `${String(prevMeaningfulText).trim()} ${clean}`;
  }

    if (looksLikeGuaranteeIntent(clean)) {
    // yleinen "guarantee/refund/retry" intentti
    q = `${q} guarantee policy`;

    // Lisää "northern lights" vain jos kontekstissa viitataan auroraan/revontuliin
    const context = `${clean} ${String(prevMeaningfulText || "")}`.toLowerCase();
    if (
      context.includes("aurora") ||
      context.includes("northern lights") ||
      context.includes("revontul")
    ) {
      q = `${q} northern lights`;
    }
  }


  return q;
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

function markHumanOwnershipStart(conversation) {
  // Käytetään lastAgentReplyAt-kenttää myös silloin, kun botti itse siirtää HUMANiin,
  // jotta HUMAN_TIMEOUT_MINUTES voi palauttaa AUTOon.
  conversation.lastAgentReplyAt = new Date();
}



async function sendAndStoreBotMessage(conversation, text) {
  const msg = String(text || "").trim();
  if (!msg) return false;

  // estä identtinen peräkkäinen bottiviesti (esim. kun käyttäjä sanoo "ok thanks")
  const fp = fingerprint(msg);
  const now = Date.now();
  const NO_REPEAT_MS = 10 * 60 * 1000; // 10 min

  if (
    conversation.lastBotFp &&
    conversation.lastBotFp === fp &&
    conversation.lastBotFpAt &&
    now - conversation.lastBotFpAt < NO_REPEAT_MS
  ) {
    console.log("[BOT] Suppressed duplicate reply");
return false; // ei lähetetty nyt -> ei state-muutoksia kutsujassa

  }

  let sentOk = false;

  try {
    await sendTextMessage(conversation.customerPhone, msg);
    sentOk = true;

    // merkitään dupe-suoja vasta kun lähetys onnistui
    conversation.lastBotFp = fp;
    conversation.lastBotFpAt = now;
  } catch (err) {
    console.error(
      `[Bot] sendTextMessage failed (storing anyway) to ${conversation.customerPhone}:`,
      err?.message || err
    );
  }

  addMessage(conversation.id, "BOT", msg);
  return sentOk;
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

    markHumanOwnershipStart(conversation);


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
  const sent = await sendAndStoreBotMessage(conversation, text);
  if (sent) conversation.uncertainCount = next;
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

let lastAgentReplyAt = conversation.lastAgentReplyAt;

if (!lastAgentReplyAt) {
  console.log(
    `[Bot] Conversation ${conversation.id} in HUMAN mode but no lastAgentReplyAt -> starting timeout window now.`
  );
  markHumanOwnershipStart(conversation);
  lastAgentReplyAt = conversation.lastAgentReplyAt; // tärkeä: päivitä arvo
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
    conversation.status = "HUMAN";

    markHumanOwnershipStart(conversation);

    return;
  }

    // 2.5) Jos odotetaan varmistusta ihmiseen siirrosta (kyllä/ei)
  if (conversation.handoffConfirmPending) {
    const lang = detectLang(messageText);

  if (isYes(messageText)) {
  conversation.handoffConfirmPending = false;

  updateConversationStatus(conversation.id, "HUMAN");
  conversation.status = "HUMAN";

  markHumanOwnershipStart(conversation);

  try {
    const sent = await sendAndStoreBotMessage(conversation, humanHandoffText(lang));
    if (sent) conversation.uncertainCount = 0;
  } catch (err) {
    console.error(
      `[Bot] Failed to send human handoff confirm message:`,
      err?.message || err
    );
  }
  return;
}


if (isNo(messageText)) {
  conversation.handoffConfirmPending = false;

  try {
    const sent = await sendAndStoreBotMessage(conversation, stayWithBotText(lang));
    if (sent) conversation.uncertainCount = 0;
  } catch (err) {
    console.error(
      `[Bot] Failed to send stay-with-bot message:`,
      err?.message || err
    );
  }
  return;
}


    

    // Jos vastaus ei ole selkeä kyllä/ei -> kysytään sama varmistus uudelleen
    try {
      await sendAndStoreBotMessage(conversation, humanConfirmText(lang));
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
      await sendAndStoreBotMessage(conversation, humanConfirmText(lang));
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
  const sent = await sendAndStoreBotMessage(conversation, text);
  if (sent) conversation.uncertainCount = 0;
} catch (err) {
      console.error(
        `[Bot] Failed to send greeting to ${conversation.customerPhone}:`,
        err?.message || err
      );
    }
    return;
  }

    // 2.74) ACK-only -> pysy hiljaa (ei yhdistelyä, ei FAQ/decideria, ei state-muutoksia)
  if (isAckOnly(messageText)) {
    console.log("[BOT] Auto-silence ACK", {
      from: conversation.customerPhone,
      queueKey: conversation.customerPhone,
      text: String(messageText || "").trim(),
    });
    return;
  }


// 2.75) Professional handling: short clarifiers + intro/booking statements
let userQuestion = String(messageText || "").trim();

// 1) Lyhyet tarkennukset liitetään edelliseen kysymykseen (konteksti)
if (isShortClarifier(userQuestion) && conversation?.lastUserQuestionText) {
  userQuestion = `${String(conversation.lastUserQuestionText).trim()} ${userQuestion}`.trim();
}

// 2) Intro/statement ei saa mennä decideriin (ei ole kysymys)
const questionLike = isQuestion(userQuestion);

if (!questionLike && looksLikeIntroOrBooking(userQuestion)) {
  const name = extractFirstName(userQuestion);
  if (name) conversation.customerName = name;

  const who = conversation.customerName ? ` ${conversation.customerName}` : "";

  const ack = `Hello${who}. Thanks for the details. How can we help with your aurora hunt booking?`;

  try {
    await sendAndStoreBotMessage(conversation, ack);
  } catch (err) {
    console.error(
      `[Bot] Failed to send intro/booking ack to ${conversation.customerPhone}:`,
      err?.message || err
    );
  }
  return;
}

// 3) Tallenna “viimeisin kysymys” kontekstia varten (vain jos tämä oli oikeasti kysymys)
if (questionLike) {
  conversation.lastUserQuestionText = userQuestion;
  conversation.lastUserQuestionAt = Date.now();
}



  // 2.8) Tallennetaan "merkityksellinen" viimeisin käyttäjäviesti follow-up-kontekstia varten.
  // Huom: Tätä EI tehdä greeting/handoffConfirmPending/humanRequest -poluissa, koska niistä palataan jo aiemmin.
  const prevMeaningfulText = conversation.lastMeaningfulUserText || null;
  conversation.lastMeaningfulUserText = messageText;
  conversation.lastUserAt = new Date();

  // Follow-up + intent-boost -hakuteksti (ei muuta HUMAN/coexistence-logiikkaa)
  const faqQueryText = buildFaqQueryText(userQuestion, prevMeaningfulText);

  console.log(
    `[Bot] FAQ query for ${conversation.id}: "${faqQueryText}" (orig="${messageText}")`
  );

  const DURATION_RE = /\b(how long|duration|how many hours|length|take|kauanko|kesto|kuinka kauan)\b/i;

if (DURATION_RE.test(userQuestion)) {
  const durationFaq = getFaqById("aurora_duration");
  if (durationFaq?.answer) {
    try {
      const sent = await sendAndStoreBotMessage(conversation, durationFaq.answer);
      if (sent) conversation.uncertainCount = 0;
    } catch (err) {
      console.error(`[Bot] Failed to send duration reply:`, err?.message || err);
    }
    return;
  }
}


  // 3. Yritä FAQ-match
  const { faq, score } = await findBestFaqMatch(faqQueryText);

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
const candidates = await findTopFaqCandidates(faqQueryText, config.OPENAI_DECIDER_TOPK);



  // 2) jos ei avainta tai ei ehdokkaita -> vanha käytös
  if (!config.OPENAI_API_KEY || !candidates || candidates.length === 0) {
    await handleUncertain(conversation, messageText);
    return;
  }

  // 3) OpenAI päättää: answer vs clarify (FAQ-only)
  const decision = await decideFaqAnswerFromCandidates(faqQueryText, candidates);

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
  const sent = await sendAndStoreBotMessage(conversation, replyText);
  if (sent) conversation.uncertainCount = 0;
} catch (err) {
    console.error(
      `[Bot] Failed to send decider reply to ${conversation.customerPhone}:`,
      err?.message || err
    );
    return;
  }

  console.log(
    `[Bot] Conversation ${conversation.id} remains in AUTO mode after decider reply.`
  );
  return;
}


 // 5) muuten: jos meillä on jo kohtalainen FAQ-osuma, vastaa sillä (soft fallback)
// Tämä vähentää turhaa clarify-tilaa silloin kun decider failaa validoinnissa.
const SOFT_FALLBACK_SCORE = Number(config.SOFT_FALLBACK_SCORE ?? 0.40);

if (faq && typeof score === "number" && score >= SOFT_FALLBACK_SCORE) {
  console.log(
    `[Bot] Decider fallback -> replying with best FAQ (faqId=${faq.id}, score=${score.toFixed(3)})`
  );

  const rewritten = await rewriteFaqAnswer(messageText, faq.answer);
  if (rewritten === "NO_VALID_ANSWER") {
    // jos rewrite ei voi vastata FAQ:sta, mennään epävarmaan polkuun
  } else {
    const replyText = (rewritten && typeof rewritten === "string")
      ? rewritten.trim()
      : String(faq.answer || "").trim();

    if (replyText) {
      await sendAndStoreBotMessage(conversation, replyText);
      conversation.uncertainCount = 0;
      return;
    }
  }
}

// muuten: clarify/handoff kuten ennen
const clarifyOverride =
  typeof decision?.text === "string" && decision.text.trim() ? decision.text.trim() : null;

await handleUncertain(conversation, messageText, clarifyOverride);
return;

}

// 3.5) Guarantee / follow-up -> prefer decider even if FAQ match is strong.
// Reason: decider can safely combine multiple FAQ entries (with grounding rules).
if (
  config.OPENAI_API_KEY &&
  (looksLikeGuaranteeIntent(faqQueryText) || isLikelyFollowUp(messageText))
) {
  console.log(
    `[Bot] Intent path -> using OpenAI decider for ${conversation.id} even though FAQ score is ${score.toFixed(
      3
    )} (faqId=${faq?.id}).`
  );

  const candidates = await findTopFaqCandidates(
    faqQueryText,
    config.OPENAI_DECIDER_TOPK
  );

  if (candidates && candidates.length > 0) {
    const decision = await decideFaqAnswerFromCandidates(faqQueryText, candidates);

    const minConf = Number(config.OPENAI_DECIDER_MIN_CONFIDENCE ?? 0.65);
    const hasIds = Array.isArray(decision?.faqIdsUsed) && decision.faqIdsUsed.length > 0;

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
        `[Bot] Decider ANSWER (intent path) for ${conversation.id}: confidence=${decision.confidence.toFixed(
          2
        )}, faqIdsUsed=${decision.faqIdsUsed.join(",")}`
      );

      try {
        await sendAndStoreBotMessage(conversation, replyText);
        conversation.uncertainCount = 0;
        return;
      } catch (err) {
        console.error(
          `[Bot] Failed to send decider reply (intent path) to ${conversation.customerPhone}:`,
          err?.message || err
        );
        // Jos lähetys epäonnistui, pudotaan varman FAQ-osuman rewrite-polkuun (ei muuteta statusta)
      }
    } else {
      console.log(
        `[Bot] Decider did not produce an answer on intent path (type=${decision?.type}, conf=${decision?.confidence}). Falling back to rewriteFaqAnswer.`
      );
    }
  }
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
    await sendAndStoreBotMessage(conversation, replyText);
    console.log(
      `[Bot] Sent reply to ${conversation.customerPhone} for conversation ${conversation.id}.`
    );
    conversation.uncertainCount = 0;
  } catch (err) {
    console.error(
      `[Bot] Failed to send reply to ${conversation.customerPhone}:`,
      err?.message || err
    );
    // Lähetys epäonnistui → älä pakota statusta, anna agentin/monitoroinnin päättää
    return;
  }

  // Keskustelu jää AUTO-tilaan (botti saa vastata jatkossakin).
  console.log(
    `[Bot] Conversation ${conversation.id} remains in AUTO mode after bot reply.`
  );
}

// src/services/openaiService.js
import OpenAI from "openai";
import { config } from "../config.js";

function toNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.floor(n));
}


/**
 * Kevyt kielivihje: riittää tähän vaiheeseen.
 * (Myöhemmin voidaan tehdä parempi tunnistus.)
 */
function detectLanguageHint(text = "") {
  const t = text.toLowerCase();

  // Finnish-ish signals
  if (/[äöå]/i.test(text)) return "fi";
  if (
    /\b(mitä|paljonko|kuinka|missä|milloin|voiko|hinta|maksaa|tarjous|aloitus|varaus|peruutus)\b/.test(
      t
    )
  ) {
    return "fi";
  }

  // Default to English
  return "en";
}

function getDefaultClarifyText(lang) {
  return lang === "fi"
    ? "Varmistaisitko vielä, mitä retkeä tai palvelua kysymyksesi koskee (esim. Group Tour / Small Group Tour)?"
    : "Could you clarify which tour or service you mean (for example, the Group Tour or the Small Group Tour)?";
}


function buildSystemPrompt(languageHint) {
  const langLine = languageHint === "fi" ? "Reply in Finnish." : "Reply in English.";

  return [
    "You are a customer service assistant for Lapland Explorers.",
    "You MUST use ONLY the provided FAQ answer content. Do NOT add any new facts, prices, policies, deadlines, or promises.",
    "Guarantee wording rule (CRITICAL):",
    "Never claim that the Northern Lights / aurora themselves are guaranteed to be seen.",
    "If the user asks about 'guarantee', treat it as the guarantee POLICY/experience described in the FAQ text (refund/reschedule/no-aurora policy), without strengthening the promise beyond the FAQ wording.",
    "Strict grounding rule (CRITICAL):",
    "Do NOT add any extra promises or general statements that are not explicitly stated in the provided FAQ answer text.",
    "Avoid phrases like 'we aim to', 'we try to', 'we only go out when', 'we will inform you beforehand', or naming which tours it applies to unless the FAQ answer explicitly says so.",

    "Write naturally like a human support agent. Be polite, friendly, and direct.",
    "Do NOT mention the FAQ, 'FAQ', 'the FAQ says', 'according to the FAQ', 'the provided text', or similar.",
    "Do NOT say you are an AI.",
    "Do NOT mention the FAQ, entries, or that you are using provided content.",
"Do NOT say 'The FAQ says/states' / 'According to the FAQ' or similar.",
"Answer naturally as Lapland Explorers customer service.",
    "If the provided FAQ answer does not cover the user's question, output exactly: NO_VALID_ANSWER",
    "Keep the reply concise.",
    langLine,
  ].join(" ");
}


/**
 * Rewrites/adjusts a FAQ answer using OpenAI.
 * Returns:
 * - rewritten text
 * - or "NO_VALID_ANSWER"
 * - or raw faqAnswer if API key missing/failure
 */
export async function rewriteFaqAnswer(userQuestion, faqAnswer, languageHint) {
  const hint = languageHint || detectLanguageHint(userQuestion);

  // Fallback: if no key, keep old behavior
  if (!config.OPENAI_API_KEY) {
    return faqAnswer;
  }

  const client = new OpenAI({ apiKey: config.OPENAI_API_KEY });

  const system = buildSystemPrompt(hint);

  const user = [
    "User question:",
    userQuestion,
    "",
    "FAQ answer to use:",
    faqAnswer,
    "",
    "Task: Rewrite the FAQ answer to directly address the user's question.",
  ].join("\n");

  try {
    const res = await client.chat.completions.create({
  model: config.OPENAI_MODEL,
  messages: [
    { role: "system", content: system },
    { role: "user", content: user },
  ],
  temperature: toNumber(config.OPENAI_TEMPERATURE, 0.2),
  max_tokens: toInt(config.OPENAI_MAX_TOKENS, 400),
});


    const text = res?.choices?.[0]?.message?.content?.trim();

    if (!text) return faqAnswer;

    // Hard guard for the marker
    if (text === "NO_VALID_ANSWER") return text;

    return stripFaqMetaPhrases(text);

  } catch (err) {
    console.error("[OpenAI] rewriteFaqAnswer failed:", err?.message || err);
    return faqAnswer;
  }
}

/* =========================
   Decider (Grounded RAG)
   ========================= */

function normalizeForContains(text = "") {
  return String(text)
    .toLowerCase()
    // normalize different dash characters to hyphen
    .replace(/[–—−]/g, "-")
    // strip punctuation but keep letters, numbers, spaces and hyphen
    .replace(/[^a-z0-9äöå\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(text, maxChars) {
  const t = String(text || "");
  if (t.length <= maxChars) return t;
  return t.slice(0, Math.max(0, maxChars - 1)) + "…";
}

function stripFaqMetaPhrases(text = "") {
  let t = String(text).trim();

  // English
  t = t.replace(/^(?:according to|as per)\s+(?:the\s+)?faq[:,\-\s]*/i, "");
  t = t.replace(
    /^(?:the\s+)?faq\s+(?:states|says|mentions|explains)(?:\s+that)?[:,\-\s]*/i,
    ""
  );

  // Finnish (handles: "FAQ:n mukaan", "FAQ mukaan", "FAQ: ...")
  t = t.replace(/^faq(?:[:\s-]*|['’]n\s+)?mukaan[:,\-\s]*/i, "");
  t = t.replace(/^faq[:\s-]*/i, "");

  // Finnish variants like "Usein kysytyt kysymykset ..." (rare but safe)
  t = t.replace(
    /^(?:usein\s+kysytyt\s+kysymykset|ukk)\s*(?:sano(?:vat|o)|kertoo|selittää|mukaan)?[:,\-\s]*/i,
    ""
  );

  return t.trim();
}



function buildDeciderSystemPrompt(languageHint, maxFaqs) {
  return [
    "You are a customer service assistant for Lapland Explorers.",
    "You MUST answer using ONLY the provided FAQ entries (questions + answers).",
    `You MAY combine information from up to ${maxFaqs} FAQ entries if needed.`,
    "You must NOT add any new facts, prices, policies, deadlines, or promises.",
    "",
    "Tone & style:",
    "- Write naturally like a human support agent: polite, friendly, and direct.",
    "- Do NOT mention the FAQ, 'FAQ', 'the FAQ says', 'according to', 'the provided entries', or similar.",
    "- Do NOT say you are an AI.",
    "",
    "Relevance rule (CRITICAL):",
    "- Your reply MUST directly answer the customer's question. Do NOT switch topics.",
    "",
    "Strict grounding rule (CRITICAL):",
    "Do NOT add any extra promises or general statements not explicitly stated in the provided FAQ entries.",
    "Do not claim broader applicability (e.g., 'applies to both Group Tour and Small Group Tour') unless the provided FAQ text explicitly states it.",
    "",

    "Guarantee wording rule (CRITICAL):",
    "- Never claim that the Northern Lights / aurora themselves are guaranteed to be seen.",
    "- If 'guarantee' is asked, interpret it strictly as the guarantee POLICY/experience described by the provided FAQ entries (refund/reschedule/no-aurora policy) without strengthening the promise.",
    "",

    "Cancellation safety rule (CRITICAL):",
    "- If the customer asks about cancelling their booking or cancellation fees, answer ONLY if the provided FAQ entries explicitly describe customer cancellation and/or cancellation fees.",
    "- Do NOT answer customer-cancellation questions using 'no aurora, no pay' or weather-related refund/reschedule policies unless the customer explicitly asks about bad weather, poor conditions, the tour being cancelled due to forecast, or not seeing the aurora.",
    "",
    "If you cannot answer from the provided FAQ entries, ask EXACTLY ONE short clarifying question.",
    "Do not mention handing off to a human (the app handles escalation).",
    "",
    "Return ONLY valid JSON in this exact schema (no code fences, no extra text):",
    '{ "type": "answer" | "clarify", "confidence": number, "faqIdsUsed": string[], "text": string, "support": { "faqId": string, "quote": string }[] }',
    "",
    "Rules:",
    `- If type is 'answer': faqIdsUsed must include 1..${maxFaqs} ids from the provided FAQ list.`,
    "- If type is 'answer': support MUST include at least one item per faqIdUsed.",
    "- Each support.quote MUST be an exact verbatim substring from the corresponding FAQ answer text (do not translate the quote).",
    "- If type is 'clarify': faqIdsUsed must be empty and support must be empty.",
    "- Language rule: Reply in the same language as the customer message (Finnish in Finnish, English in English). Do not mix languages.",
    "- confidence must be between 0.0 and 1.0.",
    "- Do NOT infer or assume anything not explicitly stated in the FAQ text. If an FAQ only points to Terms & Conditions, do not claim what the terms are—only direct the customer to the terms link.",
    "- Do NOT mention the FAQ, entries, candidates, or that you used provided text.",
"- Do NOT say 'FAQ says/states' or 'according to'. Answer directly and naturally.",

  ].join("\n");
}


function buildDeciderUserPrompt(userQuestion, candidates) {
  const safeCandidates = (candidates || [])
    .filter((c) => c && c.id && c.question && c.answer)
    .slice(0, Math.max(1, Math.min(Number(config.OPENAI_DECIDER_TOPK) || 10, 25)));

  const lines = safeCandidates.map((c) => {
    // Vastaukset voivat olla pitkiä -> rajataan, jotta tokenit pysyvät kurissa.
    const a = truncate(c.answer, 1400);
    const q = truncate(c.question, 300);
    const tags = Array.isArray(c.tags) ? c.tags.slice(0, 8).join(", ") : "";

    return [
      `BEGIN_FAQ_ENTRY id=${c.id}`,
      `Q: ${q}`,
      `A: ${a}`,
      tags ? `TAGS: ${tags}` : "",
      `END_FAQ_ENTRY id=${c.id}`,
    ]
      .filter(Boolean)
      .join("\n");
  });

  return [
    "Customer message:",
    userQuestion,
    "",
    "FAQ entries (use ONLY these):",
    lines.join("\n\n"),
  ].join("\n");
}

function extractLikelyJson(raw) {
  if (!raw) return null;

  // strip common code fences
  let t = String(raw).trim();
  t = t.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();

  const first = t.indexOf("{");
  const last = t.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) return null;
  return t.slice(first, last + 1);
}

function validateAndNormalizeDecision(parsed, candidates, lang) {
  const fallbackClarify = {
    type: "clarify",
    confidence: 0.0,
    faqIdsUsed: [],
    text: getDefaultClarifyText(lang),
    support: [],
  };

  if (!parsed || typeof parsed !== "object") return fallbackClarify;

  const type = parsed.type === "answer" ? "answer" : "clarify";
  const confidence =
    typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : 0.0;

  const text = typeof parsed.text === "string" ? stripFaqMetaPhrases(parsed.text) : "";

  if (!text) return fallbackClarify;

  const maxFaqs = Math.max(1, Math.min(Number(config.OPENAI_DECIDER_MAX_FAQS) || 3, 5));

  const candidateById = new Map();
  for (const c of candidates || []) {
    if (c && c.id && typeof c.answer === "string") candidateById.set(c.id, c);
  }

  const faqIdsUsedRaw = Array.isArray(parsed.faqIdsUsed) ? parsed.faqIdsUsed : [];
  const faqIdsUsed = [...new Set(faqIdsUsedRaw.map((x) => String(x || "").trim()).filter(Boolean))];

  const supportRaw = Array.isArray(parsed.support) ? parsed.support : [];
  const support = supportRaw
    .map((s) => ({
      faqId: String(s?.faqId || "").trim(),
      quote: typeof s?.quote === "string" ? s.quote.trim() : "",
    }))
    .filter((s) => s.faqId && s.quote);

  // Clarify: ei käytetä faq-id:tä eikä supportia
  if (type === "clarify") {
    return {
      type: "clarify",
      confidence,
      faqIdsUsed: [],
      text,
      support: [],
    };
  }

  // Answer: pitää käyttää 1..maxFaqs faq-id:tä
  if (faqIdsUsed.length < 1 || faqIdsUsed.length > maxFaqs) return fallbackClarify;

  // Kaikkien id:iden pitää olla shortlistissa
  for (const id of faqIdsUsed) {
    if (!candidateById.has(id)) return fallbackClarify;
  }

  // confidence-minimi: jos liian matala -> fail closed -> clarify
  const minConf = Math.max(0, Math.min(1, Number(config.OPENAI_DECIDER_MIN_CONFIDENCE) || 0.65));
  if (confidence < minConf) return fallbackClarify;

  // Support-quote: vähintään 1 per käytetty faq-id ja quote pitää löytyä vastaustekstistä
  const normSupportById = new Map();
  for (const s of support) {
    if (!normSupportById.has(s.faqId)) normSupportById.set(s.faqId, []);
    normSupportById.get(s.faqId).push(s.quote);
  }

  for (const id of faqIdsUsed) {
    const quotes = normSupportById.get(id) || [];
    if (quotes.length < 1) return fallbackClarify;

    const ans = candidateById.get(id)?.answer || "";
    const ansNorm = normalizeForContains(ans);

    // jokaiselle id:lle riittää että vähintään yksi quote löytyy
    const ok = quotes.some((q) => {
      const qNorm = normalizeForContains(q);
      if (!qNorm) return false;
      // rajoitetaan epäilyttävän lyhyet lainaukset
      if (qNorm.length < 8) return false;
      return ansNorm.includes(qNorm);
    });

    if (!ok) return fallbackClarify;
  }

  return {
    type: "answer",
    confidence,
    faqIdsUsed,
    text,
    support,
  };
}

/**
 * Decide an FAQ-based reply from top candidates.
 * Returns { type: "answer"|"clarify", confidence, faqIdsUsed, text, support }
 */
export async function decideFaqAnswerFromCandidates(userQuestion, candidates = []) {
  const lang = detectLanguageHint(userQuestion);

  // Fail-closed if missing key
  if (!config.OPENAI_API_KEY) {
    return {
      type: "clarify",
      confidence: 0.0,
      faqIdsUsed: [],
      text: getDefaultClarifyText(lang),
      support: [],
    };
  }

  const client = new OpenAI({ apiKey: config.OPENAI_API_KEY });

  const maxFaqs = Math.max(1, Math.min(Number(config.OPENAI_DECIDER_MAX_FAQS) || 3, 5));
  const system = buildDeciderSystemPrompt(lang, maxFaqs);
  const user = buildDeciderUserPrompt(userQuestion, candidates);

  try {
    const res = await client.chat.completions.create({
      model: config.OPENAI_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: toNumber(config.OPENAI_DECIDER_TEMPERATURE, 0.1),
max_tokens: toInt(
  config.OPENAI_DECIDER_MAX_TOKENS,
  Math.max(toInt(config.OPENAI_MAX_TOKENS, 300), 360)
),

    });

    const raw = res?.choices?.[0]?.message?.content?.trim();
    const jsonText = extractLikelyJson(raw);

    if (!jsonText) {
      return {
        type: "clarify",
        confidence: 0.0,
        faqIdsUsed: [],
        text: getDefaultClarifyText(lang),
        support: [],
      };
    }

    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      return {
        type: "clarify",
        confidence: 0.0,
        faqIdsUsed: [],
        text: getDefaultClarifyText(lang),
        support: [],
      };
    }

    return validateAndNormalizeDecision(parsed, candidates, lang);
  } catch (err) {
    console.error("[OpenAI] decideFaqAnswerFromCandidates failed:", err?.message || err);
    return {
      type: "clarify",
      confidence: 0.0,
      faqIdsUsed: [],
      text: getDefaultClarifyText(lang),
      support: [],
    };
  }
}

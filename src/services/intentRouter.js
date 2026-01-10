// src/services/intentRouter.js
import OpenAI from "openai";
import { config } from "../config.js";

import {
  isAckOnly,
  isQuestion,
  extractFirstName,
  looksLikeIntroOrBooking,
} from "../../utils/messageHeuristics.js";

/**
 * IntentRouter
 * - Primary: gpt-5-mini
 * - Fallback: gpt-5-nano
 * - Fallback #2: heuristics (no-LLM)
 * - Last resort: safe ACK classification (OTHER)
 *
 * Output contract (strict):
 * {
 *   intent: "QUESTION"|"STATEMENT"|"CONTACT_INFO"|"ACK_ONLY"|"OTHER",
 *   confidence: number (0..1),
 *   extractedName?: string|null,
 *   flags?: { ... }
 * }
 */

// Keep enums centralized
const INTENTS = ["QUESTION", "STATEMENT", "CONTACT_INFO", "ACK_ONLY", "OTHER"];

const ROUTER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["intent", "confidence", "extractedName", "flags"],

  properties: {
    intent: { type: "string", enum: INTENTS },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    extractedName: { type: ["string", "null"], minLength: 2, maxLength: 40 },
    flags: {
  type: "object",
  additionalProperties: false,
  required: [
    "isGreeting",
    "containsUrl",
    "containsEmail",
    "containsPhone",
    "looksLikeBookingStatement",
    "isShortAddendum",
  ],
  properties: {
    isGreeting: { type: "boolean" },
    containsUrl: { type: "boolean" },
    containsEmail: { type: "boolean" },
    containsPhone: { type: "boolean" },
    looksLikeBookingStatement: { type: "boolean" },
    isShortAddendum: { type: "boolean" },
  },
},

  },
};

function toBool(v) {
  return v === true;
}

function safeTrim(s) {
  return typeof s === "string" ? s.trim() : "";
}

function detectContactSignals(text) {
  const t = String(text || "");
  const containsUrl = /\bhttps?:\/\/\S+|\bwww\.\S+/i.test(t);
  const containsEmail =
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(t);
  // permissive-ish phone: +358..., +1..., digits with spaces/dashes
  const containsPhone =
    /\+?\d[\d\s().-]{6,}\d/.test(t) && /[0-9]{7,}/.test(t.replace(/\D/g, ""));
  return { containsUrl, containsEmail, containsPhone };
}

function validateAndNormalize(obj, fallbackText = "") {
  // Fail closed to safe values.
  const out = {
    intent: "OTHER",
    confidence: 0.0,
    extractedName: null,
    flags: {},
  };

  if (!obj || typeof obj !== "object") return out;

  const intent = obj.intent;
  const confidence = obj.confidence;

  if (INTENTS.includes(intent)) out.intent = intent;
  if (typeof confidence === "number" && confidence >= 0 && confidence <= 1) {
    out.confidence = confidence;
  }

  if (obj.extractedName === null) {
    out.extractedName = null;
  } else if (typeof obj.extractedName === "string") {
    const n = obj.extractedName.trim();
    out.extractedName = n.length ? n : null;
  }

  const flags = obj.flags && typeof obj.flags === "object" ? obj.flags : {};
  out.flags = {
    isGreeting: toBool(flags.isGreeting),
    containsUrl: toBool(flags.containsUrl),
    containsEmail: toBool(flags.containsEmail),
    containsPhone: toBool(flags.containsPhone),
    looksLikeBookingStatement: toBool(flags.looksLikeBookingStatement),
    isShortAddendum: toBool(flags.isShortAddendum),
  };

  // Extra guardrails: if model says QUESTION but confidence is very low,
  // we will later apply caller-side heuristics. (Keep raw here.)
  // Also: keep flags consistent even if model omitted.
  const sig = detectContactSignals(fallbackText);
  out.flags.containsUrl = out.flags.containsUrl || sig.containsUrl;
  out.flags.containsEmail = out.flags.containsEmail || sig.containsEmail;
  out.flags.containsPhone = out.flags.containsPhone || sig.containsPhone;

  return out;
}

async function callChatCompletionJson({
  model,
  messages,
  timeoutMs,
  maxCompletionTokens = 260,
  reasoningEffort = "minimal",
}) {
  const client = new OpenAI({ apiKey: config.OPENAI_API_KEY });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await client.chat.completions.create(
      {
        model,
        messages,
        reasoning_effort: reasoningEffort,
        max_completion_tokens: maxCompletionTokens,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "intent_router",
            schema: ROUTER_SCHEMA,
            strict: true,
          },
        },
      },
      { signal: controller.signal }
    );

    const choice = res?.choices?.[0];
    const raw = choice?.message?.content?.trim() || "";
    const finish = choice?.finish_reason;

    if (!raw) {
      // Tämä oli sun ongelma: finish_reason voi olla "stop" mutta content tyhjä
      const err = new Error(`Empty router response (finish_reason=${finish || "n/a"})`);
      err.status = 502;
      throw err;
    }

    return JSON.parse(raw);
  } finally {
    clearTimeout(timer);
  }
}


function isOnlyUrl(text = "") {
  const t = String(text || "").trim();
  if (!t) return false;
  const url = /(https?:\/\/\S+|www\.\S+)/i;
  if (!url.test(t)) return false;

  // if removing urls + whitespace leaves nothing -> only url(s)
  const stripped = t.replace(url, "").replace(/\s+/g, "").trim();
  return stripped.length === 0;
}

function isOnlyEmail(text = "") {
  const t = String(text || "").trim();
  if (!t) return false;
  const email = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
  if (!email.test(t)) return false;

  // remove email(s) and separators; if nothing left, it's only email(s)
  const stripped = t
    .replace(email, "")
    .replace(/[\s,;:()<>[\]{}"']+/g, "")
    .trim();
  return stripped.length === 0;
}

function isOnlyPhone(text = "") {
  const t = String(text || "").trim();
  if (!t) return false;

  // if it looks like a phone and contains no letters
  const hasLetters = /[A-Za-zÀ-ÖØ-öø-ÿ]/.test(t);
  if (hasLetters) return false;

  const digits = t.replace(/\D/g, "");
  if (digits.length < 7) return false;

  // allow only phone-ish chars
  return /^[\d\s().+-]+$/.test(t);
}

function isNumericOnly(text = "") {
  const t = String(text || "").trim();
  if (!t) return false;
  const hasLetters = /[A-Za-zÀ-ÖØ-öø-ÿ]/.test(t);
  if (hasLetters) return false;

  const digits = t.replace(/\D/g, "");
  if (digits.length === 0) return false;

  // numbers and separators only
  return /^[\d\s,./:-]+$/.test(t);
}

function isFaqIneligible(text = "") {
  const t = String(text || "").trim();
  if (!t) return true;

  // Hard ineligible: pure contact payload
  if (isOnlyUrl(t) || isOnlyEmail(t) || isOnlyPhone(t) || isNumericOnly(t)) {
    return true;
  }

  // Too-short non-question fragments that LLM might misclassify
  // (e.g., "tomorrow", "2", "Rovaniemi") -> do not enter FAQ/decider
  const tokens = t.split(/\s+/).filter(Boolean);
  const tooShort = tokens.length <= 2;
  const hasQMark = t.includes("?");
  if (tooShort && !hasQMark && !isQuestion(t)) return true;

  return false;
}


function heuristicRoute(text = "", ctx = {}) {
  const t = safeTrim(text);
  const sig = detectContactSignals(t);


  // Denylist: never route these into FAQ pipeline in heuristic mode
  if (isFaqIneligible(t)) {
    // If it is clearly contact payload -> CONTACT_INFO, else OTHER/STATEMENT
    const contactish = sig.containsUrl || sig.containsEmail || sig.containsPhone || isOnlyPhone(t) || isOnlyEmail(t) || isOnlyUrl(t);
    return {
      intent: contactish ? "CONTACT_INFO" : "OTHER",
      confidence: contactish ? 0.9 : 0.7,
      extractedName: extractFirstName(t),
      flags: { ...sig },
      _source: "heuristic",
      _model: null,
    };
   }

  // Ack-only first
  if (isAckOnly(t)) {
    return {
      intent: "ACK_ONLY",
      confidence: 0.95,
      extractedName: extractFirstName(t),
      flags: { ...sig },
      _source: "heuristic",
      _model: null,
    };
  }

  // Contact info
  if (sig.containsEmail || sig.containsPhone || sig.containsUrl) {
    // If it is also clearly a question, keep QUESTION.
    if (isQuestion(t)) {
      return {
        intent: "QUESTION",
        confidence: 0.7,
        extractedName: extractFirstName(t),
        flags: { ...sig },
        _source: "heuristic",
        _model: null,
      };
    }
    return {
      intent: "CONTACT_INFO",
      confidence: 0.8,
      extractedName: extractFirstName(t),
      flags: { ...sig },
      _source: "heuristic",
      _model: null,
    };
  }

  // Question
  if (isQuestion(t)) {
    return {
      intent: "QUESTION",
      confidence: 0.8,
      extractedName: extractFirstName(t),
      flags: { ...sig },
      _source: "heuristic",
      _model: null,
    };
  }

  // Otherwise statement vs other
  const bookingish =
    looksLikeIntroOrBooking(t) ||
    /\b(booked|booking|reserved|reservation|i booked|we booked)\b/i.test(t);

  return {
    intent: bookingish ? "STATEMENT" : "STATEMENT",
    confidence: bookingish ? 0.75 : 0.6,
    extractedName: extractFirstName(t),
    flags: { ...sig, looksLikeBookingStatement: bookingish },
    _source: "heuristic",
    _model: null,
  };
}

/**
 * Main entry
 * @param {string} text
 * @param {object} ctx - minimal context only (optional)
 * @returns {{intent:string, confidence:number, extractedName:(string|null), flags:object, _source:string, _model:(string|null)}}
 */
export async function routeIntent(text = "", ctx = {}) {
  const input = safeTrim(text);

  const timeoutMs = Number(config.INTENT_ROUTER_TIMEOUT_MS ?? 1800);
  const primaryModel = String(
    config.INTENT_ROUTER_MODEL_PRIMARY || "gpt-5-mini"
  );
  const fallbackModel = String(
    config.INTENT_ROUTER_MODEL_FALLBACK || "gpt-5-nano"
  );

  // If no key, fail into heuristics
  if (!config.OPENAI_API_KEY) {
    return heuristicRoute(input, ctx);
  }

  // Keep context minimal and non-sensitive:
  const lastQ = safeTrim(ctx?.lastUserQuestionText);
  const prevMeaningful = safeTrim(ctx?.prevMeaningfulUserText);

  const system = [
    "You are an intent router for a WhatsApp customer service bot for Lapland Explorers (tours in Rovaniemi).",
    "Classify the customer's message into exactly one intent:",
    "- QUESTION: asks a question or requests information/action that the bot should answer via FAQ pipeline.",
    "- STATEMENT: provides info (e.g., booking statement, date, group size) but is not itself a question.",
    "- CONTACT_INFO: primarily contact or identifiers (email/phone/link/booking ref/hotel name/address) without a question.",
    "- ACK_ONLY: short acknowledgement/thanks/ok/react emoji etc; no bot reply needed.",
    "- OTHER: everything else that should not go to FAQ/decider; prefer OTHER over QUESTION if uncertain.",
    "",
    "Return ONLY strict JSON matching the schema.",
    "Also extract first name if explicitly provided (e.g., 'I'm Jeff', 'My name is Jeff').",
    "Set flags (booleans) when obvious.",
  ].join("\n");

  const user = [
    `Message: """${input}"""`,
    lastQ ? `Last question (if any): """${lastQ}"""` : "",
    prevMeaningful ? `Previous meaningful message: """${prevMeaningful}"""` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const messages = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];

  // 1) Try primary (retry once)
try {
  let parsed;

  try {
    parsed = await callChatCompletionJson({
      model: primaryModel,
      messages,
      timeoutMs,
      maxCompletionTokens: 260,
      reasoningEffort: "minimal",
    });
  } catch (e1) {
    // retry with bigger token budget (fixes empty content edge cases)
    parsed = await callChatCompletionJson({
      model: primaryModel,
      messages,
      timeoutMs,
      maxCompletionTokens: 520,
      reasoningEffort: "minimal",
    });
  }

  const normalized = validateAndNormalize(parsed, input);
  return { ...normalized, _source: "llm", _model: primaryModel };
} catch (err) {
  console.error("[IntentRouter] primary failed:", {
    name: err?.name,
    message: err?.message,
    status: err?.status,
    code: err?.code,
    type: err?.type,
  });
}


  // 2) Try fallback model (retry once)
try {
  let parsed;

  try {
    parsed = await callChatCompletionJson({
      model: fallbackModel,
      messages,
      timeoutMs,
      maxCompletionTokens: 200,
      reasoningEffort: "minimal",
    });
  } catch (e1) {
    parsed = await callChatCompletionJson({
      model: fallbackModel,
      messages,
      timeoutMs,
      maxCompletionTokens: 350,
      reasoningEffort: "minimal",
    });
  }

  const normalized = validateAndNormalize(parsed, input);
  return { ...normalized, _source: "llm", _model: fallbackModel };
} catch (err) {
  console.error("[IntentRouter] fallback failed:", {
    name: err?.name,
    message: err?.message,
    status: err?.status,
    code: err?.code,
    type: err?.type,
  });
}

  // 3) Heuristics fallback
  try {
    return heuristicRoute(input, ctx);
  } catch (err) {
    console.error("[IntentRouter] heuristic failed:", err?.message || err);
  }

  // 4) Last resort safe classification
  return {
    intent: "OTHER",
    confidence: 0.0,
    extractedName: extractFirstName(input),
    flags: detectContactSignals(input),
    _source: "safe_ack",
    _model: null,
  };
}

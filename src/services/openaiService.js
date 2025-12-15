// src/services/openaiService.js
import OpenAI from "openai";
import { config } from "../config.js";

/**
 * Kevyt kielivihje: riittää tähän vaiheeseen.
 * (Myöhemmin voidaan tehdä parempi tunnistus.)
 */
function detectLanguageHint(text = "") {
  const t = text.toLowerCase();

  // Finnish-ish signals
  if (/[äöå]/i.test(text)) return "fi";
  if (/\b(mitä|paljonko|kuinka|missä|milloin|voiko|hinta|maksaa|tarjous|aloitus)\b/.test(t)) {
    return "fi";
  }

  // Default to English
  return "en";
}

function buildSystemPrompt(languageHint) {
  const langLine =
    languageHint === "fi"
      ? "Reply in Finnish."
      : "Reply in English.";

  return [
    "You are a customer service FAQ assistant.",
    "You MUST only use the provided FAQ answer content.",
    "Do NOT add new facts, prices, policies, or promises.",
    "If the FAQ answer does not cover the user's question, output exactly: NO_VALID_ANSWER",
    "Keep the reply concise and friendly.",
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
      temperature: config.OPENAI_TEMPERATURE,
      max_tokens: config.OPENAI_MAX_TOKENS,
    });

    const text = res?.choices?.[0]?.message?.content?.trim();

    if (!text) return faqAnswer;

    // Hard guard for the marker
    if (text === "NO_VALID_ANSWER") return text;

    return text;
  } catch (err) {
    console.error("[OpenAI] rewriteFaqAnswer failed:", err?.message || err);
    return faqAnswer;
  }
}



function buildDeciderSystemPrompt() {
  return [
    "You are a customer service assistant.",
    "You MUST answer using ONLY the provided FAQ entries (questions + answers).",
    "You may combine multiple FAQ answers if needed, but you must NOT add any new facts.",
    "If you cannot answer from the provided FAQ entries, ask EXACTLY ONE short clarifying question.",
    "Do not mention handing off to a human (the app handles escalation).",
    "",
    "Return ONLY valid JSON in this schema:",
    '{ "type": "answer" | "clarify", "confidence": number, "faqIdsUsed": string[], "text": string }',
    "",
    "Language rule: Reply in the same language as the customer message (Finnish in Finnish, English in English). Do not mix languages.",
    "confidence must be between 0.0 and 1.0.",
  ].join("\n");
}

function buildDeciderUserPrompt(userQuestion, candidates) {
  const lines = (candidates || [])
    .filter((c) => c && c.id && c.question && c.answer)
    .map((c, i) => `#${i + 1} id=${c.id}\nQ: ${c.question}\nA: ${c.answer}`);

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

/**
 * Decide an FAQ-based reply from top candidates.
 * Returns { type: "answer"|"clarify", confidence, faqIdsUsed, text }
 */
export async function decideFaqAnswerFromCandidates(userQuestion, candidates = []) {
  // Fail-closed if missing key
  if (!config.OPENAI_API_KEY) {
    return {
      type: "clarify",
      confidence: 0.0,
      faqIdsUsed: [],
      text: "Could you clarify your question?",
    };
  }

  const client = new OpenAI({ apiKey: config.OPENAI_API_KEY });

  const system = buildDeciderSystemPrompt();
  const user = buildDeciderUserPrompt(userQuestion, candidates);

  try {
    const res = await client.chat.completions.create({
      model: config.OPENAI_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.2,
      max_tokens: Math.max(config.OPENAI_MAX_TOKENS || 300, 300),
    });

    const raw = res?.choices?.[0]?.message?.content?.trim();
    const jsonText = extractLikelyJson(raw);

    if (!jsonText) {
      return { type: "clarify", confidence: 0.0, faqIdsUsed: [], text: "Could you clarify your question?" };
    }

    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      return { type: "clarify", confidence: 0.0, faqIdsUsed: [], text: "Could you clarify your question?" };
    }

    const type = parsed?.type === "answer" ? "answer" : "clarify";
    const confidence = typeof parsed?.confidence === "number" ? parsed.confidence : 0.0;
    const faqIdsUsed = Array.isArray(parsed?.faqIdsUsed) ? parsed.faqIdsUsed.filter(Boolean) : [];
    const text = typeof parsed?.text === "string" ? parsed.text.trim() : "";

    if (!text) {
      return { type: "clarify", confidence: 0.0, faqIdsUsed: [], text: "Could you clarify your question?" };
    }

    return {
      type,
      confidence: Math.max(0, Math.min(1, confidence)),
      faqIdsUsed,
      text,
    };
  } catch (err) {
    console.error("[OpenAI] decideFaqAnswerFromCandidates failed:", err?.message || err);
    return { type: "clarify", confidence: 0.0, faqIdsUsed: [], text: "Could you clarify your question?" };
  }
}

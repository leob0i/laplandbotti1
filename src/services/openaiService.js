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

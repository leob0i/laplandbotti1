import OpenAI from "openai";
import { config } from "../config.js";

const client = new OpenAI({ apiKey: config.OPENAI_API_KEY });

export async function pickBestFaqId({ userText, candidates, langHint = "en" }) {
  // candidates: [{id, question, tags, fuseScore}]
  const compact = candidates.map((c) => ({
    id: c.id,
    question: c.question,
    tags: (c.tags || []).slice(0, 12),
  }));

  const system = `
You are a strict FAQ router.
Choose the single best faqId from the provided candidates.

Rules:
- You MUST choose from the candidate ids only.
- If none match, output {"faqId":null,"confidence":0,"reason":"no match"}.
- confidence is 0..1.
- Return JSON only.
`.trim();

  const payload = { userText, langHint, candidates: compact };

  const resp = await client.chat.completions.create({
    model: config.OPENAI_MODEL || "gpt-4o-mini",
    temperature: 0.1,
    messages: [
      { role: "system", content: system },
      { role: "user", content: JSON.stringify(payload) },
    ],
    response_format: { type: "json_object" },
  });

  let parsed = { faqId: null, confidence: 0, reason: "" };
  try {
    parsed = JSON.parse(resp.choices?.[0]?.message?.content || "{}");
  } catch {
    parsed = { faqId: null, confidence: 0, reason: "invalid json" };
  }

  return {
    faqId: parsed.faqId ?? null,
    confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0,
    reason: parsed.reason || "",
  };
}

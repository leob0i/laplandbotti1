import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { config } from "../config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let faqItems = [];

// Load FAQ once at startup
function loadFaq() {
  try {
    const faqPath = path.isAbsolute(config.FAQ_FILE_PATH)
      ? config.FAQ_FILE_PATH
      : path.join(__dirname, "..", "..", config.FAQ_FILE_PATH);

    const raw = fs.readFileSync(faqPath, "utf8");
    const data = JSON.parse(raw);

    if (Array.isArray(data)) {
      faqItems = data;
      console.log(`[FAQ] Loaded ${faqItems.length} items from ${faqPath}`);
    } else {
      console.warn("[FAQ] FAQ file is not an array");
      faqItems = [];
    }
  } catch (err) {
    console.error("[FAQ] Failed to load FAQ file:", err.message);
    faqItems = [];
  }
}

// Tiny helper: normalize text (lowercase, strip punctuation + small typo fixes)
function normalize(text = "") {
  let t = String(text).toLowerCase();

  // common typos (add more later safely)
  t = t.replace(/\bnorthen\b/g, "northern");

  // normalize known key phrase (singular/plural -> one form)
  t = t.replace(/\bnorthern\s+lights?\b/g, "northern lights");

  // strip punctuation more broadly than just . , ! ?
  t = t.replace(/[^a-z0-9äöå\s]/g, " ");

  // collapse spaces
  t = t.replace(/\s+/g, " ").trim();

  return t;
}


// Simple string similarity: overlap of words (0..1)
function stringSimilarity(a, b) {
  const aNorm = normalize(a);
  const bNorm = normalize(b);
  if (!aNorm || !bNorm) return 0;

  const aWords = new Set(aNorm.split(" "));
  const bWords = new Set(bNorm.split(" "));

  const intersection = new Set([...aWords].filter((w) => bWords.has(w)));
  const union = new Set([...aWords, ...bWords]);

  if (union.size === 0) return 0;
  return intersection.size / union.size;
}

loadFaq();

/**
 * Find best FAQ match for userQuestion.
 * Returns { faq, score }.
 */
export async function findBestFaqMatch(userQuestion) {
  if (!faqItems.length) {
    return { faq: null, score: 0 };
  }

  let best = null;
  let bestScore = 0;

  for (const item of faqItems) {
    const baseScore = stringSimilarity(userQuestion, item.question);
    let tagScore = 0;

    if (item.tags && Array.isArray(item.tags)) {
      for (const tag of item.tags) {
        const s = stringSimilarity(userQuestion, tag);
        if (s > tagScore) tagScore = s;
      }
    }

    const combined = Math.max(baseScore, tagScore);
    if (combined > bestScore) {
      bestScore = combined;
      best = item;
    }
  }

  return { faq: best, score: bestScore };
}


/**
 * Find top FAQ candidates for a userQuestion.
 * Returns [{ id, question, answer, tags, score }, ...] sorted by score desc.
 */
export async function findTopFaqCandidates(userQuestion, limit = 10) {
  if (!faqItems.length) return [];

  const scored = faqItems.map((item) => {
    const baseScore = stringSimilarity(userQuestion, item.question);
    let tagScore = 0;

    if (item.tags && Array.isArray(item.tags)) {
      for (const tag of item.tags) {
        const s = stringSimilarity(userQuestion, tag);
        if (s > tagScore) tagScore = s;
      }
    }

    const score = Math.max(baseScore, tagScore);

    return {
      id: item.id,
      question: item.question,
      answer: item.answer,
      tags: item.tags,
      score,
    };
  });

  scored.sort((a, b) => b.score - a.score);

  const safeLimit = Math.max(1, Math.min(Number(limit) || 10, 25));
  return scored.slice(0, safeLimit);
}

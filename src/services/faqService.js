import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Fuse from "fuse.js";
import { config } from "../config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let faqItems = [];
let fuse = null;

// Load FAQ once at startup
function loadFaq() {
  try {
    const faqPath = path.isAbsolute(config.FAQ_FILE_PATH)
      ? config.FAQ_FILE_PATH
      : path.join(__dirname, "..", "..", config.FAQ_FILE_PATH);

    const raw = fs.readFileSync(faqPath, "utf8");
    const data = JSON.parse(raw);

    if (Array.isArray(data)) {
      // Lisäämme normalisoidut kentät fuzzy-hakua varten (ei vaikuta vastaamiseen)
      faqItems = data.map((item) => {
        const tags = Array.isArray(item.tags) ? item.tags : [];
        return {
  ...item,
  _q: normalize(item.question || ""),
  _tags: tags.map((t) => normalize(t)),
  _a: normalize(item.answer || ""),
};

      });

      fuse = null; // rebuild index
      console.log(`[FAQ] Loaded ${faqItems.length} items from ${faqPath}`);
      console.log(`[FAQ] Fuse index will be built on first search.`);
    } else {
      console.warn("[FAQ] FAQ file is not an array");
      faqItems = [];
      fuse = null;
    }
  } catch (err) {
    console.error("[FAQ] Failed to load FAQ file:", err.message);
    faqItems = [];
    fuse = null;
  }
}

// Tiny helper: normalize text (lowercase, strip punctuation + small typo fixes)
function normalize(text = "") {
  let t = String(text).toLowerCase();

  // common typos (add more later safely)
  t = t.replace(/\bnorthen\b/g, "northern");
  t = t.replace(/\bnothern\b/g, "northern");
  t = t.replace(/\bquaranteed\b/g, "guaranteed");
  t = t.replace(/\bguarenteed\b/g, "guaranteed");
  t = t.replace(/\bgaranteed\b/g, "guaranteed");

  // normalize known key phrase (singular/plural -> one form)
  t = t.replace(/\bnorthern\s+lights?\b/g, "northern lights");

  // strip punctuation more broadly than just . , ! ?
  t = t.replace(/[^a-z0-9äöå\s]/g, " ");

  // collapse spaces
  t = t.replace(/\s+/g, " ").trim();

  return t;
}

// Simple string similarity: overlap of words (0..1) (fallback)
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

// Build Fuse index lazily
function getFuse() {
  if (fuse) return fuse;
  if (!faqItems.length) return null;

  fuse = new Fuse(faqItems, {
    includeScore: true,     // Fuse score: lower is better
    ignoreLocation: true,
    threshold: 0.45,        // 0.35–0.55 hyvä alue. Pienempi = tiukempi
    distance: 200,
    minMatchCharLength: 2,
    keys: [
  { name: "_q", weight: 0.6 },
  { name: "_tags", weight: 0.25 },
  { name: "_a", weight: 0.15 },
],

      
  });

  console.log(`[FAQ] Fuse index built for ${faqItems.length} items.`);
  return fuse;
}

// Convert Fuse score (0..1, lower better) -> confidence (0..1, higher better)
function fuseScoreToConfidence(fuseScore) {
  if (typeof fuseScore !== "number") return 0;
  const s = Math.min(Math.max(fuseScore, 0), 1);
  return 1 - s;
}

function looksLikeGuaranteeQuery(qNorm = "") {
  const t = String(qNorm).toLowerCase();
  return (
    t.includes("guarante") ||
    t.includes("refund") ||
    t.includes("money back") ||
    t.includes("rebook") ||
    t.includes("retry") ||
    t.includes("no aurora") ||
    t.includes("reschedul") ||
    t.includes("policy") ||
    t.includes("taattu") ||
    t.includes("takuu") ||
    t.includes("hyvitys") ||
    t.includes("rahanpalautus") ||
    t.includes("uusinta")
  );
}

function isGuaranteeFaqItem(item) {
  if (!item) return false;

  const tags = Array.isArray(item.tags) ? item.tags.join(" ") : "";
  const hay = normalize(`${item.id || ""} ${item.question || ""} ${tags}`);

  return (
    hay.includes("guarante") ||
    hay.includes("no aurora") ||
    hay.includes("refund") ||
    hay.includes("money back") ||
    hay.includes("rebook") ||
    hay.includes("retry") ||
    hay.includes("reschedul") ||
    hay.includes("policy") ||
    hay.includes("taattu") ||
    hay.includes("takuu") ||
    hay.includes("hyvitys") ||
    hay.includes("rahanpalautus") ||
    hay.includes("uusinta")
  );
}


loadFaq();

/**
 * Find best FAQ match for userQuestion.
 * Returns { faq, score } where score is 0..1 (higher is better).
 */
export async function findBestFaqMatch(userQuestion) {
  if (!faqItems.length) {
    return { faq: null, score: 0 };
  }

  const q = normalize(userQuestion || "");
  if (!q) return { faq: null, score: 0 };

  // 1) Primary: Fuse fuzzy search
  const f = getFuse();
  let bestFuseItem = null;
  let bestFuseConf = 0;

  if (f) {
  const results = f.search(q, { limit: 8 });
  if (results && results.length > 0) {
    // Default: paras Fuse-tulos
    let picked = results[0];

    // Jos intentti on guarantee/policy, yritä valita topista "guarantee-tyyppinen" entry
    if (looksLikeGuaranteeQuery(q)) {
      const boosted = results.find((r) => isGuaranteeFaqItem(r.item));
      if (boosted) picked = boosted;
    }

    bestFuseItem = picked.item;
    bestFuseConf = fuseScoreToConfidence(picked.score);
  }
}


  // 2) Fallback: legacy overlap similarity (turvaverkko)
  let bestLegacyItem = null;
  let bestLegacyScore = 0;

  for (const item of faqItems) {
    const baseScore = stringSimilarity(q, item.question);
    let tagScore = 0;

    if (item.tags && Array.isArray(item.tags)) {
      for (const tag of item.tags) {
        const s = stringSimilarity(q, tag);
        if (s > tagScore) tagScore = s;
      }
    }

    const combined = Math.max(baseScore, tagScore);
    if (combined > bestLegacyScore) {
      bestLegacyScore = combined;
      bestLegacyItem = item;
    }
  }

  // 3) Primary: Fuse is the main matcher.
  // Legacy overlap is only a fallback when Fuse can't find a decent match.
  const MIN_FUSE_CONF = 0.30; // 0.30–0.40 on käytännössä hyvä alue

  if (bestFuseItem && bestFuseConf >= MIN_FUSE_CONF) {
    return { faq: bestFuseItem, score: bestFuseConf };
  }

  return { faq: bestLegacyItem, score: bestLegacyScore };

}

/**
 * Find top FAQ candidates for a userQuestion.
 * Returns [{ id, question, answer, tags, score }, ...] sorted by score desc.
 */
export async function findTopFaqCandidates(userQuestion, limit = 10) {
  if (!faqItems.length) return [];

  const q = normalize(userQuestion || "");
  if (!q) return [];

  const safeLimit = Math.max(1, Math.min(Number(limit) || 10, 25));

  // 1) Primary: Fuse candidates
  const f = getFuse();
  let fuseCandidates = [];

  if (f) {
    const results = f.search(q, { limit: safeLimit });
    fuseCandidates = (results || []).map((r) => ({
      id: r.item.id,
      question: r.item.question,
      answer: r.item.answer,
      tags: r.item.tags,
      score: fuseScoreToConfidence(r.score),
    }));
  }

if (fuseCandidates.length > 0 && looksLikeGuaranteeQuery(q)) {
  fuseCandidates.sort((a, b) => {
    const ag = isGuaranteeFaqItem({ id: a.id, question: a.question, tags: a.tags });
    const bg = isGuaranteeFaqItem({ id: b.id, question: b.question, tags: b.tags });
    if (ag !== bg) return bg ? 1 : -1;
    return b.score - a.score;
  });
}

  
  // 2) If Fuse produced nothing, fallback to legacy scoring
  if (fuseCandidates.length > 0) {
    // Fuse already sorted by best first; we want score desc
    fuseCandidates.sort((a, b) => b.score - a.score);
    return fuseCandidates.slice(0, safeLimit);
  }

  const scored = faqItems.map((item) => {
    const baseScore = stringSimilarity(q, item.question);
    let tagScore = 0;

    if (item.tags && Array.isArray(item.tags)) {
      for (const tag of item.tags) {
        const s = stringSimilarity(q, tag);
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
  return scored.slice(0, safeLimit);
}

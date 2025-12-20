import fs from "node:fs";
import path from "node:path";
import Fuse from "fuse.js";
import { config } from "../config.js";

let fuse = null;
let faqCache = null;

function resolveFaqPath() {
  return config.FAQ_FILE_PATH
    ? path.resolve(config.FAQ_FILE_PATH)
    : path.resolve(process.cwd(), "src/data/faq_en.json");
}

function loadFaq() {
  if (faqCache) return faqCache;

  const filePath = resolveFaqPath();
  const raw = fs.readFileSync(filePath, "utf8");
  const data = JSON.parse(raw);

  faqCache = Array.isArray(data) ? data : [];
  return faqCache;
}

function buildFuse() {
  if (fuse) return fuse;

  const faq = loadFaq();
  fuse = new Fuse(faq, {
    includeScore: true,       // lower = better
    ignoreLocation: true,
    threshold: 0.42,          // säädä: 0.35–0.50
    distance: 200,
    keys: [
      { name: "question", weight: 0.7 },
      { name: "tags", weight: 0.3 },
    ],
  });

  return fuse;
}

export function searchFaq(query, limit = 8) {
  const q = (query || "").trim();
  if (!q) return [];

  const f = buildFuse();
  const results = f.search(q).slice(0, limit);

  return results.map((r) => ({
    id: r.item.id,
    question: r.item.question,
    answer: r.item.answer,
    tags: r.item.tags || [],
    fuseScore: typeof r.score === "number" ? r.score : 1,
  }));
}

export function getFaqById(id) {
  const faq = loadFaq();
  return faq.find((x) => x.id === id) || null;
}

// utils/textNormalize.js (ESM)

const TYPO_FIXES = [
  [/\bnorthen\b/gi, "northern"],
  [/\binstgaram\b/gi, "instagram"],
  [/\bfacebok\b/gi, "facebook"],
];

export function detectIntent(raw = "") {
  const t = raw.trim().toLowerCase();

  const isGreeting =
    /^(hi|hello|hey|moi|hei|morjens|terve|yo)\b/.test(t) ||
    /^(good\s(morning|afternoon|evening))\b/.test(t);

  const isThanks = /^(thanks|thank you|kiitos|thx)\b/.test(t);
  const isBye = /^(bye|goodbye|see you|heippa|nähdään|moro)\b/.test(t);

  const wantsHuman =
    /\b(agent|human|support|representative|asiakaspalvelija|ihminen|soita)\b/.test(t);

  if (wantsHuman) return "HUMAN_REQUEST";
  if (isGreeting) return "GREETING";
  if (isThanks) return "THANKS";
  if (isBye) return "GOODBYE";
  return "QUESTION";
}

export function detectLang(raw = "") {
  const t = raw.toLowerCase();
  if (/\b(moi|hei|kiitos|varaus|hinta|retki|tapaamispaikka)\b/.test(t)) return "fi";
  return "en";
}

export function normalizeForMatch(raw = "") {
  let t = (raw || "").toLowerCase().trim();

  for (const [re, rep] of TYPO_FIXES) t = t.replace(re, rep);

  // singular/plural -> yhdenmukaiseksi
  t = t.replace(/\bnorthern\s+lights?\b/g, "northern lights");

  // siistintä: pidä kirjaimet/numerot/ääkköset
  t = t.replace(/[^a-z0-9äöå\s]/gi, " ");
  t = t.replace(/\s+/g, " ").trim();

  return t;
}

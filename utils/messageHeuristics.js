// utils/messageHeuristics.js
export function normalizeLite(s = "") {
  return String(s).trim().toLowerCase();
}

export function isQuestion(text = "") {
  const t = normalizeLite(text);
  if (t.includes("?")) return true;

  // EN + FI perus-kysymyssanat
  const qWords = [
    "what", "when", "where", "how", "how long", "how many", "which", "can you", "could you",
    "mikä", "milloin", "missä", "miten", "kuinka", "kauanko", "paljonko", "voinko", "voitko"
  ];
  return qWords.some((w) => t.includes(w));
}

export function looksLikeIntroOrBooking(text = "") {
  const t = normalizeLite(text);

  // Selkeä “intro / booking statement” -kuvio
  const patterns = [
    "my name is", "i'm ", "i am ", "this is ",
    "i booked", "i have booked", "i did book", "booking", "reservation",
    "varasin", "minun nimeni on", "olen ", "varaus", "bookannut"
  ];
  return patterns.some((p) => t.includes(p));
}

export function extractFirstName(text = "") {
  const s = String(text).trim();

  // "My name is Jeff"
  let m = s.match(/my name is\s+([A-Za-zÀ-ÖØ-öø-ÿ'-]{2,})/i);
  if (m?.[1]) return cap(m[1]);

  // "I'm Jeff" / "I am Jeff"
  m = s.match(/\b(i'm|i am)\s+([A-Za-zÀ-ÖØ-öø-ÿ'-]{2,})\b/i);
  if (m?.[2]) return cap(m[2]);

  return null;
}

export function isAckOnly(text = "") {
  const t = normalizeLite(text);
  return [
    "ok", "okay", "thanks", "thank you", "thx", "great", "perfect",
    "joo", "ok", "okei", "kiitos", "selvä", "hyvä"
  ].includes(t);
}

export function isShortClarifier(text = "") {
  const t = normalizeLite(text);
  if (isAckOnly(t)) return false;
  if (t.length > 40) return false;

  // sallitaan tyypilliset tarkennukset
  return /\b(aurora|northern lights|small group|group tour|group|pickup|meeting point|hotel|rovaniemi)\b/i.test(t);
}

function cap(w) {
  return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
}

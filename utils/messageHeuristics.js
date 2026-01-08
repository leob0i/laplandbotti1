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
  const raw = String(text || "").trim();
  if (!raw) return true;

  // Jos käyttäjä kysyy jotain, se EI ole pelkkä ACK
  if (raw.includes("?")) return false;

  // Ack-normalisointi vain tähän funktioon (ei rikota muita heuristiikkoja)
  let t = raw.toLowerCase();
  t = t.replace(/that's/g, "thats"); // yleinen WhatsApp-muoto
  t = t
    .replace(/[\p{P}\p{S}]+/gu, " ") // poista välimerkit / emojit -> välilyönti
    .replace(/\s+/g, " ")
    .trim();

  // Selkeät täsmä-ACKit (EN + FI)
  const exact = new Set([
    // EN
    "ok",
    "okay",
    "okey",
    "ok ok",
    "thanks",
    "thank you",
    "thx",
    "great",
    "perfect",
    "nice",
    "cool",
    "thats cool",
    "got it",
    "understood",
    "i understand",
    "i already understand",
    "all good",
    "alright",

    // FI (kevyesti mukana)
    "joo",
    "juu",
    "okei",
    "okkei",
    "kiitos",
    "selvä",
    "hyvä"
  ]);

  if (exact.has(t)) return true;

  // Lyhyet yhdistelmät: "oh ok", "ah ok", "ok thanks", "ok got it"
  const words = t.split(" ").filter(Boolean);
  if (words.length >= 1 && words.length <= 4) {
    const allowed = new Set([
      // fillers
      "oh", "ah", "hey", "yo",
      // core ack
      "ok", "okay", "okey", "okei", "okkei",
      "thanks", "thank", "you", "thx",
      "cool", "nice", "great", "perfect",
      "got", "it", "understood", "understand"
    ]);

    const hasCore = words.some((w) =>
      ["ok", "okay", "okey", "okei", "okkei", "thanks", "thx", "cool", "great", "got", "understood"].includes(w)
    );

    if (hasCore && words.every((w) => allowed.has(w))) return true;
  }

  return false;
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

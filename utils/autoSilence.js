// src/utils/autoSilence.js

function normalizeBasic(text) {
  return String(text || "")
    .toLowerCase()
    .trim()
    // poista yleinen välimerkkiyli
    .replace(/[.,!]+/g, "")
    .replace(/\s+/g, " ");
}

const ACK_TOKENS = new Set([
  "ok",
  "okay",
  "okei",
  "okey",
  "thanks",
  "thank",
  "you",
  "thankyou",
  "thx",
  "ty",
  "kiitos",
  "jes",
  "selvä",
  "oke",
  "okki",
]);

/**
 * True = viesti on pelkkä kuittaus/kiitos -> botti saa olla hiljaa.
 * - Ei saa sisältää kysymysmerkkiä
 * - Ei saa olla pitkä
 * - Sisältää vain kuittaus/kiitos -tokenit (ja mahdollisesti "thank you" = two tokens)
 */
export function shouldAutoSilence(text) {
  const raw = String(text || "").trim();
  if (!raw) return true;

  // jos käyttäjä kysyy jotain, älä hiljennä
  if (raw.includes("?")) return false;

  const t = normalizeBasic(raw);

  // liian pitkä = ei todennäköisesti pelkkä kuittaus
  if (t.length > 30) return false;

  const parts = t.split(" ").filter(Boolean);

  // sallitaan myös esim. "ok thanks", "okay thank you", "okei kiitos"
  // mutta jos mukana on muita sanoja, ei hiljennetä.
  for (const p of parts) {
    if (!ACK_TOKENS.has(p)) return false;
  }

  // jos se on 1–4 tokenin kuittaus, hiljennä
  return parts.length >= 1 && parts.length <= 4;
}

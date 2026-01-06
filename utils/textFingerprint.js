// src/utils/textFingerprint.js

export function fingerprint(text) {
  return String(text || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.,!?:;]+/g, "")
    .slice(0, 500);
}

console.log("[Heuristics] signature=messageHeuristics@2026-01-09-A path=", import.meta.url);

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

  // Suoja: jos viestissä on selkeä “kysymysmainen” rakenne ilman kysymysmerkkiä, ei luokitella ACK:ksi
  // (esim. "thats cool can we add 1 more")
  if (/\b(can we|could we|can you|could you|do we|does it|is it|are there|what|when|where|how|why)\b/i.test(raw)) {
    return false;
  }

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
    "okke",
    "thanks",
    "thank you",
    "thx",
    "great",
    "perfect",
    "nice",
    "cool",
    "so cool",
    "thats cool",
    "thats so cool",
    "awesome",
    "amazing",
    "wow",
    "got it",
    "understood",
    "i understand",
    "i already understand",
    "all good",
    "alright",
    "okei",

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

  // Lyhyet yhdistelmät: "oh ok", "ah ok", "ok thanks", "thats so cool"
  const words = t.split(" ").filter(Boolean);
  if (words.length >= 1 && words.length <= 5) {
    const allowed = new Set([
      // fillers
      "oh", "ah", "hey", "yo",
      "well",
      // common praise/ack modifiers
      "thats", "that", "is", "so", "very", "super",
      // core ack
      "ok", "okay", "okey", "okei", "okkei",
      "thanks", "thank", "you", "thx",
      "cool", "nice", "great", "perfect", "awesome", "amazing", "wow",
      "got", "it", "understood", "understand"
    ]);

    const hasCore = words.some((w) =>
      ["ok", "okay", "okey", "okei", "okkei", "thanks", "thx", "cool", "great", "awesome", "amazing", "wow", "got", "understood"].includes(w)
    );

    if (hasCore && words.every((w) => allowed.has(w))) return true;
  }

  return false;
}

export function isShortClarifier(text = "") {
  const t = normalizeLite(text);
  if (isAckOnly(t)) return false;

  // UUSI: jos näyttää osoitteelta / pickup-lokaatiolta tai sisältää linkin -> ei koskaan “clarifier”
  if (looksLikePickupLocation(t)) return false;
  if (containsUrl(t)) return false;

  if (t.length > 40) return false;

  // sallitaan tyypilliset tarkennukset
  return /\b(aurora|northern lights|small group|group tour|group|pickup|pick-up|meeting point|hotel|rovaniemi)\b/i.test(t);
}




export function containsUrl(text = "") {
  const raw = String(text || "").trim();
  if (!raw) return false;

  // varsinainen URL tai www-alkuinen
  if (/(https?:\/\/\S+|www\.\S+)/i.test(raw)) return true;

  // varmuus: pelkät maps-shortlinkit ilman https (joskus näkee)
  if (/\b(maps\.app\.goo\.gl\/\S+|goo\.gl\/maps\/\S+|google\.[a-z.]+\/maps\/\S+)\b/i.test(raw)) return true;

  return false;
}

function isDistanceOrDirectionStatement(t = "") {
  // esim: "20km away", "35 km from rovaniemi", "10 minutes from city center"
  return /\b\d+(\.\d+)?\s*(km|kilometers?|kilometres?|m|min|minutes?|hour|hours|h)\b/i.test(t)
    && /\b(away|from|to|distance|center|centre|city|downtown)\b/i.test(t);
}



// Käytetään botService-logiikassa: jos botti on pyytänyt pickup/hotel locationin ja käyttäjä lähettää osoitteen,
// voidaan siirtää HUMAN-tilaan heti.
export function looksLikePickupLocation(text = "") {
  const raw = String(text || "").trim();
  if (!raw) return false;

  // Linkki -> käsitellään pickup-tilanteessa HUMANiin (botServicessä), mutta myös täällä tunnistetaan
  if (containsUrl(raw)) return true;

  // jos kysymys tai kuittaus -> ei pickup-osoite
  if (isQuestion(raw)) return false;
  if (isAckOnly(raw)) return false;

  const t = raw.toLowerCase();

  // Estä “my hotel is 20km away” -tyyppiset lauseet
  if (isDistanceOrDirectionStatement(t)) return false;

  // Koordinaatit (lat, lon)
  if (/\b-?\d{1,2}\.\d+\s*,\s*-?\d{1,3}\.\d+\b/.test(t)) return true;

  // Postinumero (FI) mutta vain jos mukana on muutakin kuin numerot
  // esim "96100 Rovaniemi" ok, mutta "12345" ei.
  if (/\b\d{5}\b/.test(t)) {
    const onlyDigits = /^\d{5}$/.test(raw);
    if (!onlyDigits && raw.split(/\s+/).length >= 2) return true;
  }

// Katu-/tie-sanat + talonumero (FI/EN)
// - Toimii myös "Rovankatu 2b" (katu sanan lopussa)
// - Ei käytä x-flagia eikä moniriviregexiä (ei syntaksivirhettä)
const streetWord =
  /(?:street|st\.?|road|rd\.?|avenue|ave\.?|boulevard|blvd\.?|lane|ln\.?|drive|dr\.?|way)(?=\s|$|,|\.|-|\d)|(?:katu|tie|kuja|polku|väylä|tori|aukio)(?=\s|$|,|\.|-|\d)/i;


const hasStreetWord = streetWord.test(t);

// Huom: ei alkuboundaryä -> toimii myös jos väli puuttuu, esim "Rovankatu2b"
const hasNumber = /\d{1,4}\s*[a-z]{0,2}\b/i.test(t);
const hasKm = /\b\d+(\.\d+)?\s*km\b/i.test(t);




  if (hasStreetWord && hasNumber && !hasKm) return true;

  // "Kiiskisenkatu 2, Ivalo" / "Some street 12, city"
  if (raw.includes(",") && hasNumber && !hasKm) {
    // vaadi että pilkun molemmin puolin on järkevästi tekstiä
    const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2 && parts[0].length >= 4 && parts[1].length >= 2) return true;
  }

  // Hotellin/majoituksen nimi: vaadi oikeasti “nimi”, ei pelkkä "hotel" tai "my hotel is ..."
  const accomWord = /\b(hotel|hostel|airbnb|apartment|apt|villa|cabin|guesthouse|resort)\b/i;
  if (accomWord.test(t)) {
    // jos viesti on pelkkä "hotel" tms -> ei
    const tokens = t
      .replace(/[\p{P}\p{S}]+/gu, " ")
      .replace(/\s+/g, " ")
      .trim()
      .split(" ")
      .filter(Boolean);

    const stop = new Set([
      "my", "the", "a", "an", "is", "are", "im", "i'm", "i", "we", "our",
      "hotel", "hostel", "airbnb", "apartment", "apt", "villa", "cabin", "guesthouse", "resort",
      "in", "at", "on", "near", "from", "to"
    ]);

    const informative = tokens.filter((w) => !stop.has(w));

    // Vaadi vähintään 2 “informatiivista” tokenia (esim. clarion + rovaniemi)
    // Tämä estää: "my hotel is 20km away" (lisäksi distance-filteri)
    if (informative.length >= 2) return true;
  }

  // Ei mitään “fallback: pituus >= 10” -juttuja -> liian riskialtis
  return false;
}


function cap(w) {
  return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
}

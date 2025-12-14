import "dotenv/config";

export const config = {
  PORT: Number(process.env.PORT || 3000),

  WHATSAPP_VERIFY_TOKEN: process.env.WHATSAPP_VERIFY_TOKEN || "",
  WHATSAPP_ACCESS_TOKEN: process.env.WHATSAPP_ACCESS_TOKEN || "",
  WHATSAPP_PHONE_NUMBER_ID: process.env.WHATSAPP_PHONE_NUMBER_ID || "",

  OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",

  // UUSI: valittava malli envillä
  // Defaultiksi kevyt ja edullinen tekstimalli.
  // GPT-4o mini on saatavilla myös Chat Completions APIssa. Mut GPT-4o toimii hyvin. :contentReference[oaicite:3]{index=3}
  OPENAI_MODEL: process.env.OPENAI_MODEL || "gpt-4o-mini",

    // UUSI: pieniä säätöjä, turvalliset oletukset
  OPENAI_TEMPERATURE: Number(process.env.OPENAI_TEMPERATURE ?? 0.3),
  OPENAI_MAX_TOKENS: Number(process.env.OPENAI_MAX_TOKENS ?? 300),

  TIMEZONE: process.env.TIMEZONE || "Europe/Helsinki",
  BOT_ACTIVE_START: Number(process.env.BOT_ACTIVE_START ?? 21),
  BOT_ACTIVE_END: Number(process.env.BOT_ACTIVE_END ?? 9),

  FAQ_FILE_PATH: process.env.FAQ_FILE_PATH || "./data/faq.json",

  // Confidence threshold for FAQ match
  CONFIDENCE_THRESHOLD: Number(process.env.CONFIDENCE_THRESHOLD ?? 0.85),

    // Kuinka monen minuutin jälkeen botti saa ottaa keissin takaisin HUMAN-tilasta. Jos arvo on tyhjä tai 0, botti ei ota keisseja takaisin. Arvo pitää paivittaa myos .env
  HUMAN_TIMEOUT_MINUTES: Number(process.env.HUMAN_TIMEOUT_MINUTES ?? 0),


  AGENT_API_KEY: process.env.AGENT_API_KEY || process.env.X_AGENT_KEY || "",

};

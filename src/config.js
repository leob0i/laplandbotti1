import "dotenv/config";

export const config = {
  PORT: Number(process.env.PORT || 3000),

  WHATSAPP_VERIFY_TOKEN: process.env.WHATSAPP_VERIFY_TOKEN || "",
  WHATSAPP_ACCESS_TOKEN: process.env.WHATSAPP_ACCESS_TOKEN || "",
  WHATSAPP_PHONE_NUMBER_ID: process.env.WHATSAPP_PHONE_NUMBER_ID || "",

  OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",

  // UUSI: valittava malli envillä
  OPENAI_MODEL: process.env.OPENAI_MODEL || "gpt-4o-mini",

  // Yleiset OpenAI-asetukset
  OPENAI_TEMPERATURE: Number(process.env.OPENAI_TEMPERATURE ?? 0.3),
  OPENAI_MAX_TOKENS: Number(process.env.OPENAI_MAX_TOKENS ?? 300),

  // Decider-asetukset (Grounded RAG)
  OPENAI_DECIDER_TOPK: Number(process.env.OPENAI_DECIDER_TOPK ?? 10),
  OPENAI_DECIDER_MAX_FAQS: Number(process.env.OPENAI_DECIDER_MAX_FAQS ?? 3),
  OPENAI_DECIDER_MIN_CONFIDENCE: Number(process.env.OPENAI_DECIDER_MIN_CONFIDENCE ?? 0.65),
  OPENAI_DECIDER_TEMPERATURE: Number(process.env.OPENAI_DECIDER_TEMPERATURE ?? 0.1),
  OPENAI_DECIDER_MAX_TOKENS: Number(process.env.OPENAI_DECIDER_MAX_TOKENS ?? 420),

  TIMEZONE: process.env.TIMEZONE || "Europe/Helsinki",
  BOT_ACTIVE_START: Number(process.env.BOT_ACTIVE_START ?? 21),
  BOT_ACTIVE_END: Number(process.env.BOT_ACTIVE_END ?? 9),

  FAQ_FILE_PATH: process.env.FAQ_FILE_PATH || "./data/faq.json",

  // Confidence threshold for FAQ match (string similarity)
  CONFIDENCE_THRESHOLD: Number(process.env.CONFIDENCE_THRESHOLD ?? 0.85),

  // Kuinka monen minuutin jälkeen botti saa ottaa keissin takaisin HUMAN-tilasta.
  // Jos arvo on tyhjä tai 0, botti ei ota keisseja takaisin.
  HUMAN_TIMEOUT_MINUTES: Number(process.env.HUMAN_TIMEOUT_MINUTES ?? 0),

  AGENT_API_KEY: process.env.AGENT_API_KEY || process.env.X_AGENT_KEY || "",
};

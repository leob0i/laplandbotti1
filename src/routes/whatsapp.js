import { Router } from "express";
import { config } from "../config.js";
import {
  findOrCreateConversationByPhone,
  addMessage,
} from "../services/conversationStore.js";
import { handleIncomingCustomerMessage } from "../services/botService.js";
import { sendTextMessage } from "../services/whatsappService.js";
import { enqueueConversation } from "../../utils/conversationQueue.js";
import { isDuplicateWaMessageId } from "../services/conversationStore.js";
import { shouldAutoSilence } from "../../utils/autoSilence.js";



const router = Router();

// WEBHOOK VERIFY (GET)
router.get("/", (req, res) => {
  const mode = req.query["hub.mode"];
  const rawToken = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  const token = typeof rawToken === "string" ? rawToken.trim() : "";
  const expected = (config.WHATSAPP_VERIFY_TOKEN || "").trim();

  if (mode === "subscribe" && token && expected && token === expected && challenge) {
    console.log("[WHATSAPP] Webhook verify OK");
    return res.status(200).send(challenge);
  }

  console.warn("[WHATSAPP] Webhook verify FAILED", {
    mode,
    tokenReceived: token,
    expectedTokenLength: expected.length,
  });

  return res.sendStatus(403);
});

function shouldLogRawWebhook() {
  // Opt-in debug: set e.g. LOG_RAW_WEBHOOK=1 in .env when needed
  const v = (process.env.LOG_RAW_WEBHOOK || "").trim();
  return v === "1" || v.toLowerCase() === "true";
}

function normalizeQueueKey(phone) {
  // 1) string + trim
  let p = String(phone || "").trim();

  // 2) poista välilyönnit, sulut, viivat yms (jätä vain numerot ja mahdollinen alun '+')
  p = p.replace(/[^\d+]/g, "");

  // 3) poista alusta '+' jotta "+358..." ja "358..." ovat sama key
  p = p.replace(/^\+/, "");

  return p || "unknown";
}


async function processWebhookEntries(entries) {
  // 1) COEXISTENCE echo:t (ihminen vastasi WA Business -apista)
  //    -> tallennetaan AGENT-viestinä ja store vaihtaa status HUMAN:ksi
  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      if (change?.field !== "smb_message_echoes") continue;

      const value = change?.value;
      const echoes = Array.isArray(value?.message_echoes) ? value.message_echoes : [];

    for (const echo of echoes) {
  const toPhone = echo?.to;     // asiakasnumero
  const waMessageId = echo?.id; // wamid...
  const type = echo?.type;

  let text = "";
  if (type === "text") text = typeof echo?.text?.body === "string" ? echo.text.body : "";
  else text = `[${type || "unknown"} message from business app]`;

  const cleanText = String(text || "").trim();
if (!toPhone || !waMessageId) continue;

// 1) Laske queueKey heti tähän
const queueKey = normalizeQueueKey(toPhone);

// 2) Sitten määrittele run() joka käyttää queueKey:tä
const run = async () => {
  if (config.ENABLE_INBOUND_DEDUPE && isDuplicateWaMessageId(waMessageId)) {
    console.log("[WHATSAPP] DEDUPED SMB echo", { to: toPhone, queueKey, waMessageId, type });
    return;
  }

  const conversation = findOrCreateConversationByPhone(queueKey);

  if (!conversation) return;

  addMessage(conversation.id, "AGENT", cleanText, waMessageId);

  console.log("[WHATSAPP] SMB echo stored as AGENT", {
    to: toPhone,
    queueKey,
    waMessageId,
    type,
  });
};

// 3) Aja jonon kautta (tai suoraan jos queue off)
if (config.ENABLE_PER_USER_QUEUE) {
  await enqueueConversation(queueKey, run);
} else {
  await run();
}


}

    }
  }

  // 2) Normaalit asiakkaan inbound-viestit (value.messages[])
  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = change?.value;
      const msgs = Array.isArray(value?.messages) ? value.messages : [];

      for (const message of msgs) {
        const customerPhone = message?.from;
        const messageId = message?.id;
        const type = message?.type;

        let messageText = "";
        if (type === "text") messageText = typeof message?.text?.body === "string" ? message.text.body : "";
        else messageText = `[${type || "unknown"} message]`;

        const cleanText = String(messageText || "").trim();

        if (!customerPhone || !messageId) continue;

// 1) Laske queueKey heti
const queueKey = normalizeQueueKey(customerPhone);

// 2) (Valinnainen) logiin myös queueKey
console.log("Incoming WhatsApp message", {
  messageId,
  from: customerPhone,
  queueKey,
  type,
  hasText: Boolean(cleanText),
});

// 3) Kääri koko käsittely run()-funktioon
const run = async () => {
  // Dedupe (ettei sama viesti käsitellä kahdesti)
  if (config.ENABLE_INBOUND_DEDUPE && isDuplicateWaMessageId(messageId)) {
    console.log("[WHATSAPP] DEDUPED CUSTOMER inbound", { from: customerPhone, queueKey, messageId, type });
    return;
  }

  const conversation = findOrCreateConversationByPhone(queueKey);

  if (!conversation) return;

  // Tallennetaan aina inboxiin (myös non-text placeholder)
  addMessage(conversation.id, "CUSTOMER", cleanText, messageId);

// 1) Hiljennä botti "ok/thanks/kiitos" -kuittauksiin (mutta tallenna viesti silti)
if (type === "text" && cleanText && shouldAutoSilence(cleanText)) {
  console.log("[BOT] Auto-silence ACK", {
    from: customerPhone,
    queueKey,
    messageId,
    text: cleanText,
  });
  return; // EI kutsuta handleIncomingCustomerMessagea, EI lähetetä mitään takaisin
}

// 2) Bottilogiikka ajetaan vain tekstille
if (type === "text" && cleanText) {
  await handleIncomingCustomerMessage(conversation, cleanText);
}

};

// 4) Aja jonon kautta (tai suoraan)
if (config.ENABLE_PER_USER_QUEUE) {
  await enqueueConversation(queueKey, run);
} else {
  await run();
}

      }
    }
  }
}

// INCOMING MESSAGES (POST)
router.post("/", (req, res) => {
  // KUITATAAN HETI 200, jotta Meta ei retrytä pitkän prosessoinnin takia
  // (OpenAI + WhatsApp send voi kestää)
  const entries = Array.isArray(req.body?.entry) ? req.body.entry : [];

  if (shouldLogRawWebhook()) {
    console.log("[WhatsApp] RAW WEBHOOK BODY:", JSON.stringify(req.body));
  }

  res.sendStatus(200);

  // Prosessointi vasta vastauksen jälkeen (ei muuta logiikkaa, vain parantaa luotettavuutta)
  setImmediate(async () => {
    try {
      await processWebhookEntries(entries);
    } catch (err) {
      console.error("[WhatsApp] Webhook processing failed:", err);
    }
  });
});

router.post("/debug/send", async (req, res, next) => {
  try {
    const { to, text } = req.body || {};
    if (!to || !text) {
      return res.status(400).json({ error: "Expected body: { to, text }" });
    }

    await sendTextMessage(to, text);
    res.json({ status: "sent" });
  } catch (err) {
    next(err);
  }
});

export default router;

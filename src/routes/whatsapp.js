import { Router } from "express";
import { config } from "../config.js";
import {
  findOrCreateConversationByPhone,
  addMessage,
} from "../services/conversationStore.js";
import { handleIncomingCustomerMessage } from "../services/botService.js";
import { sendTextMessage } from "../services/whatsappService.js";

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

        const conversation = findOrCreateConversationByPhone(toPhone);
        if (!conversation) continue;

        addMessage(conversation.id, "AGENT", cleanText, waMessageId);

        console.log("[WHATSAPP] SMB echo stored as AGENT", {
          to: toPhone,
          waMessageId,
          type,
        });
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

        console.log("Incoming WhatsApp message", {
          messageId,
          from: customerPhone,
          type,
          hasText: Boolean(cleanText),
        });

        if (!customerPhone || !messageId) continue;

        const conversation = findOrCreateConversationByPhone(customerPhone);
        if (!conversation) continue;

        // Tallennetaan aina inboxiin (myös non-text placeholder)
        addMessage(conversation.id, "CUSTOMER", cleanText, messageId);

        // Bottilogiikka ajetaan vain tekstille
        if (type === "text" && cleanText) {
          await handleIncomingCustomerMessage(conversation, cleanText);
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

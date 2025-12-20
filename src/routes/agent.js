import { Router } from "express";
import {
  listConversations,
  listMessages,
  getConversationById,
  addMessage,
  updateConversationStatus,
} from "../services/conversationStore.js";
import { sendTextMessage } from "../services/whatsappService.js";
import { config } from "../config.js";

const router = Router();

/**
 * Simple Agent API auth middleware
 * - Uses AGENT_API_KEY env variable
 * - If AGENT_API_KEY is empty -> no auth required (dev/test friendly)
 *
 * NOTE: Prefer headers over query params in production.
 */
router.use((req, res, next) => {
  const expectedKey = (config.AGENT_API_KEY || "").trim();

  // If not configured, do not enforce auth
  if (!expectedKey) return next();

  const providedKey =
    (req.header("X-AGENT-KEY") || req.header("x-agent-key") || "").trim() ||
    (req.header("x-api-key") || req.header("X-API-KEY") || "").trim() ||
    (typeof req.query.agentKey === "string" ? req.query.agentKey.trim() : "");

  if (!providedKey || providedKey !== expectedKey) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  next();
});

/**
 * GET /agent/conversations?status=AUTO|HUMAN&limit=50&offset=0
 */
router.get("/conversations", (req, res) => {
  const statusRaw = typeof req.query.status === "string" ? req.query.status.trim() : "";
  const statusUpper = statusRaw ? statusRaw.toUpperCase() : undefined;
  const status =
    statusUpper === "AUTO" || statusUpper === "HUMAN" ? statusUpper : undefined;

  const limit = parsePositiveInt(req.query.limit, 50, 200);
  const offset = parsePositiveInt(req.query.offset, 0, 1_000_000);

  const conversations = listConversations({ status, limit, offset });
  return res.json({ conversations });
});

/**
 * GET /agent/conversations/:id/messages
 */
router.get("/conversations/:id/messages", (req, res) => {
  const conversation = getConversationById(req.params.id);
  if (!conversation) {
    return res.status(404).json({ ok: false, error: "Conversation not found" });
  }

  const messages = listMessages(req.params.id);
  return res.json({ messages });
});

/**
 * POST /agent/conversations/:id/reply
 * Body: { text: string }
 *
 * Coexistence-critical behavior:
 * - Store AGENT message first => conversation becomes HUMAN-owned.
 * - Then send message to WhatsApp Cloud API.
 */
router.post("/conversations/:id/reply", async (req, res) => {
  const conversation = getConversationById(req.params.id);
  if (!conversation) {
    return res.status(404).json({ ok: false, error: "Conversation not found" });
  }

  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  if (!text) {
    return res.status(400).json({ ok: false, error: "Missing text" });
  }

  try {
    // 1) Persist first (coexistence: AGENT reply => HUMAN)
    addMessage(conversation.id, "AGENT", text);

    // This is currently redundant because addMessage('AGENT') already flips to HUMAN,
    // but we keep it as an explicit safeguard for future store implementations.
    updateConversationStatus(conversation.id, "HUMAN");

    // 2) Send to WhatsApp
    await sendTextMessage(conversation.customerPhone, text);

    return res.status(202).json({ ok: true, status: "sent" });
  } catch (err) {
    console.error("[AGENT] reply failed:", err);
    return res.status(502).json({ ok: false, error: "Failed to send message" });
  }
});

function parsePositiveInt(value, fallback, max) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 0) return fallback;
  if (typeof max === "number" && parsed > max) return max;
  return parsed;
}

export default router;

import express from "express";
import { config } from "./config.js";

// Routes
import whatsappRoutes from "./routes/whatsapp.js";
import agentRoutes from "./routes/agent.js";

// Services needed for debug route
import {
  findOrCreateConversationByPhone,
  addMessage,
} from "./services/conversationStore.js";
import { handleIncomingCustomerMessage } from "./services/botService.js";

console.log("[Build] RENDER_GIT_COMMIT =", process.env.RENDER_GIT_COMMIT || "N/A");
console.log("[Build] RENDER_SERVICE_NAME =", process.env.RENDER_SERVICE_NAME || "N/A");
console.log("[Build] startedAt =", new Date().toISOString());


const app = express();

// JSON-bodyjen käsittely
app.use(express.json({ limit: "1mb" }));

// Health-check
app.get("/health", (req, res) => {
  res.json({ ok: true, service: "laplandbotti1" });
});

// DEBUG: mock-viesti ilman WhatsAppia
app.post("/debug/mock-message", async (req, res) => {
  const { phone, text } = req.body || {};
  if (!phone || !text) {
    return res.status(400).json({ error: "phone and text required" });
  }

  const conversation = findOrCreateConversationByPhone(phone);
  addMessage(conversation.id, "CUSTOMER", text);

  await handleIncomingCustomerMessage(conversation, text, { type: "text" });


  return res.json({ ok: true, conversationId: conversation.id });
});

// Varsinaiset reitit
app.use("/webhook/whatsapp", whatsappRoutes);
app.use("/agent", agentRoutes);

app.listen(config.PORT, () => {
  console.log(`Server listening on port ${config.PORT}`);
});

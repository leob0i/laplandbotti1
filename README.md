# Project spec: WhatsApp FAQ Bot (coexistence mode, backend only)

## 0. High-level idea

We build a **Node.js backend** that connects to **WhatsApp Cloud API** and **OpenAI API**, and serves as:

- an **auto-reply FAQ bot** using company FAQ data
- a **human handover system** with conversation state:
  - `AUTO` → bot allowed to reply
  - `HUMAN` → only human replies, bot stays silent
- supports **coexistence mode**:
  - same phone number in **WhatsApp Business App** (on phone) AND in **Cloud API**
  - messages are handled by this backend (bot + REST API for inbox)
  - WhatsApp calls still ring on the phone app (backend does not touch calls)

We only implement the **backend** for now:

- WhatsApp webhook endpoint
- logic for FAQ + OpenAI
- working hours logic (e.g. bot active 21:00–09:00)
- conversation state machine (AUTO / HUMAN)
- basic REST endpoints for a future inbox UI (list conversations, list messages, send reply)

No frontend/inbox UI yet – that will come later as a separate project that calls these endpoints.

---

## 1. Tech stack

- Runtime: **Node.js 20+**
- Language: **JavaScript (ESM)** or **TypeScript** (choose one; TypeScript is preferred if easy)
- Framework: **Express**
- HTTP server only (no SSR, no pages)
- Database:
  - Phase 1: simple in-memory store or JSON file (for easier start)
  - Phase 2: switch to **SQLite/PostgreSQL with Prisma** (optional, to be done later)
- External services:
  - **WhatsApp Cloud API** (Meta)
  - **OpenAI API** (for FAQ matching / confidence scoring)

---

## 2. Environment variables

Use `.env` file and `process.env` (with dotenv) for configuration:

- `PORT` – HTTP port (default 3000)
- `WHATSAPP_VERIFY_TOKEN` – verify token for webhook validation
- `WHATSAPP_ACCESS_TOKEN` – permanent/token for calling Cloud API
- `WHATSAPP_PHONE_NUMBER_ID` – phone number ID used in Cloud API send-message endpoint
- `OPENAI_API_KEY` – OpenAI API key
- `TIMEZONE` – e.g. `Europe/Helsinki` or `Asia/Bangkok`
- `BOT_ACTIVE_START` – start hour when bot is active (e.g. `21` for 21:00)
- `BOT_ACTIVE_END` – end hour when bot is active (e.g. `9` for 09:00)
- `FAQ_FILE_PATH` – path to FAQ JSON file (e.g. `./data/faq.json`)

---

## 3. Project structure (backend only)

```text
project-root/
  package.json
  .env.example
  src/
    index.js             # App entrypoint (create Express app)
    config.js            # Load env, constants (hours, timezone)
    routes/
      whatsapp.js        # Webhook endpoints (GET verify, POST messages)
      agent.js           # Agent API: list conversations, messages, send reply
    services/
      whatsappService.js # Sending messages via Cloud API
      faqService.js      # Loading FAQ data + matching logic
      openaiService.js   # Wrapper around OpenAI calls
      botService.js      # Main bot routing logic (AUTO/HUMAN decisions)
      timeService.js     # Working hours logic, timezone helpers
      conversationStore.js # In-memory/DB for conversations and messages
    types/               # (optional) shared JS/TS types
  data/
    faq.json             # Local FAQ data (for testing)
  README.md              # This spec / doc
4. Data model (conceptual)
For now we can implement these as simple JS objects in memory; later move to DB.

Conversation
ts
Kopioi koodi
Conversation {
  id: string;                // internal ID (UUID)
  customerPhone: string;     // WhatsApp customer phone (in a normalized format)
  status: "AUTO" | "HUMAN";  // who should handle: bot or human
  lastMessageAt: Date;
  createdAt: Date;
}
Message
ts
Kopioi koodi
Message {
  id: string;
  conversationId: string;
  from: "CUSTOMER" | "BOT" | "AGENT";
  text: string;
  waMessageId?: string;      // WhatsApp message id if available
  createdAt: Date;
}
These will be managed by conversationStore.js with a clear interface:

ts
Kopioi koodi
// conversationStore.js
function findOrCreateConversationByPhone(customerPhone): Conversation
function getConversationById(id): Conversation | null
function listConversations({ status?, limit?, offset? }): Conversation[]
function updateConversationStatus(id, status: "AUTO" | "HUMAN"): void

function addMessage(conversationId, from, text, waMessageId?): Message
function listMessages(conversationId): Message[]
5. Working hours logic
We need to know if the bot should respond automatically at a given moment.

Requirements
Bot is active only during certain hours (e.g. 21:00–09:00).

Hours are in a configurable timezone (from TIMEZONE env).

Outside those hours:

bot should NOT auto-reply (unless explicitly overridden later).

conversation should be marked for human: status = "HUMAN".

Implementation (timeService.js)
Export helper functions:

ts
Kopioi koodi
function isBotActiveNow(now = new Date()): boolean
// uses TIMEZONE, BOT_ACTIVE_START, BOT_ACTIVE_END
Supports ranges that cross midnight (e.g. 21 → 9).

Example:

if start = 21, end = 9, bot active when hour >= 21 || hour < 9.

6. FAQ + OpenAI logic (faqService + openaiService)
We want:

Bot only answers if confidence is high enough.

Otherwise bot stays silent, conversation goes to HUMAN.

faqService.js
Responsibilities:

Load FAQ JSON from FAQ_FILE_PATH.

Each FAQ item:

ts
Kopioi koodi
{
  id: string;
  question: string;
  answer: string;
  tags?: string[];
}
Provide function:

ts
Kopioi koodi
async function findBestFaqMatch(userQuestion: string): Promise<{ faq: FaqItem | null; score: number; }>
Implementation options:

Phase 1: Simple semantic matching using OpenAI embeddings, or even basic string similarity:

Precompute embeddings for each FAQ question (optional for first version).

On each message, compute embedding for user question and pick best cosine similarity.

If using a simpler approach first:

Use quick fuzzy matching (string distance, etc.).

We can later refactor to embeddings.

openaiService.js
Wrapper around OpenAI chat:

Provide function:

ts
Kopioi koodi
async function rewriteFaqAnswer(userQuestion: string, faqAnswer: string, languageHint?: "fi" | "en"): Promise<string>
System prompt example:

Always use answer content from FAQ only

Optionally answer in Finnish if user writes Finnish, English if user writes English

No hallucinations, if the FAQ doesn’t cover topic, return a specific marker, e.g. NO_VALID_ANSWER.

Confidence logic
In botService.js:

When a new customer message arrives and we’re in AUTO mode:

Call findBestFaqMatch() → get score.

If score < CONFIDENCE_THRESHOLD (e.g. 0.85), then:

do not send any reply

set conversation.status = "HUMAN".

If score >= threshold:

Call rewriteFaqAnswer() to personalize/translate the answer.

Send reply through WhatsApp.

Add message as from: "BOT".

7. Bot state machine (AUTO / HUMAN)
Rules
AUTO → bot is allowed to reply (within working hours).

HUMAN → bot must be silent for this conversation, until manually reset.

Transitions
New conversation:

Default state: AUTO (configurable).

New customer message:

If conversation.status === "HUMAN" → only store message, no bot reply.

Else:

If isBotActiveNow() and FAQ match is confident → bot replies.

Else → set status = "HUMAN" and do not reply.

Agent reply (from inbox API):

When agent sends reply via /agent/reply → always set status = "HUMAN".

Manual switch (future feature):

Add endpoint to switch conversation back to AUTO (optional):

PATCH /agent/conversations/:id/status with { status: "AUTO" }.

8. WhatsApp integration (webhook + send)
routes/whatsapp.js
Two main routes:

GET /webhook/whatsapp

For Meta verification:

Read hub.mode, hub.verify_token, hub.challenge.

If verify_token matches WHATSAPP_VERIFY_TOKEN, respond with hub.challenge.

POST /webhook/whatsapp

Handle incoming messages:

Extract phone number, message id, message text from the webhook payload.

Use conversationStore.findOrCreateConversationByPhone(customerPhone).

Add message: from "CUSTOMER".

Call botService.handleIncomingCustomerMessage(conversation, message).

whatsappService.js
Functions:

ts
Kopioi koodi
async function sendTextMessage(toPhone: string, text: string): Promise<void>
Implementation:

Use WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN.

POST to Cloud API endpoint:

https://graph.facebook.com/v21.0/{PHONE_NUMBER_ID}/messages

Body:

json
Kopioi koodi
{
  "messaging_product": "whatsapp",
  "to": "<toPhone>",
  "type": "text",
  "text": { "body": "<text>" }
}
9. Agent / inbox API (for future frontend)
We expose a minimal REST API for a future web inbox UI.

routes/agent.js
Protected with a simple API key header at first (e.g. X-AGENT-KEY), or no auth for local dev.

Endpoints:

GET /agent/conversations

Query params: status (optional), limit, offset.

Returns array of conversations sorted by lastMessageAt desc.

GET /agent/conversations/:id/messages

Returns array of messages for that conversation, sorted by createdAt asc.

POST /agent/conversations/:id/reply

Body: { text: string }

Flow:

Load conversation.

Add message with from: "AGENT".

Set conversation.status = "HUMAN".

Use whatsappService.sendTextMessage(conversation.customerPhone, text).

(optional, later) PATCH /agent/conversations/:id/status

Body: { status: "AUTO" | "HUMAN" }

Allows agent to manually give conversation back to bot.

10. botService.js – main logic for incoming messages
Pseudo-code for the central handler:

ts
Kopioi koodi
async function handleIncomingCustomerMessage(conversation, messageText) {
  // 1. If HUMAN mode → store only, do nothing
  if (conversation.status === "HUMAN") {
    // just store message, maybe notify inbox in future
    return;
  }

  // 2. Check working hours
  const active = isBotActiveNow();
  if (!active) {
    // Bot should not auto-reply
    // Mark for human
    updateConversationStatus(conversation.id, "HUMAN");
    return;
  }

  // 3. Try FAQ
  const { faq, score } = await findBestFaqMatch(messageText);

  if (!faq || score < CONFIDENCE_THRESHOLD) {
    // Not confident enough
    updateConversationStatus(conversation.id, "HUMAN");
    return;
  }

  // 4. Use OpenAI to rewrite/translate answer (optional)
  const botReply = await rewriteFaqAnswer(messageText, faq.answer);

  // 5. Send reply via WhatsApp
  await sendTextMessage(conversation.customerPhone, botReply);

  // 6. Store message as BOT
  addMessage(conversation.id, "BOT", botReply);

  // Keep conversation in AUTO state for now (unless we decide otherwise later)
}
11. Phases (implementation steps)
Phase 1 – Skeleton
Setup Node + Express project.

Implement config.js, index.js.

Add /webhook/whatsapp GET + POST:

POST: log incoming payload to console.

Implement whatsappService.sendTextMessage() + simple test endpoint /debug/send.

Phase 2 – Conversation store (in-memory)
Implement conversationStore.js with in-memory arrays.

On each incoming message:

find or create conversation.

store messages.

Phase 3 – Working hours + AUTO/HUMAN state
Add timeService.isBotActiveNow().

Implement Conversation.status field with default AUTO.

Add state transitions as defined above.

Phase 4 – Simple FAQ matching
Add faq.json and faqService.findBestFaqMatch() using simple string similarity or placeholder.

Add CONFIDENCE_THRESHOLD constant (e.g. 0.85).

In botService.handleIncomingCustomerMessage():

call FAQ matching.

if good match, reply with raw faq.answer (no OpenAI).

otherwise mark HUMAN.

Phase 5 – OpenAI integration (optional at first)
Implement openaiService.rewriteFaqAnswer().

Wrap FAQ answer with ChatCompletion call to:

keep answer content same

adjust language / tone.

Phase 6 – Agent API
Implement /agent/conversations, /agent/conversations/:id/messages, /agent/conversations/:id/reply.

For now, no auth or simple API key.

Phase 7 – Persistency (later)
Replace in-memory store with SQLite/Postgres + Prisma:

Conversation table

Message table

Keep the same interface in conversationStore.js so other services do not change.

12. Non-goals (for NOW)
No frontend / inbox UI in this repo (will be a separate project).

No WhatsApp Calling API integration (voice calls are handled only by phone app).

No multi-tenant / multi-business support (single business only).

No advanced analytics – just log basic events.

13. Testing
Add a simple script or HTTP client collection (e.g. for Thunder Client / Postman) to:

simulate incoming webhook data (mock JSON).

test agent endpoints.

For real WhatsApp testing:

configure Cloud API app + phone number

set webhook URL to /webhook/whatsapp on this backend.









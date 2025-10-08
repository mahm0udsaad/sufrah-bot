### Dashboard Agent Integration Prompt

Build a real-time chat page for restaurant owners that:
- Lists current conversations
- Streams live messages
- Loads message history
- Supports a global “Stop Bot” toggle

Base URL: `https://bot.sufrah.sa`

### 1) WebSocket for real-time updates
- Connect to: `wss://bot.sufrah.sa/ws`
- On open, server sends (bootstrap):
  - `{ type: "connection", data: "connected" }`
  - `{ type: "conversation.bootstrap", data: Conversation[] }`
  - `{ type: "bot.status", data: { enabled: boolean } }`
- During operation, you will receive broadcasts:
  - `{ type: "message.created", data: Message }`
  - `{ type: "conversation.updated", data: Conversation }`
  - `{ type: "bot.status", data: { enabled: boolean } }`

Keepalive: send the string `"ping"` every 30–60s; server replies with `pong`.

### 2) REST endpoints
- `GET /api/conversations` → Conversation[] (ordered by last activity)
- `GET /api/conversations/:conversationId/messages` → Message[] (marks conversation read server-side)
- `POST /api/conversations/:conversationId/send` with `{ "message": "text" }` → send manual reply
- `POST /api/bot/toggle` with `{ "enabled": true|false }` → global Stop Bot toggle
- Optional (not required for the chat page): `POST /api/whatsapp/send` with `Authorization: Bearer WHATSAPP_SEND_TOKEN`

### 3) Payload shapes
Conversation
```
{
  id: string,                 // normalized customer number; use as conversation key
  customer_phone: string,
  customer_name: string,
  status: 'active' | string,
  last_message_at: string,    // ISO timestamp
  unread_count: number,
  is_bot_active: boolean,
}
```

Message
```
{
  id: string,
  conversation_id: string,
  from_phone: string,
  to_phone: string,
  message_type: 'text' | 'image' | 'document' | 'audio' | string,
  content: string,            // templates/interactive already resolved to display text
  media_url: string | null,
  timestamp: string,          // ISO timestamp
  is_from_customer: boolean,
}
```

Notes:
- Template and interactive outbound messages are normalized to `message_type: 'text'` and have human-readable `content`.
- Location messages arrive as text like `"📍 lat, lon"` or with address; render plainly.

### 4) Real-time UI flow
- On page load:
  - Open WebSocket, handle `conversation.bootstrap` → initialize conversation list
  - Also fetch `GET /api/conversations` as a safety sync
- When a conversation is selected:
  - Fetch `GET /api/conversations/:id/messages` → render messages; this clears unread server-side
- Live updates:
  - On `message.created`: append to the open thread; if thread not open, increment `unread_count` on its list item (or insert new item)
  - On `conversation.updated`: merge fields onto the list item (status, last_message_at, unread_count, is_bot_active)
  - On `bot.status`: update Stop Bot toggle UI
- Sending a reply:
  - `POST /api/conversations/:id/send` with `{ message }`
  - Optimistically append; real-time `message.created` will follow shortly

### 5) Stop Bot (global)
- Reflect current state from the initial `bot.status` message
- Toggle by calling `POST /api/bot/toggle` with `{ enabled: false }` to stop or `{ enabled: true }` to resume
- Server broadcasts `bot.status` to all clients; update UI accordingly

### 6) Conversation identity
- `conversation.id` equals the normalized customer WhatsApp number; treat it as the unique thread identifier

### 7) Persisted history
- Inbound and outbound messages are saved in the database
- Current messages API returns in-memory history; if you need deep paging (older-than-memory), request an enhancement endpoint (e.g., `before` + `limit` query params) that proxies DB paging

### 8) Robustness and UX
- Use secure websockets in production: `wss://`
- Reconnect on close with exponential backoff
- Keep scroll pinned when within ~100px of bottom; do not auto-scroll if the user is reading older messages
- Show unread badges from `unread_count`; they clear after fetching the message list

### 9) Minimal sample snippets

WebSocket connection and handlers
```typescript
const ws = new WebSocket('wss://bot.sufrah.sa/ws');

ws.onmessage = (ev) => {
  const { type, data } = JSON.parse(ev.data);
  switch (type) {
    case 'connection':
      break;
    case 'conversation.bootstrap':
      bootstrapConversations(data);
      break;
    case 'message.created':
      onMessageCreated(data);
      break;
    case 'conversation.updated':
      onConversationUpdated(data);
      break;
    case 'bot.status':
      setBotToggle(data.enabled);
      break;
  }
};

setInterval(() => {
  if (ws.readyState === WebSocket.OPEN) ws.send('ping');
}, 30000);
```

Fetch conversations and messages
```typescript
async function fetchConversations() {
  const res = await fetch('https://bot.sufrah.sa/api/conversations');
  return res.json();
}

async function fetchMessages(conversationId: string) {
  const res = await fetch(`https://bot.sufrah.sa/api/conversations/${encodeURIComponent(conversationId)}/messages`);
  return res.json();
}
```

Send a reply
```typescript
async function sendReply(conversationId: string, text: string) {
  await fetch(`https://bot.sufrah.sa/api/conversations/${encodeURIComponent(conversationId)}/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: text }),
  });
}
```

Stop Bot toggle
```typescript
async function toggleBot(enabled: boolean) {
  const res = await fetch('https://bot.sufrah.sa/api/bot/toggle', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
  return res.json(); // { enabled: boolean }
}
```

### 10) Testing checklist
- WebSocket connects and receives `conversation.bootstrap` and `bot.status`
- New inbound messages appear in real time via `message.created`
- Manual send posts succeed and echo back via `message.created`
- Selecting a conversation resets its unread count after fetching messages
- Stop Bot toggle changes state and receives a `bot.status` broadcast



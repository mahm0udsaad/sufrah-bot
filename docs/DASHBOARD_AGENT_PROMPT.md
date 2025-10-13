## Dashboard Agent Integration Prompt (Next.js + Tailwind CSS + shadcn/ui)

Build a multi-tenant dashboard for restaurant owners to monitor and control their WhatsApp bot. Use the contracts below to implement real-time chat, order management, bot management, onboarding, and payment visibility. You have a schema similar to the bot service. Focus on clear UX, resilient realtime, and safe actions.

Base URL for the bot service: `https://bot.sufrah.sa`

### Key Surfaces
- Live Chat: conversations list, message thread, human takeover (pause bot), send text/images/files.
- Orders: list, detail (items, totals, delivery/pickup info), status, payment details, rating data.
- Bot Management: global stop/resume, per-thread pause/resume, rate limits, sender status, templates overview.
- Onboarding: collect Twilio sender details per restaurant, show verification status, admin approval.
- Logs: webhook logs and outbound message logs for troubleshooting.

## Data Model (what you can render)
Map your schema to the following entities saved by the bot service. Field names below mirror Prisma and/or API mappings. Render at least the bolded fields.

- Conversation
  - id (cuid), restaurantId, customerWa, customerName, status, lastMessageAt, unreadCount, isBotActive
  - UI: list rows show: customerName/customerWa, lastMessageAt, unreadCount, isBotActive.

- Message
  - id, restaurantId, conversationId, direction (IN|OUT), waSid, messageType, content, mediaUrl, metadata, createdAt
  - UI bubble: by direction; support messageType: text, image, document, audio; show mediaUrl previews.

- OutboundMessage
  - id, restaurantId, conversationId, toPhone, fromPhone, body, channel, templateSid, templateName, status, waSid, errorCode, errorMessage, metadata, createdAt
  - UI: message send audit/logs on conversation side panel.

- Order
  - id, restaurantId, conversationId, status, statusStage, orderReference, orderType, paymentMethod, totalCents, currency, deliveryAddress, deliveryLat/Lng, branchId/name/address, rating, ratingComment, ratedAt, ratingAskedAt, meta (includes paymentUpdate via `/status`)
  - UI: orders table and detail; show paymentUpdate from meta.paymentUpdate: { orderNumber, status, paymentStatus, merchantId, receivedAt }.

- OrderItem
  - id, orderId, name, qty, unitCents, totalCents
  - UI: order detail items breakdown.

- Restaurant
  - id, userId, name, whatsappNumber, status (OnboardingStatus), externalMerchantId, createdAt, updatedAt
  - UI: tenant switcher and onboarding status.

- RestaurantBot
  - id, restaurantId, name, restaurantName, whatsappNumber, accountSid, subaccountSid, wabaId, senderSid, verificationSid, status (BotStatus), verifiedAt, errorMessage, isActive, maxMessagesPerMin/Day, supportContact, paymentLink
  - UI: bot management panel (sender status, limits, actions).

- WebhookLog
  - id, restaurantId, requestId, method, path, headers, body, statusCode, errorMessage, createdAt
  - UI: logs page with filters by path (e.g., `/status`), statusCode.

## Realtime Contracts

### WebSocket
- Connect: `wss://bot.sufrah.sa/ws`
- On open, you will receive (order may vary):
  - `{ type: "connection", data: "connected" }`
  - `{ type: "conversation.bootstrap", data: Conversation[] }`
  - `{ type: "bot.status", data: { enabled: boolean } }`
- Broadcasts:
  - `{ type: "message.created", data: Message }`
  - `{ type: "conversation.updated", data: Conversation }`
  - `{ type: "bot.status", data: { enabled: boolean } }`
- Keepalive: send `"ping"` every 30–60s; server replies with `pong`.

Suggested client wrapper (Next.js app router):
```typescript
// app/(dashboard)/providers/realtime.tsx
"use client";
import { createContext, useContext, useEffect, useRef, useState } from "react";

type Event = { type: string; data: any };

const RealtimeCtx = createContext<{ ws?: WebSocket; send: (x: any) => void }>({ send: () => {} });

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const wsRef = useRef<WebSocket>();
  const [, setTick] = useState(0);

  useEffect(() => {
    const ws = new WebSocket(process.env.NEXT_PUBLIC_WS_URL!);
    wsRef.current = ws;
    const heart = setInterval(() => { if (ws.readyState === ws.OPEN) ws.send("ping"); }, 30000);
    ws.onmessage = (ev) => {
      const evt: Event = JSON.parse(ev.data);
      // TODO: dispatch to stores (conversations/messages/bot status)
    };
    ws.onclose = () => setTimeout(() => setTick((t) => t + 1), 1500);
    return () => { clearInterval(heart); ws.close(); };
  }, [setTick]);

  return <RealtimeCtx.Provider value={{ ws: wsRef.current, send: (x) => wsRef.current?.send(JSON.stringify(x)) }}>{children}</RealtimeCtx.Provider>;
}

export const useRealtime = () => useContext(RealtimeCtx);
```

## REST Endpoints

- Conversations
  - `GET /api/conversations` → Conversation[] (ordered by last activity)
  - `GET /api/conversations/:conversationId/messages` → Message[] (marks conversation read server-side)
  - `POST /api/conversations/:conversationId/send` `{ message: string }` → manual text reply
  - `POST /api/conversations/:conversationId/toggle-bot` `{ enabled: boolean }` → pause/resume bot for this thread

- Bot control
  - `POST /api/bot/toggle` `{ enabled: boolean }` → global stop/resume; real-time broadcast `bot.status` is emitted

- Admin onboarding
  - `GET /api/admin/restaurants` → list with `status == 'PENDING_APPROVAL'`
  - `POST /api/admin/restaurants/:id/approve` → sets status to `ACTIVE`
  - `POST /api/admin/restaurants/:id/reject` → sets status to `REJECTED`

- Messaging (server-to-server)
  - `POST /api/whatsapp/send` with `Authorization: Bearer WHATSAPP_SEND_TOKEN`
    - Body: `{ phoneNumber: string, text: string, fromNumber?: string, templateVariables?: Record<string,string> }`
    - Use via your own Next.js route handler (do not call from browser); store token in server env.

- Payment status webhook (read-only for dashboard, write by bot)
  - `/status` POST is handled by the bot; it writes Order.meta.paymentUpdate and may update Order.status.
  - Dashboard should surface latest payment state from `order.meta.paymentUpdate`.

## UI Requirements by Surface

### Live Chat
- Conversations list (left):
  - Show customer name/number, last message snippet/time, unread badge, isBotActive pill.
  - Filter/search by customer name/number.
  - Multi-tenant: scope to the logged-in restaurant.
- Thread (right):
  - Virtualized list; render text, image, document, audio bubbles.
  - Show direction (IN|OUT); show timestamps.
  - Composer: send text via `POST /api/conversations/:id/send`.
  - Attachment UX: design for image/file upload; call a dashboard backend endpoint that in turn posts to bot’s `/api/whatsapp/send` or a future `/send-media` (reserve UI now; backend wiring can follow).
  - Per-thread Pause Bot toggle: call `POST /api/conversations/:id/toggle-bot`.
  - Global Stop Bot toggle in header: call `POST /api/bot/toggle` and reflect realtime `bot.status`.

Recommended shadcn components: `DataTable` for list, `Textarea`, `Button`, `Badge`, `Switch`, `DropdownMenu`, `Tooltip`, `Skeleton`.

### Orders
- Orders table: columns → orderReference, status, paymentMethod, total, currency, createdAt.
- Filters: status, date range.
- Row click → Order detail drawer/page:
  - Items (name, qty, unit, total), totals, currency formatting
  - Fulfillment: deliveryAddress or branchName/address
  - Payment: show `meta.paymentUpdate` (orderNumber, status, paymentStatus, merchantId, receivedAt)
  - Rating: rating stars + comment (read-only for now)

Optional actions (backend to follow): Update status buttons (Preparing, Out for Delivery, Completed), Resend rating prompt.

### Bot Management Panel (per restaurant)
- Sender status (from `RestaurantBot.status`, `errorMessage`, `verifiedAt`)
- Limits: `maxMessagesPerMin`, `maxMessagesPerDay` (read-only now; design inputs for future)
- Contact and payment link display (supportContact, paymentLink)
- Activation toggle (maps to `RestaurantBot.isActive` – future endpoint)

### Onboarding
- Form to collect Twilio credentials and sender info per restaurant.
- Show current onboarding status from `Restaurant.status` and `RestaurantBot.status`.
- Admin tab (for platform admins): list pending restaurants using `GET /api/admin/restaurants`; approve/reject via POST endpoints.

### Logs
- Webhook logs table from `WebhookLog`: columns → createdAt, path, statusCode, requestId. Row expands to headers/body/error.
- Outbound message logs from `OutboundMessage` (most recent 100): status, errorCode/message, channel, template info.

## Example Types for Frontend State
```typescript
export type UiConversation = {
  id: string;
  customer_phone: string;
  customer_name?: string | null;
  status: 'active' | string;
  last_message_at: string; // ISO
  unread_count: number;
  is_bot_active: boolean;
};

export type UiMessage = {
  id: string;
  conversation_id: string;
  from_phone: string;
  to_phone: string;
  message_type: string;
  content: string;
  media_url?: string | null;
  timestamp: string; // ISO
  is_from_customer: boolean;
};

export type UiOrder = {
  id: string;
  orderReference?: string | null;
  status: string;
  paymentMethod?: string | null;
  totalCents: number;
  currency: string;
  branchName?: string | null;
  deliveryAddress?: string | null;
  meta?: any;
  createdAt: string;
};
```

## Next.js Integration Notes
- Put `NEXT_PUBLIC_WS_URL` in `.env` and wire the RealtimeProvider.
- All REST calls from the browser can go directly to the bot service for now; for sensitive endpoints (`/api/whatsapp/send`) proxy via a Next.js route handler (server-only) that injects the bearer token.
- Use React Query or Zustand for client state; normalize by `conversation.id` and `message.id`.

## Security & Multi-tenancy
- Ensure each dashboard user only sees their `restaurantId` data. If you build your own backend, scope queries by the authenticated tenant.
- Do not expose `WHATSAPP_SEND_TOKEN` to the browser; invoke that endpoint from server-side route handlers only.

## Testing Checklist
- WebSocket connects; receive `conversation.bootstrap`, `bot.status`.
- `GET /api/conversations` and `GET /api/conversations/:id/messages` render correctly; unread clears after message fetch.
- `POST /api/conversations/:id/send` posts and echoes via `message.created`.
- Global and per-thread toggles update UI and reflect in subsequent events.
- Orders table renders, detail shows `meta.paymentUpdate` from `/status` webhook.
- Logs pages render recent `WebhookLog` and `OutboundMessage` records.

## Roadmap Hooks (Future)
- Media send API: design to call a new `/api/conversations/:id/send-media` with file upload; keep UI ready.
- Order status updates from dashboard (backend mutation + bot broadcast).
- Rating prompt manual resend.
- Templates management view (read from Twilio Content or an internal templates table).


### Dashboard Agent Prompt: Read Messages Directly from the Database via Prisma

Purpose: Implement message retrieval in the dashboard by querying the database directly using Prisma. Do not call the bot server for message history. Scope every query to the tenant (restaurant) and conversation.

### Requirements
- Use the same Postgres database as the bot service (share `DATABASE_URL`).
- Use Prisma Client in the dashboard backend (Node/Next.js server code). Do not run Prisma in the browser.
- Enforce multi-tenancy: all reads must be scoped to the authenticated `restaurantId`.

### Setup (Dashboard Project)
1) Install Prisma and client
```bash
npm i -D prisma
npm i @prisma/client
```
2) Configure env
```bash
# .env
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DB_NAME?schema=public
```
3) Introspect and generate client (recommended to mirror the bot schema)
```bash
npx prisma db pull
npx prisma generate
```

### Data Model (as used by the bot)
This is a reference summary. Prefer `db pull` to avoid drift.

```prisma
model Conversation {
  id               String             @id @default(cuid())
  restaurantId     String             @map("restaurant_id")
  customerWa       String             @map("customer_wa")
  status           ConversationStatus @default(active)
  lastMessageAt    DateTime           @map("last_message_at")
  unreadCount      Int                @default(0) @map("unread_count")
  isBotActive      Boolean            @default(true) @map("is_bot_active")
  createdAt        DateTime           @default(now()) @map("created_at")
  updatedAt        DateTime           @updatedAt @map("updated_at")
  messages         Message[]

  @@unique([restaurantId, customerWa])
  @@map("Conversation")
}

model Message {
  id             String   @id @default(cuid())
  restaurantId   String   @map("restaurant_id")
  conversationId String   @map("conversation_id")
  direction      MsgDir
  waSid          String?  @unique @map("wa_sid")
  messageType    String   @map("message_type")
  content        String   @map("body")
  mediaUrl       String?  @map("media_url")
  metadata       Json?    @map("metadata")
  createdAt      DateTime @default(now()) @map("created_at")

  @@index([conversationId, createdAt])
  @@index([restaurantId, createdAt])
  @@map("Message")
}
```

Notes:
- `customerWa` is stored as digits only (no `+`, no `whatsapp:`).
- `direction`: `IN` (from customer) or `OUT` (from restaurant).

### Phone Normalization Helper (Dashboard)
```ts
export function normalizePhone(raw: string): string {
  return raw.replace(/^whatsapp:/, '').replace(/[^\d+]/g, '').replace(/^\+/, '');
}
```

### Query Functions (Use These in the Dashboard Backend)
```ts
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

// 1) List messages by DB conversationId (cuid)
export async function listMessagesByConversationId(
  conversationId: string,
  opts: { limit?: number; before?: Date } = {}
) {
  const limit = opts.limit ?? 100;
  const where: any = { conversationId };
  if (opts.before) where.createdAt = { lt: opts.before };

  const rows = await prisma.message.findMany({
    where,
    orderBy: { createdAt: 'asc' },
    take: limit,
  });
  return rows;
}

// 2) Resolve conversation by restaurant + phone, then list messages
export async function listMessagesByRestaurantAndPhone(
  restaurantId: string,
  customerPhoneRaw: string,
  opts: { limit?: number; before?: Date } = {}
) {
  const customerWa = normalizePhone(customerPhoneRaw);
  const conv = await prisma.conversation.findUnique({
    where: { restaurantId_customerWa: { restaurantId, customerWa } },
    select: { id: true },
  });
  if (!conv) return [];
  return listMessagesByConversationId(conv.id, opts);
}

// 3) Pagination-friendly (load older): returns ascending order for UI
export async function listMessagesPage(
  conversationId: string,
  pageSize = 50,
  before?: Date
) {
  const rows = await prisma.message.findMany({
    where: { conversationId, ...(before ? { createdAt: { lt: before } } : {}) },
    orderBy: { createdAt: 'desc' },
    take: pageSize,
  });
  return rows.reverse();
}

// 4) Recent messages for a restaurant (timeline/feed)
export async function getRecentMessages(
  restaurantId: string,
  limit = 50
) {
  return prisma.message.findMany({
    where: { restaurantId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}
```

### UI Mapping Hints
- Bubble side: `isFromCustomer = (direction === 'IN')`.
- Show `content`, and preview `mediaUrl` for images/documents/audio.
- Sort ascending by `createdAt` before rendering.
- For infinite scroll up: keep a cursor as the oldest `createdAt` loaded and pass it as `before`.

### Multi-tenancy & Security
- Always restrict by the authenticated tenant:
  - When resolving conversations: `where: { restaurantId, customerWa }`.
  - When reading messages: ensure the conversation belongs to that `restaurantId` if you accept `conversationId` as input.
- Do not expose Prisma to the browser. Wrap these functions behind your server routes or server components.

### Minimal Test Plan
- Create a conversation with messages in DB.
- Fetch by `conversationId` → expect ascending messages.
- Fetch by `restaurantId + phone` → resolves conversation then returns messages.
- Pagination with `before` returns strictly older rows and maintains order ascending after reverse.



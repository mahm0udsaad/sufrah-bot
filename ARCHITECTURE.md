# Multi-Tenant WhatsApp Bot Architecture

## System Overview

```
┌─────────────┐
│   Twilio    │
│  WhatsApp   │
└──────┬──────┘
       │ POST /whatsapp/webhook
       ▼
┌──────────────────────────────────────┐
│         Webhook Handler              │
│  ┌────────────────────────────────┐  │
│  │ 1. Route by To → RestaurantBot │  │
│  │ 2. Validate signature          │  │
│  │ 3. Idempotency check (waSid)   │  │
│  │ 4. Rate limiting               │  │
│  │ 5. Persist to PostgreSQL       │  │
│  │ 6. Publish event (Redis)       │  │
│  └────────────────────────────────┘  │
└──────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────┐
│         PostgreSQL Database          │
│  ┌────────────────────────────────┐  │
│  │ RestaurantBot (multi-tenant)   │  │
│  │ Conversation                   │  │
│  │ Message (with waSid)           │  │
│  │ Order (state machine)          │  │
│  │ WebhookLog (audit)             │  │
│  └────────────────────────────────┘  │
└──────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────┐
│         Redis Event Bus              │
│  ┌────────────────────────────────┐  │
│  │ ws:restaurant:{id}:messages    │  │
│  │ ws:restaurant:{id}:orders      │  │
│  │ ws:restaurant:{id}:conversations│ │
│  └────────────────────────────────┘  │
└──────────────────────────────────────┘
       │
       ├─────────────────┬─────────────┐
       ▼                 ▼             ▼
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│  Dashboard  │  │    Queue    │  │ Bot Logic   │
│   (Next.js) │  │  (BullMQ)   │  │ (handlers)  │
└─────────────┘  └──────┬──────┘  └─────────────┘
                        │
                        ▼
                 ┌─────────────┐
                 │   Worker    │
                 │ (processes  │
                 │  outbound)  │
                 └──────┬──────┘
                        │
                        ▼
                 ┌─────────────┐
                 │   Twilio    │
                 │   Send API  │
                 └─────────────┘
```

## Core Components

### 1. Webhook Handler (`src/webhooks/inboundHandler.ts`)

**Responsibilities:**
- Route incoming messages by `To` number
- Validate Twilio signatures
- Enforce idempotency (prevent duplicate processing)
- Apply rate limits (per-restaurant & per-customer)
- Persist messages to database
- Publish real-time events

**Flow:**
```typescript
webhook → findRestaurantByWhatsAppNumber(To)
       → validateTwilioSignature()
       → tryAcquireIdempotencyLock(MessageSid)
       → checkRateLimit(restaurantId, customerPhone)
       → createInboundMessage() // DB
       → eventBus.publishMessage() // Redis
```

### 2. Database Services (`src/db/`)

**Services:**
- `restaurantService` - Restaurant CRUD & routing
- `conversationService` - Conversation management
- `messageService` - Message persistence with idempotency
- `orderService` - Order state machine
- `webhookService` - Audit logging

**Key Features:**
- Idempotency via unique `waSid` constraint
- Composite indexes for performance
- Cascade deletes for data integrity
- Timestamps for all entities

### 3. Redis Infrastructure (`src/redis/`)

**Event Bus (`eventBus.ts`):**
- Pub/sub for real-time dashboard updates
- Per-restaurant channels
- Separate channels for messages, orders, conversations

**Queue (`queue.ts`):**
- BullMQ for async outbound messages
- Exponential backoff retries
- Rate limiting (60 msg/min per Twilio limits)
- Dead-letter queue for failures
- Parallel processing (10 concurrent jobs)

### 4. Rate Limiting (`src/utils/rateLimiter.ts`)

**Token Bucket Algorithm:**
- Global rate limit (webhook endpoint)
- Per-restaurant rate limit
- Per-customer rate limit
- Stored in Redis with automatic expiry

**Limits:**
- Restaurant: 60 msg/min (configurable per tenant)
- Customer: 20 msg/min (anti-spam)
- Global: 200 req/min (webhook protection)

### 5. Idempotency (`src/utils/idempotency.ts`)

**Duplicate Prevention:**
- Redis-based idempotency keys (24h TTL)
- Database-level unique constraint on `waSid`
- Prevents Twilio webhook retries from duplicating messages

### 6. Order State Machine (`src/db/orderService.ts`)

**States:**
```
DRAFT → CONFIRMED → PREPARING → OUT_FOR_DELIVERY → DELIVERED → RATED
```

**Rating Flow:**
1. Order reaches `DELIVERED`
2. System triggers rating prompt
3. Customer rates 1-5 stars
4. If rating ≥ 4: send promo template
5. If rating ≤ 3: send apology + support contact

### 7. Metrics & Observability (`src/utils/metrics.ts`)

**Tracked Metrics:**
- Webhooks received/processed/failed
- Messages sent/received/failed
- Queue depth
- Average processing time
- Error rate
- Uptime

**Endpoints:**
- `/health` - JSON health check
- `/metrics` - Prometheus-format metrics

## Data Flow

### Inbound Message Flow

```
1. Twilio → POST /whatsapp/webhook
   ├─ From: whatsapp:+966501234567 (customer)
   ├─ To: whatsapp:+14155238886 (restaurant)
   ├─ Body: "طلب جديد"
   └─ MessageSid: SMxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

2. Route by To → Find RestaurantBot
   └─ SELECT * FROM RestaurantBot WHERE whatsappFrom = 'To'

3. Validate signature
   └─ HMAC-SHA1(authToken, url + params) == X-Twilio-Signature

4. Idempotency check
   ├─ Check: SELECT waSid FROM Message WHERE waSid = 'SMxxx'
   └─ Lock: SETNX idempotency:SMxxx 1 EX 86400

5. Rate limit
   ├─ INCR ratelimit:restaurant:{id}:window
   └─ INCR ratelimit:customer:{id}:{phone}:window

6. Persist message
   └─ INSERT INTO Message (...) VALUES (...)

7. Update conversation
   └─ UPDATE Conversation SET lastMessageAt = NOW(), unreadCount = unreadCount + 1

8. Publish event
   └─ PUBLISH ws:restaurant:{id}:messages {...}

9. Process with bot logic
   └─ Handle "طلب جديد" → Show order type buttons
```

### Outbound Message Flow

```
1. Bot decides to send message
   └─ enqueueOutboundMessage({ restaurantId, conversationId, to, body })

2. BullMQ enqueues job
   └─ RPUSH whatsapp-outbound:queue {...}

3. Worker picks up job
   ├─ Get restaurant credentials
   ├─ Create Twilio client (per-tenant)
   └─ Persist message (optimistic)

4. Send via Twilio
   ├─ POST https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json
   └─ Returns: { sid: "SMxxx", status: "queued" }

5. Update message with SID
   └─ UPDATE Message SET waSid = 'SMxxx' WHERE id = '...'

6. Publish echo event
   └─ PUBLISH ws:restaurant:{id}:messages { type: 'message.sent', ... }

7. On failure: retry with exponential backoff
   └─ Attempt 1 → 5s delay → Attempt 2 → 10s delay → Attempt 3 → DLQ
```

## Multi-Tenancy

### Restaurant Isolation

Each restaurant has:
- Own Twilio credentials (account SID + auth token)
- Own WhatsApp number (`whatsappFrom`)
- Own rate limits
- Own Redis channels for events
- Own conversations & messages

### Routing Logic

```typescript
// Webhook receives To: whatsapp:+14155238886
const restaurant = await findRestaurantByWhatsAppNumber('whatsapp:+14155238886');

// All subsequent operations use restaurant.id
const conversation = await findOrCreateConversation(restaurant.id, customerPhone);
const message = await createInboundMessage({ restaurantId: restaurant.id, ... });
await eventBus.publishMessage(restaurant.id, { ... });
```

### Security

- Twilio signatures validated per-tenant (using their authToken)
- Rate limits enforced per-tenant
- Dashboard WebSocket subscriptions scoped to `restaurantId` (JWT-based auth)

## Performance Optimizations

### Database

1. **Indexes:**
   ```sql
   CREATE INDEX idx_conversation_restaurant_lastmsg ON Conversation(restaurantId, lastMessageAt);
   CREATE INDEX idx_message_conversation_created ON Message(conversationId, createdAt);
   CREATE INDEX idx_message_wasid ON Message(waSid) WHERE waSid IS NOT NULL;
   ```

2. **Connection Pooling:**
   - Use PgBouncer in production
   - Prisma connection limit: 10-20

3. **Keyset Pagination:**
   ```typescript
   // Instead of OFFSET
   WHERE createdAt < lastSeenDate ORDER BY createdAt DESC LIMIT 50
   ```

### Redis

1. **Connection Reuse:**
   - Single Redis client for pub/sub
   - Separate client for queue
   - Connection pooling via ioredis

2. **Key Expiry:**
   - Rate limit keys: 60s TTL
   - Idempotency keys: 24h TTL
   - Auto-cleanup via Redis TTL

### Queue

1. **Concurrency:** 10 workers in parallel
2. **Rate Limiting:** 60 jobs/min (Twilio limit)
3. **Batching:** Future enhancement for bulk sends

## Scalability

### Horizontal Scaling

```
Load Balancer
     │
     ├─── Bot Instance 1 (webhooks + bot logic)
     ├─── Bot Instance 2 (webhooks + bot logic)
     └─── Bot Instance 3 (webhooks + bot logic)
     
Worker Pool
     ├─── Worker 1 (outbound queue)
     ├─── Worker 2 (outbound queue)
     └─── Worker 3 (outbound queue)
```

**Stateless Design:**
- No in-memory state
- All data in PostgreSQL/Redis
- Workers compete for jobs

### Capacity Planning

**Per Instance:**
- 200 req/sec webhook throughput
- 60 outbound msg/min per worker
- 1000 concurrent WebSocket connections

**Bottlenecks:**
- Database connections (use pooler)
- Redis pub/sub (use cluster if needed)
- Twilio rate limits (queue handles backpressure)

## Error Handling

### Webhook Failures

1. **Invalid signature:** 403 Forbidden
2. **Restaurant not found:** 404 Not Found
3. **Rate limit exceeded:** 429 Too Many Requests
4. **Database error:** 500 Internal Server Error (Twilio retries)

### Queue Failures

1. **Twilio API error:** Retry with exponential backoff
2. **Max retries exceeded:** Move to DLQ
3. **Invalid credentials:** Mark restaurant inactive, alert admin

### Monitoring

- CloudWatch/Datadog for metrics
- Sentry for error tracking
- Alert on:
  - DLQ depth > 10
  - Error rate > 5%
  - Queue processing time > 10s

## Security

### Twilio Signature Validation

```typescript
HMAC-SHA1(authToken, webhookUrl + sortedParams) === X-Twilio-Signature
```

### JWT Authentication (Dashboard)

```typescript
{
  sub: userId,
  restaurantId: "clxxx",
  role: "admin",
  exp: timestamp
}
```

### Secrets Management

- Environment variables for master credentials
- Database encryption for per-tenant authTokens
- Never log sensitive data

## Testing Strategy

### Unit Tests
- Database services
- Rate limiter logic
- Idempotency checks

### Integration Tests
- Webhook flow end-to-end
- Queue worker processing
- Event bus pub/sub

### Load Tests
- Simulate 1000 concurrent customers
- Verify rate limiting
- Check queue backpressure

## Deployment

### Development
```bash
bun run dev           # Bot with hot reload
bun run worker:dev    # Worker with hot reload
```

### Production
```bash
# Start bot
bun start

# Start worker (separate process/container)
bun run worker

# Or use PM2
pm2 start ecosystem.config.js
```

### Docker
```dockerfile
FROM oven/bun:1
WORKDIR /app
COPY . .
RUN bun install
RUN bunx prisma generate
CMD ["bun", "start"]
```

## Future Enhancements

1. **Postgres LISTEN/NOTIFY** as event bus alternative
2. **Webhook status callbacks** from Twilio (delivery receipts)
3. **Analytics dashboard** (order volume, response times, ratings)
4. **A/B testing** for message templates
5. **Multi-language support** per restaurant
6. **Voice/video call integration**
7. **Payment gateway** integration (Stripe, Tap)
8. **AI-powered support** (sentiment analysis, auto-replies)


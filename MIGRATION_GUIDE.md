# Migration Guide: Single-Tenant → Multi-Tenant Architecture

This guide explains how to migrate from the legacy single-tenant in-memory bot to the new multi-tenant database-backed system.

## Overview of Changes

### Before (Single-Tenant)
- ✅ One bot per deployment
- ✅ In-memory state (carts, conversations)
- ✅ Direct Twilio client
- ✅ WebSocket for dashboard
- ❌ No persistence
- ❌ No multi-tenancy
- ❌ No queue/retry logic
- ❌ No idempotency

### After (Multi-Tenant)
- ✅ Multiple restaurants per deployment
- ✅ PostgreSQL persistence
- ✅ Redis queue + pub/sub
- ✅ Per-tenant Twilio credentials
- ✅ Idempotent message handling
- ✅ Rate limiting per tenant
- ✅ Async outbound with retries
- ✅ Audit logs & metrics

## Prerequisites

1. **PostgreSQL Database** (v14+)
2. **Redis Server** (v6+)
3. **Node.js/Bun** (already installed)

## Step-by-Step Migration

### 1. Install Dependencies

```bash
bun install
```

### 2. Set Up Environment Variables

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

Edit `.env`:

```env
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/sufrah_bot"

# Redis
REDIS_URL="redis://localhost:6379"

# Twilio Master Account
TWILIO_MASTER_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_MASTER_AUTH=your_auth_token_here
```

### 3. Initialize Database

Generate Prisma client and run migrations:

```bash
# Generate Prisma client
bunx prisma generate

# Create database tables
bunx prisma migrate dev --name init

# (Optional) Seed with a test restaurant
bunx prisma db seed
```

### 4. Create Your First Restaurant Bot

Using Prisma Studio or SQL:

```sql
INSERT INTO "RestaurantBot" (
  id,
  name,
  "whatsappFrom",
  "twilioAccountSid",
  "twilioAuthToken",
  "restaurantName",
  "supportContact",
  "paymentLink",
  "isActive",
  "createdAt",
  "updatedAt"
) VALUES (
  'clxxxxxxxxxxxxxxxxxxxxxxxx',
  'My Restaurant Bot',
  'whatsapp:+14155238886',
  'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  'your_twilio_auth_token',
  'مطعم سفرة',
  '+966-500-000000',
  'https://example.com/pay',
  true,
  NOW(),
  NOW()
);
```

Or use Prisma Studio:

```bash
bunx prisma studio
```

### 5. Start Redis (if not running)

```bash
# macOS with Homebrew
brew services start redis

# Docker
docker run -d -p 6379:6379 redis:alpine

# Linux
sudo systemctl start redis
```

### 6. Start the Bot

```bash
# Development with hot reload
bun run --watch index.ts

# Production
bun start
```

### 7. Start the Queue Worker

The queue worker processes outbound messages asynchronously:

```bash
# In a separate terminal
bun run src/redis/queue.ts
```

Or integrate it into your main process (see `index.ts` updates below).

## Architecture Changes

### Message Flow

**Before:**
```
Webhook → processMessage() → sendTextMessage() → Twilio
```

**After:**
```
Webhook → Route by To number → Find Restaurant
        → Idempotency check
        → Rate limit check
        → Persist to DB
        → Publish event (Redis)
        → Process with bot logic
        → Enqueue outbound message
        
Worker  → Pull from queue
        → Send via Twilio
        → Persist with SID
        → Publish echo event
```

### Data Persistence

**Before:** In-memory Maps
```typescript
const carts = new Map<string, CartItem[]>();
const orderStates = new Map<string, OrderState>();
```

**After:** PostgreSQL + Prisma
```typescript
await prisma.message.create({ ... });
await prisma.order.update({ ... });
```

### Real-Time Events

**Before:** Direct WebSocket broadcast
```typescript
broadcast({ type: 'message.created', data });
```

**After:** Redis pub/sub per restaurant
```typescript
await eventBus.publishMessage(restaurantId, { ... });
```

## Dashboard Integration

The dashboard needs to:

1. **Authenticate with JWT** containing `restaurantId`
2. **Subscribe to restaurant-specific channels:**
   - `ws:restaurant:{restaurantId}:messages`
   - `ws:restaurant:{restaurantId}:orders`
   - `ws:restaurant:{restaurantId}:conversations`

3. **Use REST API endpoints:**
   - `GET /api/restaurants/:id/conversations`
   - `GET /api/restaurants/:id/messages`
   - `GET /api/restaurants/:id/orders`
   - `POST /api/restaurants/:id/conversations/:conversationId/send`

## Testing the Migration

### 1. Health Check

```bash
curl http://localhost:3000/health
```

Expected response:
```json
{
  "status": "healthy",
  "timestamp": "2025-10-03T...",
  "uptime": 123,
  "database": "connected",
  "redis": "connected"
}
```

### 2. Metrics

```bash
curl http://localhost:3000/metrics
```

### 3. Send a Test Message

Configure Twilio webhook to point to:
```
https://your-domain.com/whatsapp/webhook
```

Send a WhatsApp message to your bot number and verify:
- ✅ Message appears in database
- ✅ Conversation is created
- ✅ Event is published to Redis
- ✅ Bot responds via queue

## Rollback Plan

If you need to rollback to the old system:

1. **Keep the old codebase** in a separate branch
2. **Backup your `.env`** before migration
3. **Database snapshots** before running migrations
4. **Switch traffic** back to old deployment

## Performance Tuning

### Connection Pooling

Use PgBouncer for production:

```env
DATABASE_URL="postgresql://user:password@pgbouncer:6432/sufrah_bot"
```

### Redis Scaling

For high throughput, use Redis Cluster or Redis Sentinel.

### Queue Concurrency

Adjust worker concurrency in `src/redis/queue.ts`:

```typescript
{
  concurrency: 20, // Process 20 messages in parallel
}
```

### Rate Limits

Per-restaurant limits in database:

```sql
UPDATE "RestaurantBot" 
SET "maxMessagesPerMin" = 120
WHERE id = 'your-restaurant-id';
```

## Troubleshooting

### Messages not being processed

1. Check if restaurant exists in DB
2. Verify `whatsappFrom` matches Twilio number
3. Check Redis connection
4. Verify queue worker is running

### Duplicate messages

- Already handled by `waSid` uniqueness constraint
- Check Redis for idempotency keys: `redis-cli KEYS "idempotency:*"`

### Rate limit errors

```bash
# Check rate limit keys in Redis
redis-cli KEYS "ratelimit:*"

# Clear rate limits (dev only)
redis-cli FLUSHDB
```

## Next Steps

1. **Set up monitoring** (Grafana + Prometheus)
2. **Configure alerts** (Slack/Telegram for DLQ growth)
3. **Implement webhooks** for order status updates
4. **Add analytics** (order volume, response times, ratings)
5. **Scale horizontally** (multiple bot instances behind load balancer)

## Support

For issues or questions, refer to:
- `DASHBOARD_CONTEXT.md` - Dashboard integration details
- `README.md` - General bot documentation
- GitHub Issues - Report bugs


# Quick Start Guide - Multi-Tenant WhatsApp Bot

Get your multi-tenant WhatsApp bot running in 10 minutes!

## Prerequisites

- ✅ Bun installed ([bun.sh](https://bun.sh))
- ✅ PostgreSQL database (local or hosted)
- ✅ Redis server (local or hosted)
- ✅ Twilio account with WhatsApp enabled

## Step 1: Install Dependencies

```bash
bun install
```

## Step 2: Configure Environment

Create `.env` file in the project root:

```bash
# Copy from example (create manually)
cat > .env << 'EOF'
# Server
PORT=3000
NODE_ENV=development

# Database (replace with your credentials)
DATABASE_URL="postgresql://user:password@localhost:5432/sufrah_bot"

# Redis
REDIS_URL="redis://localhost:6379"
EVENT_BUS=redis

# Twilio Master Account
TWILIO_MASTER_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_MASTER_AUTH=your_auth_token_here
TWILIO_WEBHOOK_VALIDATE=false

# Webhook Verification
VERIFY_TOKEN=my-secret-verify-token

# App Settings
NOMINATIM_USER_AGENT=sufrah-bot/1.0
PAYMENT_LINK=https://example.com/pay
SUPPORT_CONTACT=+966-500-000000

# Auth
JWT_SECRET=change-me-to-a-long-random-string-in-production
EOF
```

## Step 3: Set Up Database

```bash
# Generate Prisma client
bun run db:generate

# Create database tables
bun run db:migrate

# Seed with demo restaurant (optional)
bun run db:seed
```

## Step 4: Create Your First Restaurant

Option A: Using Prisma Studio (GUI)

```bash
bun run db:studio
```

Then create a `RestaurantBot` record with:
- **name**: "My Restaurant Bot"
- **whatsappFrom**: "whatsapp:+14155238886" (your Twilio number)
- **twilioAccountSid**: Your Twilio Account SID
- **twilioAuthToken**: Your Twilio Auth Token
- **restaurantName**: "مطعم سفرة"
- **isActive**: true

Option B: Using SQL

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
  "maxMessagesPerMin",
  "maxMessagesPerDay",
  "createdAt",
  "updatedAt"
) VALUES (
  gen_random_uuid(),
  'My Restaurant Bot',
  'whatsapp:+14155238886',
  'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  'your_auth_token_here',
  'مطعم سفرة',
  '+966-500-000000',
  'https://example.com/pay',
  true,
  60,
  1000,
  NOW(),
  NOW()
);
```

## Step 5: Start the Services

### Terminal 1: Start the Bot

```bash
bun run dev
```

You should see:
```
🚀 Bot server starting...
✅ Redis connected
✅ Database connected
🌐 Server running on http://localhost:3000
```

### Terminal 2: Start the Worker

```bash
bun run worker:dev
```

You should see:
```
🚀 Starting outbound message worker...
✅ Outbound worker is running
📬 Waiting for jobs...
```

### Terminal 3: Start Redis (if not running)

```bash
# macOS with Homebrew
brew services start redis

# Or with Docker
docker run -d -p 6379:6379 redis:alpine
```

## Step 6: Configure Twilio Webhook

1. Go to [Twilio Console](https://console.twilio.com)
2. Navigate to **Messaging** → **Settings** → **WhatsApp sandbox**
3. Set "When a message comes in" to: `https://your-domain.com/whatsapp/webhook`
4. Set HTTP method to: `POST`
5. Save

For local development, use [ngrok](https://ngrok.com):

```bash
# In a new terminal
ngrok http 3000

# Copy the https URL (e.g., https://abc123.ngrok.io)
# Set Twilio webhook to: https://abc123.ngrok.io/whatsapp/webhook
```

## Step 7: Test It!

1. Send a WhatsApp message to your Twilio number
2. The bot should respond with the welcome message
3. Check the terminal logs to see the flow

Expected logs:
```
📍 Routed to restaurant: My Restaurant Bot (clxxx...)
💬 Conversation: clyyy...
✅ Message persisted: clzzz...
📤 Enqueued message for restaurant clxxx...
🔄 Processing outbound message job
✅ Sent message SMwww... to +966501234567
```

## Step 8: Verify Everything Works

### Health Check

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

### Metrics

```bash
curl http://localhost:3000/metrics
```

Expected response (Prometheus format):
```
whatsapp_webhooks_received_total 5
whatsapp_webhooks_processed_total 5
whatsapp_messages_sent_total 3
...
```

### Check Database

```bash
bun run db:studio
```

Browse the tables:
- `RestaurantBot` - Your restaurants
- `Conversation` - Customer conversations
- `Message` - All messages (IN/OUT)
- `Order` - Order tracking
- `WebhookLog` - Audit trail

## Troubleshooting

### "Restaurant not found" error

Check that your `whatsappFrom` in the database matches the `To` field in the webhook exactly:

```sql
SELECT "whatsappFrom", "isActive" FROM "RestaurantBot";
```

Format should be: `whatsapp:+14155238886`

### Redis connection failed

Make sure Redis is running:

```bash
redis-cli ping
# Should return: PONG
```

### Database connection failed

Check your `DATABASE_URL`:

```bash
# Test connection
psql $DATABASE_URL -c "SELECT 1"
```

### Worker not processing messages

Check the queue in Redis:

```bash
redis-cli LLEN whatsapp-outbound:wait
# Should return the queue depth
```

Restart the worker:

```bash
# Stop worker (Ctrl+C), then:
bun run worker:dev
```

### Messages duplicating

This shouldn't happen due to idempotency! But if it does:

1. Check `waSid` in database is unique
2. Check Redis idempotency keys: `redis-cli KEYS "idempotency:*"`
3. Verify Twilio signature validation is enabled

## Next Steps

1. **Configure your menu** in `src/workflows/menuData.ts`
2. **Customize templates** in `src/workflows/quickReplies.ts`
3. **Set up monitoring** (see `ARCHITECTURE.md`)
4. **Connect dashboard** (see `DASHBOARD_CONTEXT.md`)
5. **Deploy to production** (see `MIGRATION_GUIDE.md`)

## Common Commands

```bash
# Development
bun run dev              # Start bot with hot reload
bun run worker:dev       # Start worker with hot reload

# Production
bun start                # Start bot
bun run worker           # Start worker

# Database
bun run db:migrate       # Create new migration
bun run db:push          # Push schema changes (dev only)
bun run db:studio        # Open Prisma Studio GUI
bun run db:seed          # Seed demo data

# Maintenance
bunx prisma migrate reset   # Reset database (⚠️ deletes all data)
redis-cli FLUSHDB           # Clear Redis (⚠️ dev only)
```

## Production Checklist

Before deploying to production:

- [ ] Change `JWT_SECRET` to a strong random value
- [ ] Enable `TWILIO_WEBHOOK_VALIDATE=true`
- [ ] Set `NODE_ENV=production`
- [ ] Use connection pooler (PgBouncer) for database
- [ ] Use managed Redis (ElastiCache, Redis Cloud)
- [ ] Set up SSL/TLS for all connections
- [ ] Configure log aggregation (CloudWatch, Datadog)
- [ ] Set up error tracking (Sentry)
- [ ] Configure backups (database snapshots)
- [ ] Set up monitoring & alerts
- [ ] Review rate limits per restaurant
- [ ] Test failover scenarios

## Getting Help

- 📖 [ARCHITECTURE.md](./ARCHITECTURE.md) - System design details
- 📖 [MIGRATION_GUIDE.md](./MIGRATION_GUIDE.md) - Migration from v1
- 📖 [DASHBOARD_CONTEXT.md](./DASHBOARD_CONTEXT.md) - Dashboard integration
- 🐛 GitHub Issues - Report bugs
- 💬 Discord - Community support

Happy bot building! 🤖🍽️


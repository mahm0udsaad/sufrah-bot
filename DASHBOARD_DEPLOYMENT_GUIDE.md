# Dashboard API - Deployment Guide for Dashboard Developer

## ✅ NO DATABASE CHANGES REQUIRED

**Important:** The dashboard API implementation uses **ONLY existing database tables**. No migrations are needed!

---

## 🚀 Quick Deployment Steps

### Step 1: Pull the Latest Code

```bash
cd /path/to/bun-whatsapp-bot
git pull origin main
```

### Step 2: Install Dependencies (if any new ones)

```bash
bun install
```

### Step 3: Regenerate Prisma Client (Optional but Recommended)

```bash
bunx prisma generate
```

**Note:** This doesn't modify the database, it just regenerates the TypeScript types.

### Step 4: Set Environment Variables

Add these TWO new variables to your `.env` file:

```bash
# Dashboard Authentication (REQUIRED)
DASHBOARD_PAT=your-secret-pat-token-here
BOT_API_KEY=your-admin-api-key-here

# All other existing variables stay the same
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
# ... etc
```

**Generate Secure Tokens:**
```bash
# Generate a random PAT token
openssl rand -hex 32

# Generate a random API key
openssl rand -hex 32
```

### Step 5: Start the Server

```bash
# Development
bun run index.ts

# Production
bun run index.ts
```

### Step 6: Test the API

```bash
# Health check (public, no auth needed)
curl http://localhost:3000/api/health

# Dashboard overview (requires auth)
curl -H "Authorization: Bearer YOUR_PAT_TOKEN" \
     -H "X-Restaurant-Id: YOUR_RESTAURANT_ID" \
     http://localhost:3000/api/tenants/YOUR_RESTAURANT_ID/overview
```

---

## 📋 What Was Added (Code Only, No DB Changes)

### New Files
```
src/
├── services/
│   ├── i18n.ts                    # NEW - Internationalization
│   └── dashboardMetrics.ts        # NEW - Metrics calculations
└── server/routes/
    ├── api/
    │   ├── tenants.ts             # NEW - Overview endpoint
    │   └── bot.ts                 # NEW - Bot management
    └── dashboard/
        ├── conversations.ts        # NEW - Conversations API
        ├── orders.ts              # NEW - Orders API
        ├── ratings.ts             # NEW - Ratings API
        ├── logs.ts                # NEW - Logs API
        ├── catalog.ts             # NEW - Catalog API
        ├── templates.ts           # NEW - Templates API
        ├── settings.ts            # NEW - Settings API
        ├── notifications.ts       # NEW - Notifications API
        ├── onboarding.ts          # NEW - Onboarding API
        ├── admin.ts               # NEW - Admin API
        └── health.ts              # NEW - Health checks

docs/
├── FRONTEND_INTEGRATION_GUIDE.md              # NEW - For frontend team
├── DASHBOARD_API_COMPLETE_REFERENCE.md        # NEW - Complete API docs
└── DASHBOARD_BACKEND_IMPLEMENTATION_SUMMARY.md # NEW - Technical details
```

### Modified Files
```
index.ts                           # Added new route handlers
```

### Database
```
NO CHANGES - Uses existing schema!
```

---

## 🔍 Verification Checklist

After deployment, verify these work:

- [ ] Server starts without errors
- [ ] Health endpoint responds: `GET /api/health`
- [ ] Dashboard overview works with auth
- [ ] No database errors in logs
- [ ] Prisma client is up to date

---

## 🗄️ Database Schema Status

### ✅ All Required Tables Already Exist

The dashboard API uses these existing tables:

1. ✅ `RestaurantBot` - Bot configuration
2. ✅ `Restaurant` - Restaurant profiles
3. ✅ `Conversation` - Customer conversations
4. ✅ `Message` - Chat messages
5. ✅ `Order` - Orders and items
6. ✅ `OrderItem` - Order line items
7. ✅ `WebhookLog` - Webhook logs
8. ✅ `Template` - Message templates
9. ✅ `ContentTemplateCache` - Template cache
10. ✅ `MonthlyUsage` - Usage tracking
11. ✅ `ConversationSession` - Session tracking
12. ✅ `UsageLog` - Audit logs
13. ✅ `User` - User accounts
14. ✅ `File` - File uploads

### 📊 Existing Migrations (Already Applied)

Your database already has these migrations:
1. ✅ `20251007110756_add_template_tracking_to_outbound_messages`
2. ✅ `20251007112002_make_restaurant_id_optional_in_outbound_messages`
3. ✅ `20251009011015_add_message_cache_table`
4. ✅ `20251010195017_add_multitenancy_and_onboarding`
5. ✅ `20251010203915_align_restaurant_bot_schema_v2`
6. ✅ `20251012184426_add_file_table_and_fix_usage_log`
7. ✅ `20251017120000_add_content_template_cache`
8. ✅ `20251021082921_add_usage_tracking_tables`

**All these migrations were already applied BEFORE the dashboard API was implemented.**

### 🚫 No New Migrations

**The dashboard API implementation:**
- ❌ Does NOT create new tables
- ❌ Does NOT modify existing tables
- ❌ Does NOT require any migrations
- ✅ Only adds API endpoints
- ✅ Only adds business logic services
- ✅ Uses existing database schema

---

## 🔐 Environment Variables Reference

### Required New Variables

```bash
# Dashboard Authentication
DASHBOARD_PAT=your-secret-pat-token
BOT_API_KEY=your-admin-api-key
```

### Existing Variables (No Changes)

```bash
# Database
DATABASE_URL=postgresql://user:password@host:port/database

# Redis
REDIS_URL=redis://host:port
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_TLS=false

# Twilio
TWILIO_ACCOUNT_SID=ACxxx
TWILIO_AUTH_TOKEN=xxx
TWILIO_WHATSAPP_FROM=+xxx

# App
PORT=3000
NODE_ENV=production
```

---

## 🧪 Testing the Deployment

### 1. Health Check (No Auth Required)

```bash
curl http://localhost:3000/api/health
```

**Expected Response:**
```json
{
  "data": {
    "status": "healthy",
    "timestamp": "2025-10-22T10:00:00.000Z",
    "services": {
      "database": "ok",
      "redis": "ok"
    }
  },
  "meta": {
    "locale": "en",
    "currency": "SAR",
    "timestamp": "2025-10-22T10:00:00.000Z"
  }
}
```

### 2. Dashboard Overview (Auth Required)

```bash
export DASHBOARD_PAT="your-token-here"
export RESTAURANT_ID="your-restaurant-id"

curl -H "Authorization: Bearer $DASHBOARD_PAT" \
     -H "X-Restaurant-Id: $RESTAURANT_ID" \
     http://localhost:3000/api/tenants/$RESTAURANT_ID/overview
```

**Expected Response:**
```json
{
  "data": {
    "restaurantId": "rest_123",
    "restaurantName": "Your Restaurant",
    "activeConversations": 15,
    "pendingOrders": 8,
    "slaBreaches": 2,
    "quotaUsage": { "used": 450, "limit": 1000, "remaining": 550, "percentUsed": 45.0 },
    "ratingTrend": { "averageRating": 4.5, "totalRatings": 120, "trend": "up", "changePercent": 5.2 },
    "recentActivity": { "messagesLast24h": 234, "ordersLast24h": 12, "conversationsLast24h": 8 }
  },
  "meta": { "locale": "en", "currency": "SAR", "timestamp": "..." }
}
```

### 3. Admin Metrics (API Key Required)

```bash
export BOT_API_KEY="your-api-key-here"

curl -H "X-API-Key: $BOT_API_KEY" \
     http://localhost:3000/api/admin/metrics
```

---

## 🔧 Troubleshooting

### Issue: "Unauthorized" Error

**Cause:** Missing or invalid authentication tokens

**Solution:**
1. Check that `DASHBOARD_PAT` is set in `.env`
2. Verify you're sending the `Authorization` header
3. Verify you're sending the `X-Restaurant-Id` header

```bash
# Check environment variable
echo $DASHBOARD_PAT

# Test with correct headers
curl -v -H "Authorization: Bearer $DASHBOARD_PAT" \
        -H "X-Restaurant-Id: rest_123" \
        http://localhost:3000/api/tenants/rest_123/overview
```

### Issue: "Restaurant not found"

**Cause:** Invalid or non-existent restaurant ID

**Solution:**
1. Check your database for valid restaurant IDs:
```bash
bunx prisma studio
# or
psql $DATABASE_URL -c "SELECT id, name FROM RestaurantProfile;"
```

### Issue: Database Connection Error

**Cause:** Database not accessible

**Solution:**
1. Verify `DATABASE_URL` in `.env`
2. Check database is running
3. Verify network connectivity

```bash
# Test database connection
bunx prisma db pull
```

### Issue: Redis Connection Error

**Cause:** Redis not accessible

**Solution:**
1. Verify `REDIS_URL` in `.env`
2. Check Redis is running
3. For local Redis: `redis-cli ping` should return `PONG`

---

## 📱 What Frontend Developer Needs

### 1. API URL
```
Production: https://your-api-domain.com
Staging: https://staging-api-domain.com
Development: http://localhost:3000
```

### 2. Authentication Token
```
DASHBOARD_PAT (you'll provide this securely)
```

### 3. Documentation
```
docs/FRONTEND_INTEGRATION_GUIDE.md - Complete integration guide
docs/DASHBOARD_API_COMPLETE_REFERENCE.md - Full API reference
```

### 4. Restaurant ID
They'll need a valid restaurant ID for testing:
```bash
# Get a restaurant ID from database
bunx prisma studio
# Look in RestaurantProfile table
```

---

## 🎯 Success Criteria

After deployment, you should be able to:

✅ Server starts without errors  
✅ `/api/health` returns 200 OK  
✅ `/api/tenants/:id/overview` returns data with valid auth  
✅ No database errors in logs  
✅ Redis connection is healthy  
✅ All existing functionality still works  

---

## 📞 Support

If you encounter any issues:

1. **Check logs:** Look for error messages in server console
2. **Verify environment:** Ensure all required env vars are set
3. **Test database:** Run `bunx prisma studio` to verify DB access
4. **Test Redis:** Run `redis-cli ping` to verify Redis access
5. **Review docs:** See `docs/FRONTEND_INTEGRATION_GUIDE.md`

---

## 🎉 That's It!

**Remember:** 
- ✅ No database migrations needed
- ✅ Just add 2 environment variables
- ✅ Pull code and restart server
- ✅ Everything uses existing database schema

The dashboard API is ready to use immediately after setting the environment variables! 🚀

---

## 📋 Deployment Checklist

- [ ] Pull latest code from main branch
- [ ] Run `bun install`
- [ ] Run `bunx prisma generate`
- [ ] Add `DASHBOARD_PAT` to `.env`
- [ ] Add `BOT_API_KEY` to `.env`
- [ ] Restart server
- [ ] Test `/api/health` endpoint
- [ ] Test `/api/tenants/:id/overview` endpoint
- [ ] Verify no errors in logs
- [ ] Share API URL and PAT with frontend team
- [ ] Share documentation links with frontend team

**Estimated deployment time:** 5-10 minutes ⏱️


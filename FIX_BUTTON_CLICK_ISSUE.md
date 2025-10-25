# Fix Button Click Issue - Complete Guide

## Problem Summary

When users press "View Order Details" in WhatsApp, nothing is delivered. The root cause is **environment variable configuration issues**, specifically:

1. ❌ **REDIS_HOST is truncated**: Ends with `.comp` instead of `.com`
2. ❌ **JWT_SECRET is missing**: Required for authentication
3. ✅ **RestaurantBot record exists**: Already configured for +966508034010
4. ✅ **REDIS_URL is correct**: But not being used properly

## Quick Fix Steps

### Step 1: Update `.env` File

Add or fix these variables in your `.env` file:

```bash
# Add JWT_SECRET (REQUIRED)
JWT_SECRET="your_random_secure_jwt_secret_here_change_this"

# Fix REDIS_HOST (remove truncation, or just rely on REDIS_URL)
# Option A: Fix the truncated hostname
REDIS_HOST="redis-10805.c241.us-east-1-4.ec2.redns.redis-cloud.com"

# Option B: Just use REDIS_URL (RECOMMENDED - already correct in your .env)
REDIS_URL="rediss://default:S2REkuJJvvS4SslHweuhlRSCCNg4JAqF@redis-10805.c241.us-east-1-4.ec2.redns.redis-cloud.com:10805"
```

### Step 2: Validate Environment

Run the validation script to check all environment variables:

```bash
bun run scripts/validateEnv.ts
```

Expected output should show all green checkmarks (✓) with no errors.

### Step 3: Regenerate Prisma Client

```bash
bunx prisma generate
```

### Step 4: Test Locally First

Before updating PM2, test that the bot works locally:

```bash
# Terminal 1: Start the main server
bun run --watch index.ts

# Terminal 2: Start the outbound worker (if needed)
bun run --watch src/workers/outboundWorker.ts
```

Check the logs - you should see:
- ✅ Redis connected
- ✅ Database connected
- ✅ HTTP server listening on port 3000
- **NO** DNS errors

### Step 5: Restart PM2 (Production)

If local testing works, restart PM2 with updated environment:

```bash
# Option A: Use the provided script
./scripts/restartPM2.sh

# Option B: Manual restart
pm2 restart whatsapp-bot --update-env
pm2 restart outbound-worker --update-env  # if running
```

### Step 6: Verify Button Clicks Work

Send a test WhatsApp message and press "View Order Details". Check PM2 logs:

```bash
pm2 logs whatsapp-bot --lines 50
```

Look for these success indicators:
```
📍 Routed to restaurant: rashad (cmgm28wjo0001sa9oqd57vqko)
🔘 [ButtonClick] User requested "View Order Details"
✅ [ButtonClick] Successfully sent cached message
```

## What Was Fixed

### 1. Redis Client Configuration

**Before:**
```typescript
export const redis = new Redis({
  host: REDIS_HOST,  // ❌ Using truncated hostname
  port: Number(REDIS_PORT),
  password: REDIS_PASSWORD || undefined,
  // ...
});
```

**After:**
```typescript
export const redis = new Redis(REDIS_URL, {
  // ✅ Uses the properly constructed REDIS_URL
  db: 0,
  maxRetriesPerRequest: 3,
  // ...
});
```

### 2. Environment Variables

Added comprehensive validation script at `scripts/validateEnv.ts` that checks:
- ✅ All required variables are set
- ✅ URL formats are valid
- ✅ Redis connectivity works
- ✅ Database connectivity works

## Troubleshooting

### Issue: Still seeing DNS errors

**Cause**: Old REDIS_HOST value is cached or REDIS_URL is not being used.

**Fix**:
1. Verify REDIS_URL is set correctly in `.env`
2. Restart the application completely
3. Check `src/redis/client.ts` is using `REDIS_URL` (not individual vars)

### Issue: "Restaurant not found" in logs

**Cause**: RestaurantBot lookup failing.

**Fix**:
```bash
# Verify the bot exists
bun run scripts/checkAndFixBot.ts

# Should show:
# ✅ Found existing RestaurantBot
# ✅ Bot is already active and ready to receive messages
```

### Issue: Button click logs show "No cached message found"

**Cause**: MessageCache record expired or wasn't created.

**Fix**:
1. Verify the initial template was sent successfully
2. Check MessageCache table has a record for the recipient
3. Ensure `expiresAt` is in the future

```sql
-- Check MessageCache records
SELECT "toPhone", "messageText", "delivered", "expiresAt", "createdAt" 
FROM "MessageCache" 
WHERE "toPhone" = 'whatsapp:+966XXXXXXXXX'
ORDER BY "createdAt" DESC 
LIMIT 5;
```

### Issue: PM2 process not found

**Cause**: PM2 process not running or named differently.

**Fix**:
```bash
# List all PM2 processes
pm2 list

# If not running, start it
pm2 start index.ts --name whatsapp-bot --interpreter bun

# Or use ecosystem file if available
pm2 start ecosystem.config.js
```

## Verification Checklist

- [ ] `.env` file contains JWT_SECRET
- [ ] REDIS_URL is correctly formatted (starts with `redis://` or `rediss://`)
- [ ] `bun run scripts/validateEnv.ts` passes all checks
- [ ] Local server starts without DNS errors
- [ ] PM2 processes restarted with `--update-env`
- [ ] Button click triggers "View Order Details" flow in logs
- [ ] Cached message is delivered to user

## Additional Resources

- **Validate Environment**: `bun run scripts/validateEnv.ts`
- **Check Bot Config**: `bun run scripts/checkAndFixBot.ts`
- **Restart PM2**: `./scripts/restartPM2.sh`
- **View Logs**: `pm2 logs whatsapp-bot --lines 100`

## Support

If issues persist after following this guide:

1. Check PM2 logs: `pm2 logs whatsapp-bot --lines 200`
2. Check Redis connectivity: `redis-cli -u "your_redis_url" ping`
3. Check database: `bunx prisma studio` (opens GUI at http://localhost:5555)
4. Review environment variables: `bun run scripts/validateEnv.ts`


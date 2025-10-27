# Dashboard 403 Forbidden Error - SOLVED

## The Problem

The dashboard was receiving a **403 Forbidden** error when accessing:
```
GET /api/tenants/cmh92786r0004saer5gfx81le/overview
```

**Error Message:**
```
[Tenants API] Forbidden: auth.botId=cmh93958o0004sauw8iv09f7n, requested=cmh92786r0004saer5gfx81le
```

## Root Cause

The dashboard was using **two different IDs**:
- **Authentication Header (`X-Restaurant-Id`):** `cmh93958o0004sauw8iv09f7n` (Bot ID) ✅
- **URL Path:** `cmh92786r0004saer5gfx81le` (Restaurant ID) ❌

This mismatch caused the 403 error because the API validates that the authenticated Bot ID matches the requested Bot ID in the URL.

## Database Structure

For **Shawrma Karm** restaurant:
```
Bot ID:        cmh93958o0004sauw8iv09f7n  ← Use this everywhere
Restaurant ID: cmh92786r0004saer5gfx81le  ← Don't use this in API calls
WhatsApp:      +966573610338
```

## The Solution

**Use the Bot ID (`cmh93958o0004sauw8iv09f7n`) consistently in:**

1. ✅ `X-Restaurant-Id` header
2. ✅ URL paths (e.g., `/api/tenants/{botId}/overview`)
3. ✅ Query parameters (e.g., `?tenantId={botId}`)

## Correct Configuration

### Environment Variables (Already Correct)
Your backend `.env` is already configured correctly:
```bash
BOT_API_TOKEN=sufrah_bot_0DJKLldY4IP7dBwEagEywUrC9Z4waN9yi3idlpMQLaM
DASHBOARD_PAT=sufrah_bot_0DJKLldY4IP7dBwEagEywUrC9Z4waN9yi3idlpMQLaM
```

### Frontend Configuration (Needs Update)

Your dashboard frontend needs to use the **Bot ID**, not the Restaurant ID:

```typescript
// ❌ WRONG - Using Restaurant ID
const TENANT_ID = "cmh92786r0004saer5gfx81le";

// ✅ CORRECT - Use Bot ID
const TENANT_ID = "cmh93958o0004sauw8iv09f7n";
```

### Example API Call

```bash
curl -X GET \
  "https://bot.sufrah.sa/api/tenants/cmh93958o0004sauw8iv09f7n/overview?currency=SAR&tenantId=cmh93958o0004sauw8iv09f7n" \
  -H "Authorization: Bearer sufrah_bot_0DJKLldY4IP7dBwEagEywUrC9Z4waN9yi3idlpMQLaM" \
  -H "X-Restaurant-Id: cmh93958o0004sauw8iv09f7n"
```

## How to Get the Correct Bot ID

Run this script to get the Bot ID for any WhatsApp number:

```bash
bun run scripts/getBotConfig.ts +966573610338
```

## All Available Bots

```
1. Shawrma Karm
   Bot ID: cmh93958o0004sauw8iv09f7n
   WhatsApp: +966573610338

2. مطعم شاورما وفلافل أوشن
   Bot ID: cmgz2pgvr0001kjxl19wuddsa
   WhatsApp: +966502045939

3. rashad
   Bot ID: cmgm28wjo0001sa9oqd57vqko
   WhatsApp: +966508034010

4. مطعم سفرة التجريبي
   Bot ID: cmgl9g79x0000satgj9v9y6ui
   WhatsApp: whatsapp:+14155238886
```

## Testing

After updating your frontend configuration, verify with:

```bash
# Should return 200 OK with dashboard data
curl -X GET \
  "https://bot.sufrah.sa/api/tenants/cmh93958o0004sauw8iv09f7n/overview?currency=SAR" \
  -H "Authorization: Bearer sufrah_bot_0DJKLldY4IP7dBwEagEywUrC9Z4waN9yi3idlpMQLaM" \
  -H "X-Restaurant-Id: cmh93958o0004sauw8iv09f7n"
```

## Summary

- ✅ **Backend is correct** - no changes needed to environment variables
- ⚠️  **Frontend needs update** - use Bot ID (`cmh93958o0004sauw8iv09f7n`) instead of Restaurant ID
- ✅ **Verified working** - API returns 200 OK when using correct Bot ID


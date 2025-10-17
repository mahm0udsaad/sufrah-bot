# Sufrah API Implementation Comparison

## Dashboard vs WhatsApp Bot - Fixed Issues

### ✅ FIXED: HTTP Headers
```typescript
// Dashboard (Correct) ✅
Accept: 'application/json'

// Bot (Before) ❌
Accept: 'text/plain'

// Bot (After) ✅
Accept: 'application/json'
```

### ✅ FIXED: Authorization
Both are now identical - using `ApiToken` prefix

### ✅ FIXED: Response Handling
```typescript
// Dashboard (Correct) ✅
- Handles both single object and array responses
- Has fallback JSON parsing

// Bot (After) ✅
- Now handles both single object and array responses  
- Has fallback JSON parsing
- Better error messages with response body
```

### ✅ FIXED: Input Validation
```typescript
// Dashboard (Correct) ✅
if (!merchantId) throw new Error('Missing merchant id')

// Bot (After) ✅
if (!merchantId) throw new Error('Missing merchant id')
```

### ✅ FIXED: Array Normalization
```typescript
// Dashboard (Correct) ✅
return Array.isArray(data) ? data : [data]

// Bot (After) ✅
return Array.isArray(data) ? data : [data]
```

### ✅ FIXED: Type Definitions
Now includes all fields from dashboard:
- `avatar`, `priceAfter`, availability flags
- Area coordinates (`centerLongitude`, `centerLatitude`, `radius`)

## Key Insight: Phone Numbers vs Merchant IDs

### How It Works:
```
┌─────────────────────────────────────────────────────────────────┐
│ 1. Customer sends message from: +966502045939                   │
└────────────┬────────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. Bot looks up restaurant in database:                         │
│    - Try: WHERE whatsapp_number = '+966502045939'               │
│    - Fallback: WHERE whatsapp_number = '966502045939'           │
│                                                                  │
│    ✅ This is why restaurants without "+" still work!           │
└────────────┬────────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. Found Restaurant in DB:                                      │
│    {                                                             │
│      id: "rest_123",                                             │
│      name: "My Restaurant",                                      │
│      whatsapp_number: "966502045939",  ← Phone (no +)           │
│      external_merchant_id: "abc-xyz"   ← Sufrah Merchant ID     │
│    }                                                             │
└────────────┬────────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. Call Sufrah API with MERCHANT ID (not phone number):         │
│                                                                  │
│    GET /merchants/abc-xyz/branches                              │
│                      ↑                                           │
│                      └─ Merchant ID, NOT phone number!          │
└─────────────────────────────────────────────────────────────────┘
```

## Important Notes

### ✅ Merchant ID is NOT a Phone Number
- `externalMerchantId` = Sufrah's merchant identifier (e.g., "abc-xyz-123")
- Phone numbers are ONLY used for database lookups within our system
- The Sufrah API NEVER receives phone numbers, only merchant IDs

### ✅ Phone Number Formatting is Already Handled
The bot already tries both formats when looking up restaurants:
1. First tries with `+` prefix: `+966502045939`
2. Falls back to without `+`: `966502045939`

This means restaurants can be registered with or without the `+` sign, and the bot will find them.

### ✅ What Was Actually Broken
The issue was NOT about phone numbers at all! It was:
1. Wrong `Accept` header (`text/plain` instead of `application/json`)
2. Missing response handling for single object vs array
3. Missing error details in logs
4. Incomplete type definitions

## Testing Your Setup

### 1. Check Database
```sql
-- Verify restaurant has external_merchant_id
SELECT 
  id,
  name, 
  whatsapp_number,
  external_merchant_id 
FROM "RestaurantProfile"
WHERE whatsapp_number IN ('966502045939', '+966502045939');
```

### 2. Test Sufrah API Directly
```bash
# Use the MERCHANT ID (not phone number!)
curl -X GET \
  "https://api.sufrah.sa/api/v1/external/merchants/YOUR_MERCHANT_ID/branches" \
  -H "Accept: application/json" \
  -H "Authorization: ApiToken YOUR_TOKEN"
```

### 3. Check Environment Variables
```bash
# Production
SUFRAH_API_BASE=https://api.sufrah.sa/api/v1/external
SUFRAH_API_KEY=your_production_token

# Development
SUFRAH_API_BASE=https://api.dev.sufrah.sa/api/v1/external
SUFRAH_API_KEY=your_dev_token
```

### 4. Monitor Logs
With the new debug logging, you'll see:
```
[Sufrah API] Requesting: https://api.sufrah.sa/api/v1/external/merchants/abc-xyz/branches
[Sufrah API] Success: 200
[Sufrah API] Fetched 3 branches
```

Or if there's an error:
```
[Sufrah API] Error 404: Merchant not found
```

## Summary

The WhatsApp bot now matches the dashboard implementation exactly:
- ✅ Same HTTP headers
- ✅ Same response handling
- ✅ Same error reporting
- ✅ Same type definitions
- ✅ Same validation

The phone number handling was already correct - it's not used when calling Sufrah API at all!


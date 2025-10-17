# Sufrah API Integration Fix

## Problem Analysis

The WhatsApp bot couldn't access restaurant data (branches, categories, items) from the Sufrah API. After comparing with the working dashboard implementation, several issues were identified:

### Issues Found:

1. **Wrong Accept Header**
   - ❌ Bot was using: `Accept: 'text/plain'`
   - ✅ Should be: `Accept: 'application/json'`

2. **Missing Response Handling**
   - Bot didn't handle cases where Sufrah returns a single object instead of an array
   - Missing fallback JSON parsing for responses labeled as text/plain

3. **Incomplete Error Messages**
   - Bot didn't include the response body in error messages, making debugging difficult

4. **Missing Validation**
   - No validation for merchantId/categoryId before making API calls

5. **Type Definitions**
   - Types were incomplete compared to actual Sufrah API responses
   - Missing fields like `avatar`, `priceAfter`, availability flags, area coordinates

## Changes Made

### 1. Updated `src/services/sufrahApi.ts`

#### Fixed HTTP Headers
```typescript
const DEFAULT_HEADERS: Record<string, string> = {
  Accept: 'application/json', // Changed from 'text/plain'
};
```

#### Improved Error Handling
```typescript
if (!response.ok) {
  const body = await response.text().catch(() => '');
  const error = new Error(`Sufrah API ${response.status}: ${body || response.statusText}`);
  (error as any).status = response.status;
  throw error;
}
```

#### Added Fallback JSON Parsing
```typescript
try {
  return (await response.json()) as Promise<T>;
} catch {
  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error('Invalid response format from Sufrah API');
  }
}
```

#### Added Input Validation and Array Normalization
```typescript
export async function fetchMerchantCategories(merchantId: string): Promise<SufrahCategory[]> {
  if (!merchantId) throw new Error('Missing merchant id');
  const data = await request<SufrahCategory[] | SufrahCategory>(`merchants/${merchantId}/categories`);
  return Array.isArray(data) ? data : [data];
}
```

#### Updated Type Definitions
Added missing fields to match actual Sufrah API responses:
- `SufrahProduct`: `avatar`, `priceAfter`, availability flags
- `SufrahBranch`: `centerLongitude`, `centerLatitude`, `radius` in areas

## Phone Number Handling

### How it Works:
1. **Customer sends WhatsApp message** → Bot receives with format `whatsapp:+966XXXXXXXXX`
2. **Lookup Restaurant** → Uses phone number to find restaurant in database
3. **Get External Merchant ID** → Retrieves `externalMerchantId` from `RestaurantProfile` table
4. **Call Sufrah API** → Uses `externalMerchantId` (NOT phone number) to fetch data

### Important Notes:
- ✅ The `externalMerchantId` is the Sufrah merchant ID (e.g., "abc-123-xyz")
- ✅ Phone numbers are ONLY used for database lookups within our system
- ✅ The Sufrah API receives merchant IDs, NOT phone numbers
- ✅ The bot already has fallback logic to try with/without "+" prefix for database lookups

### Database Lookup Logic (from `sufrahRestaurantService.ts`):
```typescript
// Try with + prefix first
WHERE whatsapp_number = '+966XXXXXXXXX'

// Fallback: try without + prefix (for Sufrah API compatibility)
WHERE whatsapp_number = '966XXXXXXXXX'
```

## Environment Configuration

### Required Environment Variables:
```bash
# Sufrah API (Production)
SUFRAH_API_BASE=https://api.sufrah.sa/api/v1/external
SUFRAH_API_KEY=your_api_token_here

# OR Sufrah API (Development)
SUFRAH_API_BASE=https://api.dev.sufrah.sa/api/v1/external
SUFRAH_API_KEY=your_dev_api_token_here
```

**Note**: The authorization header will be: `ApiToken your_api_token_here`

## Testing

### Test the Sufrah API Connection:
```bash
# Test with merchant ID (not phone number!)
curl -X GET "https://api.sufrah.sa/api/v1/external/merchants/YOUR_MERCHANT_ID/branches" \
  -H "Accept: application/json" \
  -H "Authorization: ApiToken YOUR_API_TOKEN"
```

### Verify Database Setup:
```sql
-- Check if restaurants have externalMerchantId set
SELECT id, name, whatsapp_number, external_merchant_id 
FROM "RestaurantProfile" 
WHERE external_merchant_id IS NOT NULL;
```

## Common Issues & Solutions

### Issue: "Cannot access restaurant data"
**Solution**: Verify that:
1. Restaurant has `external_merchant_id` set in database
2. The merchant ID exists in Sufrah system
3. API token is valid and has correct permissions
4. Using correct API base URL (production vs dev)

### Issue: "Restaurant registered without +"
**Solution**: This is normal and handled automatically:
- Bot tries lookup with `+966XXXXXXXXX` first
- Falls back to `966XXXXXXXXX` if not found
- The `externalMerchantId` (not phone number) is used for Sufrah API

### Issue: "Postman works but bot doesn't"
**Solution**: Check:
1. Are you using the same merchant ID in both?
2. Same API base URL?
3. Same authorization token?
4. Same Accept header (`application/json`)?

## Next Steps

1. ✅ Verify environment variables are set correctly
2. ✅ Test with a known working merchant ID
3. ✅ Check database for correct `externalMerchantId` values
4. ✅ Monitor logs for detailed error messages
5. ✅ Ensure using production API URL if testing with production merchants

## Code Flow Example

```
Customer: +966501234567 → WhatsApp Message
    ↓
Bot: standardizeWhatsappNumber('+966501234567')
    ↓
Database Lookup: 
    - Try: whatsapp_number = '+966501234567'
    - Fallback: whatsapp_number = '966501234567'
    ↓
Found Restaurant:
    - id: "rest_abc123"
    - name: "My Restaurant"
    - externalMerchantId: "merchant_xyz789"  ← This is Sufrah merchant ID
    ↓
Sufrah API Call:
    GET https://api.sufrah.sa/api/v1/external/merchants/merchant_xyz789/branches
    Headers: Authorization: ApiToken xxx, Accept: application/json
    ↓
Response: List of branches
```

## Conclusion

The fixes align the bot's Sufrah API integration with the working dashboard implementation. The key changes were:
1. Correct HTTP headers
2. Proper error handling
3. Array normalization
4. Input validation
5. Complete type definitions

The phone number formatting is already handled correctly - the bot uses merchant IDs (not phone numbers) when calling Sufrah API.


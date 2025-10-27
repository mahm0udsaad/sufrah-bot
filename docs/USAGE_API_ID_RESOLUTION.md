# Usage API: User ID vs Restaurant ID Resolution

## Problem Identified

The dashboard was sending **User ID** in the `X-Restaurant-Id` header instead of **Restaurant ID**, causing 404 errors on usage endpoints.

### Example Case
```json
{
  "userId": "cmh9277z60002saerxz967014",      // ❌ Dashboard was sending this
  "restaurant": {
    "id": "cmh92786r0004saer5gfx81le"        // ✅ Should send this
  }
}
```

## Solution Implemented

The backend now **automatically resolves both User ID and Restaurant ID** in the `X-Restaurant-Id` header. This makes the API more forgiving and backwards compatible.

### How It Works

When you send a request with `X-Restaurant-Id` header:

1. **First**: Backend tries to find a restaurant with that ID
2. **Fallback**: If not found, it looks up the user and gets their restaurant ID
3. **Result**: Works seamlessly with either ID type

```typescript
// Both of these now work:
X-Restaurant-Id: cmh92786r0004saer5gfx81le  // Restaurant ID (preferred)
X-Restaurant-Id: cmh9277z60002saerxz967014  // User ID (auto-resolved)
```

## Best Practices for Dashboard

### Recommended: Use Restaurant ID
```javascript
// ✅ PREFERRED: Use restaurant.id directly
const response = await fetch('/api/usage', {
  headers: {
    'Authorization': `Bearer ${PAT}`,
    'X-Restaurant-Id': user.restaurant.id  // Restaurant ID
  }
});
```

### Also Works: User ID
```javascript
// ✅ ALSO WORKS: Use user.id (auto-resolved by backend)
const response = await fetch('/api/usage', {
  headers: {
    'Authorization': `Bearer ${PAT}`,
    'X-Restaurant-Id': user.id  // User ID
  }
});
```

## Impact

### Before Fix
- ❌ Dashboard sending User ID → 404 "Restaurant not found"
- ❌ Had to manually map User ID → Restaurant ID on frontend
- ❌ Confusing error messages

### After Fix
- ✅ Dashboard sending User ID → Works (auto-resolved)
- ✅ Dashboard sending Restaurant ID → Works (direct lookup)
- ✅ Clear error messages if neither found
- ✅ No breaking changes to existing code

## Testing

Use the diagnostic script to verify your setup:

```bash
# Check which ID should be used
bun run scripts/debugUsageApi.ts <your-user-id>

# Test the API with both IDs
bun run scripts/testUsageApiFix.ts
```

### Example Output
```
🔍 Debugging Usage API for: cmh9277z60002saerxz967014
============================================================

✅ Found USER:
   ID: cmh9277z60002saerxz967014
   Name: showrmakarm

✅ Found RESTAURANT:
   ID: cmh92786r0004saer5gfx81le ⚠️  THIS IS THE CORRECT ID TO USE
   Name: showrmakarm
   Status: PENDING_APPROVAL
   Active: true

💳 Quota Status:
   Plan: Free Plan
   Used: 3 / 1000
   Remaining: 997
   Allowed: ✅
```

## API Endpoints Affected

All these endpoints now accept both User ID and Restaurant ID:

### PAT Authentication
- `GET /api/usage` (with X-Restaurant-Id header)
- `GET /api/usage/details` (with X-Restaurant-Id header)

### Example Request
```bash
# With User ID (auto-resolved)
curl -H "Authorization: Bearer ${DASHBOARD_PAT}" \
     -H "X-Restaurant-Id: cmh9277z60002saerxz967014" \
     https://api.sufrah.com/api/usage

# With Restaurant ID (direct)
curl -H "Authorization: Bearer ${DASHBOARD_PAT}" \
     -H "X-Restaurant-Id: cmh92786r0004saer5gfx81le" \
     https://api.sufrah.com/api/usage
```

Both return the same result:
```json
{
  "restaurantId": "cmh92786r0004saer5gfx81le",
  "restaurantName": "showrmakarm",
  "conversationsThisMonth": 3,
  "allowance": {
    "dailyLimit": 1000,
    "dailyRemaining": 1000,
    "monthlyLimit": 1000,
    "monthlyRemaining": 997
  },
  "usagePercent": 0.3,
  "isNearingQuota": false
}
```

## Error Handling

### Restaurant Not Found
```json
{
  "error": "Restaurant not found for provided ID"
}
```
**Cause**: The ID doesn't match any user or restaurant in the database.

**Solution**:
1. Verify the user exists: Check authentication/registration flow
2. Verify restaurant profile created: Check onboarding completion
3. Check for typos in the ID

### Missing Header
```json
{
  "error": "X-Restaurant-Id header is required for PAT"
}
```
**Cause**: The `X-Restaurant-Id` header is missing.

**Solution**: Always include the header with PAT authentication.

## Migration Guide

### If You're Using User ID Currently
**No changes needed!** Your code will continue to work with the auto-resolution.

### If You Want to Update to Restaurant ID
```javascript
// Old code (still works)
const userId = user.id;
fetch('/api/usage', {
  headers: {
    'Authorization': `Bearer ${PAT}`,
    'X-Restaurant-Id': userId
  }
});

// Updated code (more direct)
const restaurantId = user.restaurant.id;
fetch('/api/usage', {
  headers: {
    'Authorization': `Bearer ${PAT}`,
    'X-Restaurant-Id': restaurantId
  }
});
```

## Performance Notes

- **Restaurant ID**: 1 database query (direct lookup)
- **User ID**: 2 database queries (user lookup + restaurant join)

For optimal performance, prefer using Restaurant ID when available, but the difference is negligible for most use cases.

## Related Documentation

- [Dashboard API Complete Reference](./DASHBOARD_API_COMPLETE_REFERENCE.md)
- [Usage Tracking Implementation](./USAGE_TRACKING_IMPLEMENTATION_SUMMARY.md)
- [Frontend Integration Guide](./FRONTEND_INTEGRATION_GUIDE.md)

## Support

If you encounter issues:

1. Run the diagnostic script: `bun run scripts/debugUsageApi.ts <your-id>`
2. Check server logs for detailed error messages
3. Verify the restaurant profile is created and active
4. Ensure the bot is properly configured

## Changelog

### 2025-10-27
- ✅ Added automatic User ID → Restaurant ID resolution
- ✅ Made `authenticate()` async to support database lookups
- ✅ Added `resolveRestaurantId()` helper function
- ✅ Updated all authentication calls to use `await`
- ✅ Created diagnostic and testing scripts
- ✅ No breaking changes to existing API contracts


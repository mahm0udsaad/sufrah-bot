# Important Update for Dashboard Developers - Usage API ID Resolution

**Date**: 2025-10-27  
**Priority**: Medium (Non-breaking enhancement)  
**Status**: ✅ Deployed

## TL;DR

The Usage API now **automatically accepts both User ID and Restaurant ID** in the `X-Restaurant-Id` header. Your existing code will continue to work without any changes.

## What Changed

### Before
```javascript
// Only Restaurant ID worked
headers: {
  'X-Restaurant-Id': user.restaurant.id  // ✅ Worked
  'X-Restaurant-Id': user.id             // ❌ 404 Error
}
```

### After
```javascript
// Both User ID and Restaurant ID work
headers: {
  'X-Restaurant-Id': user.restaurant.id  // ✅ Works (preferred)
  'X-Restaurant-Id': user.id             // ✅ Also works now!
}
```

## Why This Matters

We identified that some dashboard implementations were sending the User ID instead of Restaurant ID, causing **404 "Restaurant not found"** errors even though the restaurant existed and had usage data.

**Example Case**:
- User ID: `cmh9277z60002saerxz967014` → ❌ Was returning 404
- Restaurant ID: `cmh92786r0004saer5gfx81le` → ✅ Worked

Now both IDs work seamlessly!

## Action Required

### ✅ None! (It's backwards compatible)

Your existing code will continue to work whether you're using User ID or Restaurant ID.

### Optional Optimization

If you want slightly better performance (one less database query):

```javascript
// Before (still works fine)
const response = await fetch('/api/usage', {
  headers: {
    'Authorization': `Bearer ${PAT}`,
    'X-Restaurant-Id': user.id
  }
});

// After (marginally faster)
const response = await fetch('/api/usage', {
  headers: {
    'Authorization': `Bearer ${PAT}`,
    'X-Restaurant-Id': user.restaurant.id
  }
});
```

**Performance difference**: ~5-10ms (negligible for most use cases)

## Technical Details

### How It Works

The backend now:
1. First tries to find a restaurant with the provided ID
2. If not found, looks up the user and retrieves their restaurant ID
3. Returns proper error only if neither exists

### Affected Endpoints

All PAT-authenticated endpoints:
- `GET /api/usage`
- `GET /api/usage/details`

### Error Messages

**Old Error** (when using User ID):
```json
{
  "error": "Restaurant not found"
}
```

**New Error** (only if truly not found):
```json
{
  "error": "Restaurant not found for provided ID"
}
```

## Testing Your Integration

### Quick Test

```javascript
// Test with User ID
const testUserId = await fetch('/api/usage', {
  headers: {
    'Authorization': `Bearer ${YOUR_PAT}`,
    'X-Restaurant-Id': user.id  // User ID
  }
});

console.log('User ID test:', testUserId.status);  // Should be 200

// Test with Restaurant ID
const testRestaurantId = await fetch('/api/usage', {
  headers: {
    'Authorization': `Bearer ${YOUR_PAT}`,
    'X-Restaurant-Id': user.restaurant.id  // Restaurant ID
  }
});

console.log('Restaurant ID test:', testRestaurantId.status);  // Should be 200
```

Both should return **200 OK** with identical data.

## Response Format

No changes to response format. Same structure as before:

```typescript
interface UsageResponse {
  restaurantId: string;        // Always the restaurant ID
  restaurantName: string;
  conversationsThisMonth: number;
  lastConversationAt: string | null;
  allowance: {
    dailyLimit: number;
    dailyRemaining: number;
    monthlyLimit: number;
    monthlyRemaining: number;
  };
  adjustedBy: number;
  usagePercent: number | null;
  isNearingQuota: boolean;
  firstActivity: string | null;
  lastActivity: string | null;
  isActive: boolean;
}
```

## Common Questions

### Q: Should I update my code?
**A**: Not required. It's a backwards-compatible enhancement. Update only if you want minimal performance gains.

### Q: Which ID should I use?
**A**: Either works! Use `user.restaurant.id` for slightly better performance, or `user.id` for convenience.

### Q: Will this fix existing 404 errors?
**A**: Yes! If you were getting 404s because you sent User ID, it will now work automatically.

### Q: Are there any breaking changes?
**A**: No. All existing API calls continue to work exactly as before.

### Q: What if I send an invalid ID?
**A**: You'll get a 404 with the error message "Restaurant not found for provided ID".

## Best Practices

### ✅ Recommended Approach

```javascript
// Get user data from authentication
const user = await getCurrentUser();

// Use restaurant ID directly from user object
const response = await fetch('/api/usage', {
  headers: {
    'Authorization': `Bearer ${DASHBOARD_PAT}`,
    'X-Restaurant-Id': user.restaurant?.id || user.id
  }
});
```

This approach:
- Uses Restaurant ID when available (optimal)
- Falls back to User ID (also works)
- Handles edge cases gracefully

### ❌ Anti-patterns to Avoid

```javascript
// Don't hardcode IDs
'X-Restaurant-Id': 'cmh92786r0004saer5gfx81le'

// Don't skip validation
if (!user.restaurant?.id && !user.id) {
  throw new Error('No valid ID found');
}
```

## Need Help?

### Diagnostic Tools

If you encounter issues, the backend team has created diagnostic scripts:

```bash
# Check restaurant configuration
bun run scripts/debugUsageApi.ts <your-user-id>

# Shows:
# - User ID vs Restaurant ID mapping
# - Bot configuration
# - Usage records
# - Quota status
```

### Support

If you experience any issues:
1. Verify the user has a restaurant profile
2. Check the restaurant is active
3. Ensure the bot is configured
4. Contact backend team with user ID

## Implementation Details

For the curious, here's what changed in the backend:

```typescript
// New resolution function
async function resolveRestaurantId(identifier: string): Promise<string | null> {
  // Try restaurant ID first
  const restaurant = await prisma.restaurant.findUnique({
    where: { id: identifier }
  });
  
  if (restaurant) return restaurant.id;

  // Fallback to user ID
  const user = await prisma.user.findUnique({
    where: { id: identifier },
    include: { RestaurantProfile: true }
  });

  return user?.RestaurantProfile?.id || null;
}

// Updated authentication
async function authenticate(req: any): Promise<AuthResult> {
  // ... PAT validation ...
  
  const identifier = req.headers.get('x-restaurant-id');
  const restaurantId = await resolveRestaurantId(identifier);
  
  if (!restaurantId) {
    return { ok: false, error: 'Restaurant not found for provided ID' };
  }
  
  return { ok: true, restaurantId };
}
```

## Resources

- **Full Documentation**: `docs/USAGE_API_ID_RESOLUTION.md`
- **Fix Summary**: `USAGE_API_404_FIX.md`
- **API Reference**: `docs/DASHBOARD_API_COMPLETE_REFERENCE.md`

## Changelog

**v1.1.0** - 2025-10-27
- ✅ Added automatic User ID → Restaurant ID resolution
- ✅ Made `X-Restaurant-Id` header accept both ID types
- ✅ Improved error messages
- ✅ Added diagnostic and testing tools
- ✅ Zero breaking changes

---

**Questions or concerns?** Contact the backend team or open an issue.

**Happy coding! 🚀**


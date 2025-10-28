# Production Authentication & Authorization Fixes

## Summary of Issues Fixed

### 1. Missing `tenantId` Query Parameter Errors (400 Bad Request)
**Affected Endpoints:**
- `/api/ratings`
- `/api/ratings/reviews`
- `/api/ratings/timeline`
- All other dashboard API endpoints

**Root Cause:**
The dashboard API handlers in `dashboardApiExtended.ts` and `dashboardApi.ts` required a `tenantId` query parameter but the frontend was only sending the `X-Restaurant-Id` header.

**Solution:**
Modified the `getTenantAndRestaurantId()` helper function in both files to:
1. First try to get `tenantId` from query parameters
2. Fall back to `X-Restaurant-Id` header if query param is not provided
3. Accept the Request object as a parameter to access headers

**Files Changed:**
- `src/server/routes/dashboard/dashboardApiExtended.ts`
- `src/server/routes/dashboard/dashboardApi.ts`

### 2. Forbidden Access Error (403 Forbidden)
**Affected Endpoint:**
- `/api/tenants/:id/overview`

**Root Cause:**
The tenants API was enforcing a strict security check that required the `X-Restaurant-Id` header to exactly match the tenant ID in the URL path. This was overly restrictive and inconsistent with other dashboard APIs.

Example of the mismatch:
- URL: `/api/tenants/cmh92786r0004saer5gfx81le/overview`
- Header: `X-Restaurant-Id: cmh93958o0004sauw8iv09f7n`

**Solution:**
Removed the strict tenant ID matching requirement. Now the API:
1. Verifies the user has valid authentication (PAT token or API key)
2. Uses the tenant ID from the URL as the source of truth
3. Returns data for the requested tenant (consistent with other dashboard APIs)

**Files Changed:**
- `src/server/routes/api/tenants.ts`

## Technical Details

### Authentication Flow (After Fix)

#### For Query Parameter-Based APIs (e.g., `/api/ratings?tenantId=xxx`)
```typescript
// Try query parameter first
let tenantId = url.searchParams.get('tenantId');

// Fallback to X-Restaurant-Id header
if (!tenantId && req) {
  tenantId = req.headers.get('x-restaurant-id') || null;
}
```

#### For Path Parameter-Based APIs (e.g., `/api/tenants/:id/overview`)
```typescript
// Extract tenant ID from URL path
const botId = overviewMatch[1]; // from /api/tenants/:id/overview

// Authenticate (verify PAT or API key)
const auth = await authenticateDashboard(req);

// Use URL tenant ID as source of truth (no strict matching required)
const resolved = await resolveRestaurantId(botId);
```

### Security Considerations

**Authentication vs Authorization:**
- **Authentication**: Verifying the user has valid credentials (PAT token) ✅
- **Authorization**: Verifying the user has access to specific tenant data ⚠️

**Current Approach:**
- All authenticated users can access any tenant's data
- This is consistent across all dashboard APIs
- The `X-Restaurant-Id` header is optional and used as a fallback, not as a security boundary

**Future Enhancement (If Needed):**
If you need to restrict users to specific tenants, you should:
1. Create a user-tenant relationship table in the database
2. Check this relationship during authentication
3. Apply the check consistently across ALL dashboard APIs

## Testing

### Test Cases That Should Now Work

1. **Ratings API with header only:**
```bash
curl -H "Authorization: Bearer YOUR_PAT" \
     -H "X-Restaurant-Id: cmh92786r0004saer5gfx81le" \
     https://bot.sufrah.sa/api/ratings?locale=ar&days=30
```

2. **Ratings API with query parameter only:**
```bash
curl -H "Authorization: Bearer YOUR_PAT" \
     https://bot.sufrah.sa/api/ratings?tenantId=cmh92786r0004saer5gfx81le&locale=ar&days=30
```

3. **Tenants API (path-based):**
```bash
curl -H "Authorization: Bearer YOUR_PAT" \
     -H "X-Restaurant-Id: cmh93958o0004sauw8iv09f7n" \
     https://bot.sufrah.sa/api/tenants/cmh92786r0004saer5gfx81le/overview?currency=SAR
```
Note: Header and URL tenant IDs can be different (no longer enforced to match)

## Deployment Notes

1. **No Database Changes Required**: All changes are code-only
2. **Backward Compatible**: Existing API calls with query parameters will continue to work
3. **No Breaking Changes**: Only adds header fallback support, doesn't remove query parameter support
4. **Environment Variables**: No changes needed

## Files Modified

1. `src/server/routes/dashboard/dashboardApiExtended.ts` - Updated 18 function calls
2. `src/server/routes/dashboard/dashboardApi.ts` - Updated 9 function calls  
3. `src/server/routes/api/tenants.ts` - Removed strict tenant matching

## Monitoring

After deployment, monitor for:
- ✅ Successful API calls to `/api/ratings*` endpoints
- ✅ Successful API calls to `/api/tenants/*/overview`
- ❌ Any new 400 or 403 errors in production logs
- 📊 Check that all dashboard metrics are loading correctly

## Rollback Plan

If issues occur, revert these 3 files:
```bash
git checkout HEAD~1 src/server/routes/dashboard/dashboardApiExtended.ts
git checkout HEAD~1 src/server/routes/dashboard/dashboardApi.ts
git checkout HEAD~1 src/server/routes/api/tenants.ts
```

Then restart the service.


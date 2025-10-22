# Usage Tracking & Quota Enforcement - Implementation Summary

**Date:** October 21, 2025  
**Status:** ✅ Complete (patched Oct 21 2025 for session rollover & queue tracking)  
**Test Coverage:** 34 tests, all passing

## What Was Implemented

A comprehensive usage tracking and quota enforcement system that (as of the Oct 21 2025 patch):

1. **Tracks 24-hour conversation sessions** - Accurately detects when a customer starts a new conversation with a restaurant
2. **Enforces monthly quota limits** - Prevents restaurants from exceeding their plan limits (default: 1000 conversations/month)
3. **Handles all edge cases** - Midnight rollover, month boundaries, concurrent requests, and long-running sessions (session windows now extend on activity)
4. **Provides graceful error responses** - Clear error messages with quota details when limits are reached, aligned with the dashboard’s 1,000 conversation plan

## Files Created

### Core Services
- `src/services/sessionDetection.ts` - 24-hour session detection logic (patch: extends session window on activity)
- `src/services/usageTracking.ts` - Monthly usage persistence and tracking (patch: exported `trackUsage` helper for async send queue)
- `src/services/quotaEnforcement.ts` - Quota checking and enforcement

### Tests
- `tests/sessionDetection.test.ts` - 16 unit tests for session detection
- `tests/quotaEnforcement.test.ts` - 18 integration tests for quota enforcement

### Documentation
- `docs/USAGE_TRACKING_AND_QUOTA_ENFORCEMENT.md` - Comprehensive technical documentation
- `docs/USAGE_TRACKING_IMPLEMENTATION_SUMMARY.md` - This file

## Files Modified

### Database
- `prisma/schema.prisma` - Added `ConversationSession` and `MonthlyUsage` tables
- `prisma/migrations/20251021082921_add_usage_tracking_tables/` - Migration files

### Integration Points
- `src/handlers/processMessage.ts` - Added usage tracking on inbound messages
- `src/server/routes/api/notify.ts` - Added quota enforcement on outbound messages
- `src/redis/whatsappSendQueue.ts` - Uses `trackUsage` to account for queued outbound sessions
- `src/server/routes/api/usage.ts` - Dashboard allowance now mirrors backend quota enforcement

## Database Changes

### New Tables

**ConversationSession** - Tracks individual 24-hour conversation windows
```sql
CREATE TABLE "ConversationSession" (
  id              TEXT PRIMARY KEY,
  restaurant_id   TEXT NOT NULL,
  customer_wa     TEXT NOT NULL,
  session_start   TIMESTAMP NOT NULL,
  session_end     TIMESTAMP NOT NULL,
  message_count   INTEGER DEFAULT 0,
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP,
  UNIQUE(restaurant_id, customer_wa, session_start),
  FOREIGN KEY (restaurant_id) REFERENCES "RestaurantProfile"(id)
);
```

**MonthlyUsage** - Tracks aggregated monthly conversation counts
```sql
CREATE TABLE "MonthlyUsage" (
  id                    TEXT PRIMARY KEY,
  restaurant_id         TEXT NOT NULL,
  month                 INTEGER NOT NULL,
  year                  INTEGER NOT NULL,
  conversation_count    INTEGER DEFAULT 0,
  last_conversation_at  TIMESTAMP,
  created_at            TIMESTAMP DEFAULT NOW(),
  updated_at            TIMESTAMP,
  UNIQUE(restaurant_id, month, year),
  FOREIGN KEY (restaurant_id) REFERENCES "RestaurantProfile"(id)
);
```

## How It Works

### 1. Inbound Message Flow

```
Customer sends message
    ↓
processMessage() handler
    ↓
trackMessage(restaurantId, customerPhone)
    ↓
detectSession() - Check for active session
    ↓
If no active session OR expired:
    - Create new session (24h window)
    - Increment monthly usage counter
    ↓
If active session exists:
    - Reuse session
    - Increment message count
    ↓
Return session info + monthly usage
```

### 2. Outbound Message Flow

```
External system calls /api/whatsapp/send
    ↓
Authenticate request
    ↓
Resolve restaurant from phone number
    ↓
checkQuota(restaurantId)
    ↓
If quota exceeded:
    - Return 429 error with details
    ↓
If quota OK:
    - Send message
    - Return success
```

## Plan Tiers & Limits

| Plan       | Monthly Limit | Status      |
|------------|---------------|-------------|
| FREE       | 1,000         | ✅ Default  |
| BASIC      | 5,000         | ✅ Ready    |
| PRO        | 25,000        | ✅ Ready    |
| ENTERPRISE | Unlimited     | ✅ Ready    |

Plans are configured in `src/services/quotaEnforcement.ts` and can easily be moved to a database table for dynamic management.

## Test Results

### Session Detection Tests (16/16 passing)
✅ First message creates new session  
✅ Repeat messages reuse session  
✅ New session after 24 hours  
✅ Midnight rollover handling  
✅ 24h boundary edge case  
✅ Separate sessions per customer  
✅ Message count incrementing  
✅ Session active checks  
✅ Time remaining calculations  
✅ Session statistics  

### Quota Enforcement Tests (18/18 passing)
✅ Allow messages under quota  
✅ Block messages at limit  
✅ Monthly quota reset  
✅ Track across multiple days  
✅ Ignore repeat messages in 24h  
✅ Quota warning thresholds (90%)  
✅ Usage percentage calculations  
✅ Different plan tier enforcement  
✅ Unlimited plan handling  
✅ Month boundary handling  
✅ Year boundary handling  
✅ Concurrent request handling  
✅ Exact limit edge cases  
✅ Utility functions  

**Total: 34 tests, 83 assertions, all passing ✅**

## Error Responses

### Quota Exceeded (429 Too Many Requests)
```json
{
  "error": "Monthly conversation limit of 1000 reached. Used: 1000 conversations. Please upgrade your plan or wait until next month.",
  "code": "QUOTA_EXCEEDED",
  "details": {
    "used": 1000,
    "limit": 1000,
    "remaining": 0,
    "planName": "Free Plan",
    "resetDate": "2025-11-01T00:00:00.000Z",
    "daysUntilReset": 10
  }
}
```

## Logging Examples

```
📊 New 24h conversation session started for restaurant clz1abc123. Monthly count: 45
⚠️ Restaurant clz1abc123 is at 92.5% quota usage (925/1000)
⚠️ Quota exceeded for restaurant clz1abc123: 1000/1000 conversations used
```

## Key Features

### ✅ Session Detection
- Accurately detects new 24-hour conversation windows
- Handles midnight rollover seamlessly
- Prevents double-counting within 24h
- Tracks message count per session

### ✅ Usage Tracking
- Persists monthly conversation counts
- Tracks last conversation timestamp
- Provides usage history (last N months)
- Supports usage analytics

### ✅ Quota Enforcement
- Checks quota before sending outbound messages
- Returns detailed error responses
- Supports multiple plan tiers
- Calculates days until quota reset
- Warns when approaching limit (90%+)

### ✅ Edge Case Handling
- Midnight rollover (same session spans midnight)
- Month boundaries (quota resets properly)
- Year boundaries (tracks across years)
- Concurrent requests (race condition handling)
- Exactly at limit (blocks at 1000, allows at 999)

## API Examples

### Check Quota Status
```typescript
import { getQuotaStatus } from './services/quotaEnforcement';

const status = await getQuotaStatus('restaurant_id');
console.log(status);
// {
//   allowed: true,
//   used: 450,
//   limit: 1000,
//   remaining: 550,
//   planName: 'Free Plan'
// }
```

### Track Message
```typescript
import { trackMessage } from './services/usageTracking';

const result = await trackMessage('restaurant_id', '+966500000001');
console.log(result.sessionInfo.isNewSession); // true or false
console.log(result.monthlyUsage.conversationCount); // 451
```

### Detect Session
```typescript
import { detectSession } from './services/sessionDetection';

const session = await detectSession('restaurant_id', '+966500000001');
console.log(session);
// {
//   isNewSession: true,
//   sessionId: 'cm2abc123',
//   sessionStart: Date,
//   sessionEnd: Date (24h later)
// }
```

## Deployment Checklist

- [x] Database migration created
- [x] Migration applied to database
- [x] Prisma client generated
- [x] Services implemented
- [x] Integration points updated
- [x] Unit tests written and passing
- [x] Integration tests written and passing
- [x] Documentation created
- [x] Error handling implemented
- [x] Logging added
- [ ] Production environment variables configured (if any)
- [ ] Monitoring/alerting setup (optional)
- [ ] Dashboard integration (optional)

## Next Steps (Optional)

### Short Term
1. **Monitor Usage** - Track how restaurants use their quota
2. **Set Up Alerts** - Alert when restaurants approach limits
3. **Create Admin Dashboard** - View usage statistics across all restaurants

### Medium Term
1. **Dynamic Plan Management** - Move plan configs to database
2. **Proactive Notifications** - Email/SMS alerts at 80%, 90%, 100%
3. **Usage Analytics** - Visualize trends and patterns

### Long Term
1. **Usage-Based Billing** - Calculate charges for overages
2. **Session Quality Metrics** - Track messages per session
3. **Quota Rollover** - Allow unused quota to roll over (optional)

## Performance Considerations

- **Database Indexes**: Added indexes on common query patterns
- **Concurrent Safety**: Unique constraints prevent duplicate sessions
- **Query Optimization**: Uses efficient upsert operations
- **Caching**: Can add Redis caching for quota checks if needed

## Backward Compatibility

✅ **Fully backward compatible** - No breaking changes to existing functionality:
- Existing restaurants continue to work normally
- Usage tracking happens automatically in the background
- Only new outbound messages check quota
- No changes required to existing code

## Support

For questions or issues:
1. See `docs/USAGE_TRACKING_AND_QUOTA_ENFORCEMENT.md` for detailed documentation
2. Run tests: `bun test tests/sessionDetection.test.ts tests/quotaEnforcement.test.ts`
3. Check logs for `📊`, `⚠️` messages related to usage tracking

---

## Summary

✅ **Complete**: All requested features implemented  
✅ **Tested**: 34 comprehensive tests, all passing  
✅ **Documented**: Detailed technical and usage documentation  
✅ **Production Ready**: Edge cases handled, error responses polished  
✅ **Backward Compatible**: No breaking changes  

The system is ready for production use with the FREE plan (1000 conversations/month) as the default limit.

# Usage Tracking & Quota Enforcement System

## Overview

This document describes the comprehensive usage tracking and quota enforcement system implemented for the WhatsApp bot platform. The system tracks 24-hour conversation sessions per restaurant and enforces plan-based limits (default: 1000 conversations/month for the FREE plan).

## Architecture

### Core Components

1. **Session Detection Service** (`src/services/sessionDetection.ts`)
   - Detects new 24-hour conversation sessions
   - Tracks message counts per session
   - Handles session lifecycle (creation, reuse, expiration)

2. **Usage Tracking Service** (`src/services/usageTracking.ts`)
   - Captures and persists monthly conversation counts
   - Integrates with session detection
   - Provides usage history and reporting

3. **Quota Enforcement Service** (`src/services/quotaEnforcement.ts`)
   - Checks remaining quota before allowing messages
   - Supports multiple plan tiers (FREE, BASIC, PRO, ENTERPRISE)
   - Provides graceful error responses when limits are reached

### Database Schema

Two new tables were added to track usage:

#### `ConversationSession`
Tracks individual 24-hour conversation windows:
```prisma
model ConversationSession {
  id              String       @id @default(cuid())
  restaurantId    String
  customerWa      String
  sessionStart    DateTime
  sessionEnd      DateTime     // sessionStart + 24 hours
  messageCount    Int          @default(0)
  createdAt       DateTime     @default(now())
  updatedAt       DateTime     @updatedAt
  restaurant      Restaurant   @relation(...)
  
  @@unique([restaurantId, customerWa, sessionStart])
}
```

#### `MonthlyUsage`
Tracks aggregated monthly conversation counts:
```prisma
model MonthlyUsage {
  id                  String     @id @default(cuid())
  restaurantId        String
  month               Int        // 1-12
  year                Int
  conversationCount   Int        @default(0)
  lastConversationAt  DateTime?
  createdAt           DateTime   @default(now())
  updatedAt           DateTime   @updatedAt
  restaurant          Restaurant @relation(...)
  
  @@unique([restaurantId, month, year])
}
```

## How It Works

### 1. Session Detection (24-Hour Window)

A new conversation session is created when:
- A customer sends their first message to a restaurant
- 24+ hours have passed since the previous session ended

Sessions are **reused** when:
- A customer sends another message within the 24-hour window
- Only the message count is incremented; no new session is created

**Example:**
```
Day 1, 10:00 AM - Customer sends first message
  → New session created (expires Day 2, 10:00 AM)
  
Day 1, 2:00 PM - Customer sends another message
  → Same session reused, message count = 2
  
Day 2, 11:00 AM - Customer sends message (25 hours later)
  → New session created (session 1 expired)
```

### 2. Usage Tracking

When an inbound message is processed:

1. **Session Detection**: Check if active session exists
2. **Session Creation/Reuse**: Create new or reuse existing session
3. **Monthly Counter**: If new session, increment monthly usage counter
4. **Logging**: Log session creation for monitoring

**Integration Point** (`src/handlers/processMessage.ts`):
```typescript
// Track message for usage/billing (detects new 24h sessions)
const usageResult = await trackMessage(
  restaurantContext.id,
  standardizeWhatsappNumber(phoneNumber) || phoneNumber
);

if (usageResult.sessionInfo.isNewSession) {
  console.log(`📊 New 24h conversation session started. Monthly count: ${usageResult.monthlyUsage.conversationCount}`);
}
```

### 3. Quota Enforcement

Before sending outbound messages via `/api/whatsapp/send`:

1. **Check Quota**: Verify restaurant hasn't exceeded monthly limit
2. **Allow/Block**: Continue if under limit, return 429 error if exceeded
3. **Warning Logs**: Log warnings when approaching 90% usage

**Integration Point** (`src/server/routes/api/notify.ts`):
```typescript
// Check quota if restaurant is found
if (restaurant) {
  const quotaCheck = await checkQuota(restaurant.id);
  
  if (!quotaCheck.allowed) {
    return jsonResponse(formatQuotaError(quotaCheck), 429);
  }
  
  // Warn if nearing quota (90%+)
  if (quotaCheck.limit > 0) {
    const usagePercent = (quotaCheck.used / quotaCheck.limit) * 100;
    if (usagePercent >= 90) {
      console.warn(`⚠️ Restaurant at ${usagePercent.toFixed(1)}% quota usage`);
    }
  }
}
```

## Plan Tiers

The system supports multiple plan tiers with different limits:

| Plan       | Conversations/Month | Code         |
|------------|---------------------|--------------|
| FREE       | 1,000               | `FREE`       |
| BASIC      | 5,000               | `BASIC`      |
| PRO        | 25,000              | `PRO`        |
| ENTERPRISE | Unlimited           | `ENTERPRISE` |

Plan configuration is in `src/services/quotaEnforcement.ts` and can be moved to database or config file for dynamic management.

## Error Responses

When quota is exceeded, the API returns a 429 status with detailed error information:

```json
{
  "error": "Monthly conversation limit of 1000 reached. Used: 1000 conversations.",
  "code": "QUOTA_EXCEEDED",
  "details": {
    "used": 1000,
    "limit": 1000,
    "remaining": 0,
    "planName": "Free Plan",
    "resetDate": "2025-02-01T00:00:00.000Z",
    "daysUntilReset": 15
  }
}
```

## Edge Cases Handled

### 1. Midnight Rollover
✅ Sessions correctly span across midnight boundaries
```
Day 1, 11:30 PM - Session starts
Day 2, 12:30 AM - Same session (only 1 hour passed)
```

### 2. Month Boundaries
✅ Usage correctly resets at start of new month
```
Jan 31, 11:59 PM - 1000 conversations used (at limit)
Feb 1, 12:00 AM  - Counter resets to 0
```

### 3. Concurrent Messages
✅ Handles race conditions when multiple messages arrive simultaneously from same customer

### 4. Exactly at Limit
✅ Correctly blocks at exactly 1000 (or plan limit), allows at 999

## API Usage

### Check Quota Status
```typescript
import { getQuotaStatus } from './services/quotaEnforcement';

const status = await getQuotaStatus(restaurantId);
console.log(`Used: ${status.used}/${status.limit}`);
console.log(`Remaining: ${status.remaining}`);
console.log(`Allowed: ${status.allowed}`);
```

### Track a Message
```typescript
import { trackMessage } from './services/usageTracking';

const result = await trackMessage(restaurantId, customerPhone);
if (result.sessionInfo.isNewSession) {
  console.log('New conversation started!');
}
console.log(`Monthly total: ${result.monthlyUsage.conversationCount}`);
```

### Check if Nearing Quota
```typescript
import { isNearingQuota } from './services/quotaEnforcement';

const isNearing = await isNearingQuota(restaurantId, 0.9); // 90% threshold
if (isNearing) {
  // Send warning notification to restaurant owner
}
```

### Get Usage History
```typescript
import { getUsageHistory } from './services/usageTracking';

const history = await getUsageHistory(restaurantId, 12); // Last 12 months
history.forEach(record => {
  console.log(`${record.year}-${record.month}: ${record.conversationCount} conversations`);
});
```

## Testing

### Unit Tests (`tests/sessionDetection.test.ts`)
Tests session detection edge cases:
- ✅ First message creates new session
- ✅ Repeat messages reuse session
- ✅ New session after 24 hours
- ✅ Midnight rollover handling
- ✅ 24h boundary edge case
- ✅ Separate sessions per customer
- ✅ Message count incrementing

### Integration Tests (`tests/quotaEnforcement.test.ts`)
Tests quota enforcement scenarios:
- ✅ Normal flow within quota
- ✅ Blocking when limit reached
- ✅ Monthly quota reset
- ✅ Quota warning thresholds
- ✅ Different plan tiers
- ✅ Month/year boundary handling
- ✅ Concurrent session handling

**Run tests:**
```bash
bun test tests/sessionDetection.test.ts
bun test tests/quotaEnforcement.test.ts
```

## Monitoring & Observability

### Key Metrics to Monitor

1. **Session Creation Rate**
   - Track `conversationCount` growth rate
   - Alert on unusual spikes

2. **Quota Usage Percentage**
   - Monitor restaurants approaching limits
   - Proactive upgrade recommendations

3. **Blocked Messages**
   - Track 429 responses from `/api/whatsapp/send`
   - Identify restaurants needing upgrades

4. **Session Duration Distribution**
   - Analyze typical conversation patterns
   - Optimize session window if needed

### Logging

The system provides detailed logging:

```
📊 New 24h conversation session started for restaurant abc123. Monthly count: 45
⚠️ Restaurant abc123 is at 92.5% quota usage (925/1000)
⚠️ Quota exceeded for restaurant abc123: 1000/1000 conversations used
```

## Future Enhancements

### Potential Improvements

1. **Dynamic Plan Management**
   - Move plan configs to database
   - Allow per-restaurant custom limits

2. **Usage Analytics Dashboard**
   - Visualize usage trends
   - Predict when quota will be reached

3. **Proactive Notifications**
   - Email/SMS alerts at 80%, 90%, 100% usage
   - Upgrade suggestions

4. **Usage-Based Billing**
   - Track overage conversations
   - Calculate charges for pay-as-you-go plans

5. **Session Quality Metrics**
   - Track messages per session
   - Identify engagement patterns

6. **Quota Rollover**
   - Allow unused quota to roll over (optional)
   - Implement as plan feature

## Migration Notes

### Applying the Migration

```bash
# Generate Prisma client
bunx prisma generate

# Apply migration
bunx prisma migrate dev

# Or for production
bunx prisma migrate deploy
```

### Backfilling Historical Data (Optional)

If you want to backfill usage data from existing conversations:

```typescript
// Example backfill script (not included)
const existingMessages = await prisma.message.findMany({
  where: {
    direction: 'IN',
    createdAt: { gte: new Date('2025-01-01') },
  },
  orderBy: { createdAt: 'asc' },
});

for (const message of existingMessages) {
  await trackMessage(
    message.restaurantId,
    message.customerWa,
    message.createdAt
  );
}
```

## Support & Troubleshooting

### Common Issues

**Issue**: Sessions not being detected
- **Check**: Ensure `restaurantContext.id` is valid
- **Fix**: Verify restaurant exists in database

**Issue**: Quota not resetting monthly
- **Check**: System time/timezone configuration
- **Fix**: Ensure server time is UTC

**Issue**: Concurrent requests creating duplicate sessions
- **Check**: Database unique constraints
- **Fix**: Constraint prevents duplicates, but retry logic may be needed

### Database Queries

Check monthly usage for a restaurant:
```sql
SELECT * FROM "MonthlyUsage" 
WHERE restaurant_id = 'abc123' 
ORDER BY year DESC, month DESC;
```

Check active sessions:
```sql
SELECT * FROM "ConversationSession"
WHERE restaurant_id = 'abc123' 
  AND session_end > NOW()
ORDER BY session_start DESC;
```

## Conclusion

This usage tracking and quota enforcement system provides:

✅ Accurate 24-hour session detection  
✅ Robust monthly usage tracking  
✅ Flexible plan-based quota limits  
✅ Graceful error handling  
✅ Comprehensive test coverage  
✅ Edge case handling (midnight, month boundaries, etc.)  
✅ Production-ready implementation  

The system is fully integrated and ready for production use with the FREE plan (1000 conversations/month) as the default.


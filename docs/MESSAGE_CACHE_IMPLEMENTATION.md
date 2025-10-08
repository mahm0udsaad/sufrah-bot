# Message Cache Implementation Summary

## Overview

This document describes the new MessageCache system that properly saves and retrieves notification messages for the "View Order Details" button functionality.

## What Was Changed

### 1. New Database Table: `MessageCache`

Created a dedicated table to store all notification messages that need to be retrieved later:

**Fields:**
- `id`: Unique identifier
- `toPhone`: Recipient phone number (standardized)
- `fromPhone`: Sender phone number
- `messageText`: The full message content to be delivered when button is clicked
- `templateName`: Name of the template used (e.g., "sufrah_new_order_alert")
- `templateSid`: Twilio template SID
- `outboundMessageId`: Reference to OutboundMessage record
- `delivered`: Boolean flag indicating if message was delivered
- `deliveredAt`: Timestamp when message was delivered
- `expiresAt`: Expiration timestamp (48 hours from creation)
- `metadata`: Additional metadata (JSON)
- `createdAt`: Creation timestamp
- `updatedAt`: Last update timestamp

**Indexes:**
- `(toPhone, createdAt)`: For finding recent messages by phone
- `(toPhone, delivered)`: For finding undelivered messages
- `(expiresAt)`: For cleanup queries

### 2. Updated `sendNotification` Function

Location: `src/services/whatsapp.ts`

**Changes:**
- When sending a template message (outside 24h window), the system now:
  1. Creates a new entry in `MessageCache` with the full message text
  2. Sets expiration to 48 hours from now
  3. Stores metadata including template info and reason
  
- When updating an existing template (duplicate in same window):
  1. Updates the existing `MessageCache` entry with new message text
  2. Or creates a new one if not found

### 3. Updated `consumeCachedMessageForPhone` Function

Location: `src/services/whatsapp.ts`

**Changes:**
- Now queries `MessageCache` table first to find undelivered messages
- Filters by:
  - `toPhone`: Matching phone number
  - `delivered = false`: Only undelivered messages
  - `expiresAt > now()`: Not expired
- When found:
  1. Returns the cached message text
  2. Marks the entry as delivered
  3. Sets `deliveredAt` timestamp
- Falls back to old metadata method for backwards compatibility

### 4. Button Click Handler

Location: `src/webhooks/inboundHandler.ts`

**No changes needed** - Already uses `consumeCachedMessageForPhone` function

## How It Works

### Flow Diagram

```
1. Order Notification Request
   ↓
2. Check if message sent in last 24h
   ↓
3a. YES (within 24h) → Send freeform message (no cache needed)
   ↓
3b. NO (outside 24h) → Send template with button
   ↓
4. Save message to MessageCache table
   - messageText: Full order details
   - expiresAt: 48 hours from now
   - delivered: false
   ↓
5. User receives template with "View Order Details" button
   ↓
6. User clicks button
   ↓
7. Webhook receives button click
   ↓
8. consumeCachedMessageForPhone called
   ↓
9. Query MessageCache for undelivered message
   ↓
10. Send cached message as freeform (within 24h now)
    ↓
11. Mark cache entry as delivered
```

## Testing

### Prerequisites
1. Restart the application to load new Prisma types:
   ```bash
   # Stop the current server (Ctrl+C)
   bun run index.ts
   ```

### Test Scenario 1: New Order Notification (No Recent Message)

1. Send a notification to a phone number that hasn't received a message in 24+ hours:
   ```bash
   curl -X POST http://localhost:3000/api/whatsapp/send \
     -H "Content-Type: application/json" \
     -d '{
       "toPhone": "+1234567890",
       "message": "New order from John Doe\nOrder #12345\nTotal: $50.00\nAddress: 123 Main St"
     }'
   ```

2. Check logs for:
   - `📤 [Notification] Sending to +1234567890 via template channel`
   - `✅ [Notification] Sent as template message with "View Order Details" button`
   - `📦 [MessageCache] Created cache entry xxx for template sufrah_new_order_alert`

3. Verify database:
   ```sql
   SELECT * FROM "MessageCache" WHERE to_phone = '+1234567890' ORDER BY created_at DESC LIMIT 1;
   ```

### Test Scenario 2: Button Click

1. Have the recipient click the "View Order Details" button in WhatsApp

2. Check logs for:
   - `🔘 [ButtonClick] User requested "View Order Details" from 1234567890`
   - `📦 [ConsumeCache] Retrieving and consuming cache for 1234567890`
   - `✅ [ConsumeCache] Found cache entry xxx: "New order from John Doe..."`
   - `📤 [ButtonClick] Sending cached order details to 1234567890`
   - `✅ [ButtonClick] Successfully sent cached message`
   - `✅ [ConsumeCache] Marked cache entry xxx as delivered`

3. Verify database:
   ```sql
   SELECT delivered, delivered_at FROM "MessageCache" WHERE to_phone = '+1234567890' ORDER BY created_at DESC LIMIT 1;
   ```
   Should show `delivered = true` and a recent `delivered_at` timestamp

### Test Scenario 3: Multiple Notifications (Same Window)

1. Send first notification (creates template + cache)
2. Wait a few seconds
3. Send second notification with different message

4. Check logs for:
   - `♻️ [Notification] Existing template already sent in this window; updating cached message`
   - `📦 [MessageCache] Updated existing cache entry xxx with new message`

5. Click button - should receive the LATEST message (from step 3)

### Test Scenario 4: Within 24h Window

1. Send notification
2. Have recipient reply to the message
3. Within 24 hours, send another notification

4. Check logs for:
   - `✅ [Notification] Sent as freeform message (within 24h window)`
   - No MessageCache entry created (not needed for freeform)

## Database Queries for Monitoring

### View all cached messages
```sql
SELECT 
  id,
  to_phone,
  LEFT(message_text, 50) as message_preview,
  template_name,
  delivered,
  delivered_at,
  expires_at,
  created_at
FROM "MessageCache"
ORDER BY created_at DESC
LIMIT 20;
```

### Find undelivered messages
```sql
SELECT 
  to_phone,
  COUNT(*) as undelivered_count,
  MAX(created_at) as latest_message
FROM "MessageCache"
WHERE delivered = false AND expires_at > NOW()
GROUP BY to_phone;
```

### Find expired messages
```sql
SELECT COUNT(*) as expired_count
FROM "MessageCache"
WHERE expires_at < NOW();
```

### Cleanup expired messages (optional)
```sql
DELETE FROM "MessageCache"
WHERE expires_at < NOW() - INTERVAL '7 days';
```

## Migration Info

**Migration file:** `20251009011015_add_message_cache_table/migration.sql`

To apply (already done):
```bash
bunx prisma migrate deploy
```

To rollback (if needed):
```bash
bunx prisma migrate resolve --rolled-back 20251009011015_add_message_cache_table
```

## Backwards Compatibility

The `consumeCachedMessageForPhone` function includes a fallback to the old metadata-based approach:
- First tries to find message in `MessageCache` table
- If not found, falls back to checking `OutboundMessage.metadata.cachedMessage.text`
- This ensures existing cached messages (before this update) still work

## Performance Considerations

1. **Indexes**: All queries use indexed columns for fast lookups
2. **Expiration**: Messages expire after 48 hours to prevent table growth
3. **Cleanup**: Consider adding a cron job to delete expired entries:
   ```typescript
   // Run daily
   await prisma.messageCache.deleteMany({
     where: {
       expiresAt: {
         lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // 7 days old
       }
     }
   });
   ```

## Troubleshooting

### Button click returns "No cached message found"

**Possible causes:**
1. Message expired (>48 hours old)
2. Message already delivered (clicked button twice)
3. Cache entry was not created properly

**Debug steps:**
```sql
-- Check if entry exists
SELECT * FROM "MessageCache" 
WHERE to_phone = '+1234567890' 
ORDER BY created_at DESC;

-- Check if it's delivered or expired
SELECT 
  delivered, 
  delivered_at,
  expires_at,
  expires_at < NOW() as is_expired
FROM "MessageCache"
WHERE to_phone = '+1234567890'
ORDER BY created_at DESC
LIMIT 1;
```

### TypeScript errors about messageCache property

**Solution:** Restart your IDE or TypeScript server to pick up new Prisma types

### Database drift warning

**Solution:** 
```bash
bunx prisma db push
# or
bunx prisma migrate reset
```

## Next Steps

1. **Add cleanup cron job** for expired messages
2. **Add monitoring** for undelivered message rates
3. **Add analytics** for button click rates
4. **Consider notification** for messages nearing expiration

## Files Modified

- `prisma/schema.prisma` - Added MessageCache model
- `prisma/migrations/20251009011015_add_message_cache_table/migration.sql` - Migration file
- `src/services/whatsapp.ts` - Updated sendNotification and consumeCachedMessageForPhone
- No changes to `src/webhooks/inboundHandler.ts` (already compatible)


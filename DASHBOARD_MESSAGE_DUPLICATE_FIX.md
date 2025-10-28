# Dashboard Message Duplicate Fix

## Problem
When dashboard users sent messages, they encountered a Prisma error:
```
Unique constraint failed on the fields: (`wa_sid`)
```

The messages were sent successfully via Twilio but were not appearing in the dashboard's message list or being saved properly in the database.

## Root Cause
The issue was caused by duplicate message creation attempts:

1. **First creation**: `sendWhatsAppMessage()` in `whatsapp.ts` sends the message via Twilio and creates a Message record with the Twilio SID
2. **Second creation**: The dashboard handler in `dashboardApi.ts` tried to create the same message again using the same Twilio SID
3. This violated the unique constraint on the `wa_sid` field

## Solution

### 1. Added Idempotency to `createOutboundMessage`
**File**: `src/db/messageService.ts`

Added idempotency checks to prevent duplicate message creation:
- Checks if a message with the given `waSid` already exists before creating
- Returns the existing message if found
- Catches race condition errors (P2002) and returns the existing message

```typescript
export async function createOutboundMessage(data: {...}): Promise<Message | null> {
  // Check if message already exists
  if (data.waSid && (await messageExists(data.waSid))) {
    console.log(`⚠️ Duplicate outbound message detected: ${data.waSid}`);
    return await prisma.message.findUnique({ where: { waSid: data.waSid } });
  }

  try {
    return await prisma.message.create({...});
  } catch (error: any) {
    // Handle race condition
    if (error.code === 'P2002' && error.meta?.target?.includes('wa_sid')) {
      return await prisma.message.findUnique({ where: { waSid: data.waSid } });
    }
    throw error;
  }
}
```

### 2. Changed Dashboard to Fetch Instead of Create
**File**: `src/server/routes/dashboard/dashboardApi.ts`

For text messages (`handleSendMessage`):
- Removed the duplicate `createOutboundMessage()` call
- Instead, polls the database to fetch the message that was already created by `sendWhatsAppMessage()`
- Uses a retry loop (up to 10 attempts, 50ms between attempts) to handle async message creation

For media messages (`handleSendMediaMessage`):
- Kept `createOutboundMessage()` but now it benefits from idempotency
- Returns existing message if already created

### 3. Updated Service Layer
**File**: `src/services/whatsapp.ts`

Added null checks after `createOutboundMessage()` calls to handle cases where message creation/retrieval might fail:
```typescript
const messageRecord = await createOutboundMessage({...});

if (!messageRecord) {
  console.error('❌ Failed to create or retrieve message record');
  throw new Error('Failed to store message');
}
```

## Benefits

1. **No More Duplicates**: Idempotency ensures each Twilio SID creates only one Message record
2. **Better Error Handling**: Gracefully handles race conditions and concurrent requests
3. **Consistent State**: Dashboard always shows messages that were successfully sent
4. **Backward Compatible**: Existing code continues to work without modification

## Testing

After deployment, verify:
1. Send a message from the dashboard
2. Confirm the message appears immediately in the message list
3. Check logs for "✅ [WhatsAppSend] Sent message" without any Prisma errors
4. Verify the message is stored in the database with the correct `wa_sid`
5. Test with both text and media messages

## Technical Notes

- The polling approach for text messages accounts for the asynchronous nature of `sendWhatsAppMessage()`
- Max 500ms total wait time (10 attempts × 50ms) ensures fast response times
- Idempotency checks occur at both DB query level and catch block level for maximum reliability
- The `wa_sid` unique constraint remains enforced at the database level as additional safety


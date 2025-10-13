# WhatsApp Send API Documentation

## Overview

The `/api/whatsapp/send` endpoint is a standalone notification API that automatically handles WhatsApp's 24-hour messaging window. It requires only a phone number and message text - no database or restaurant tracking needed. Perfect for sending notifications to restaurant owners about new orders.

curl --http1.1 -X POST "https://2eabb18cadc5.ngrok-free.app/api/whatsapp/send"\
  -H "Authorization: Bearer sufrah_bot_0f3c9e7d4b82e19a56e2a1f3d9b8c4aa" \
  -H "Content-Type: application/json" \
  -d '{"phoneNumber":"+201069956383","text":"Hello"}'


## 24-Hour Messaging Window

WhatsApp Business API enforces a 24-hour messaging window:
- **Within 24h**: You can send freeform messages to numbers that have messaged you within the last 24 hours
- **Outside 24h or first message**: You must use an approved template message

The API automatically handles this by:
1. **Always trying freeform first** - attempts to send as a regular message
2. **Auto-detecting window expiry** - if Twilio returns error 63016 (session expired), automatically retries with template
3. **Creating templates as needed** - generates the `restaurant_notification` template on first use
4. **Logging everything** - tracks all attempts in the OutboundMessage table

## Endpoint Details

### URL
```
POST /api/whatsapp/send
```

### Authentication
```
Authorization: Bearer YOUR_WHATSAPP_SEND_TOKEN
```

The token is configured via the `WHATSAPP_SEND_TOKEN` environment variable.

### Request Body

```json
{
  "phoneNumber": "+966501234567",      // Required: Recipient phone (any format)
  "text": "You have a new order!"      // Required: Message text
}
```

#### Field Descriptions

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `phoneNumber` | string | ✅ Yes | Recipient's phone number in any format (will be standardized) |
| `text` | string | ✅ Yes | Message content to send |

### Response

#### Success Response
```json
{
  "status": "ok",
  "message": "Successfully sent",
  "channel": "freeform",
  "sid": "SM..."
}
```

| Field | Description |
|-------|-------------|
| `status` | Always "ok" on success |
| `message` | Human-readable confirmation |
| `channel` | Either "freeform" or "template" indicating which method was used |
| `sid` | Twilio message SID for tracking |

#### Error Responses

**401 Unauthorized**
```json
{
  "error": "Unauthorized"
}
```

**400 Bad Request**
```json
{
  "error": "`restaurantId` is required"
}
```

**500 Internal Server Error**
```json
{
  "error": "Restaurant clxxx123... not found"
}
```

## Usage Examples

### Example 1: Basic Message (Auto-Detect Window)

```bash
curl -X POST https://your-domain.com/api/whatsapp/send \
  -H "Authorization: Bearer your_token_here" \
  -H "Content-Type: application/json" \
  -d '{
    "restaurantId": "clxxx123abc",
    "phoneNumber": "+966501234567",
    "text": "Your order #12345 is ready for pickup!"
  }'
```

**What happens:**
1. API checks conversation history for this restaurant + phone
2. If last customer message was < 24h ago → sends as **freeform**
3. If > 24h or no history → sends as **template** using `new_order_notification` template
4. Message is logged in `OutboundMessage` table

### Example 2: With Custom Template

```bash
curl -X POST https://your-domain.com/api/whatsapp/send \
  -H "Authorization: Bearer your_token_here" \
  -H "Content-Type: application/json" \
  -d '{
    "restaurantId": "clxxx123abc",
    "phoneNumber": "+966501234567",
    "text": "Your order #12345 is ready for pickup!",
    "templateSid": "HXabcdef1234567890",
    "templateName": "order_ready_custom"
  }'
```

**What happens:**
- If template is needed, uses your custom template SID instead of default
- Logs template information for analytics

### Example 3: JavaScript/TypeScript Client

```typescript
async function sendWhatsAppNotification(
  restaurantId: string,
  phoneNumber: string,
  message: string
) {
  const response = await fetch('https://your-domain.com/api/whatsapp/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.WHATSAPP_SEND_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      restaurantId,
      phoneNumber,
      text: message,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to send: ${error.error}`);
  }

  const result = await response.json();
  console.log(`Message sent via ${result.channel} channel`);
  return result;
}

// Usage
await sendWhatsAppNotification(
  'clxxx123abc',
  '+966501234567',
  'Your order is ready!'
);
```

## Database Tracking

Every message sent through this API is logged in the `OutboundMessage` table:

```sql
SELECT 
  id,
  to_phone,
  body,
  channel,           -- 'freeform' or 'template'
  template_sid,      -- Template SID if template was used
  template_name,     -- Template name for analytics
  status,            -- 'pending', 'sent', or 'failed'
  wa_sid,            -- Twilio message SID
  error_code,        -- Twilio error code if failed
  error_message,     -- Error details if failed
  metadata,          -- Full details including 24h window info
  created_at
FROM "OutboundMessage"
WHERE restaurant_id = 'clxxx123abc'
ORDER BY created_at DESC;
```

### Metadata Structure

The `metadata` JSON field contains detailed information:

```json
{
  "request": {
    "restaurantId": "clxxx123abc",
    "conversationId": "clyyy456def",
    "toPhone": "+966501234567",
    "fromPhone": "whatsapp:+14155238886",
    "initialChannel": "template",
    "source": "api"
  },
  "sessionWindow": {
    "lastInboundAt": "2025-10-07T10:30:00.000Z",
    "within24h": false
  },
  "result": {
    "channel": "template",
    "sid": "SM...",
    "sentAt": "2025-10-07T11:00:00.000Z",
    "templateSid": "HX...",
    "templateName": "new_order_notification"
  }
}
```

## Default Template

If no custom template is provided, the API uses the built-in `new_order_notification` template:

**Template Name:** `new_order_notification`  
**Body:** `You have a new order on Sufrah! {{order_text}}`

The template is automatically created if it doesn't exist. The `{{order_text}}` variable is populated with your message text.

## Error Handling & Retry Logic

The API includes smart fallback logic:

1. **Attempt 1**: Try to send as freeform (if within 24h window)
2. **If fails with error 63016** (session expired): Automatically retry with template
3. **If any other error**: Fail and log to database

All errors are logged to `OutboundMessage` table with:
- Error code
- Error message
- Timestamp
- Full error details in metadata

## Best Practices

### 1. Always Include restaurantId
```javascript
// ✅ Good
{ restaurantId: "clxxx123", phoneNumber: "+966...", text: "..." }

// ❌ Bad - will fail
{ phoneNumber: "+966...", text: "..." }
```

### 2. Handle Both Channels Gracefully
```javascript
const result = await sendMessage(...);
if (result.channel === 'template') {
  console.log('Sent via template (outside 24h window)');
} else {
  console.log('Sent as freeform message');
}
```

### 3. Validate Phone Numbers
The API validates and standardizes phone numbers, but always provide complete numbers with country code:
```javascript
// ✅ Good formats
"+966501234567"
"966501234567"
"+1234567890"

// ❌ Bad formats (may fail)
"0501234567"  // Missing country code
"12345"       // Too short
```

### 4. Check Response Channel
Monitor which channel is being used to understand your conversation patterns:
```javascript
const stats = await db.outboundMessage.groupBy({
  by: ['channel'],
  _count: true,
  where: {
    restaurantId: 'xxx',
    createdAt: { gte: startOfDay }
  }
});
// { freeform: 150, template: 30 }
```

## Schema Changes

The following fields were added to the `OutboundMessage` table:

```prisma
model OutboundMessage {
  // ... existing fields ...
  templateSid    String?       @map("template_sid")
  templateName   String?       @map("template_name")
  // ... rest of fields ...
}
```

Migration applied: `20251007110756_add_template_tracking_to_outbound_messages`

## Integration with Dashboard

The dashboard can query outbound messages to show:

**Message Analytics:**
```sql
-- Daily channel distribution
SELECT 
  DATE(created_at) as date,
  channel,
  COUNT(*) as count,
  COUNT(CASE WHEN status = 'sent' THEN 1 END) as successful,
  COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed
FROM "OutboundMessage"
WHERE restaurant_id = 'xxx'
GROUP BY DATE(created_at), channel
ORDER BY date DESC;
```

**Template Usage:**
```sql
-- Most used templates
SELECT 
  template_name,
  COUNT(*) as usage_count,
  COUNT(CASE WHEN status = 'sent' THEN 1 END) as successful
FROM "OutboundMessage"
WHERE restaurant_id = 'xxx'
  AND template_name IS NOT NULL
GROUP BY template_name
ORDER BY usage_count DESC;
```

## Troubleshooting

### Issue: Always Using Templates

**Problem:** Messages are always sent as templates even for active conversations.

**Possible Causes:**
1. No inbound messages recorded in database
2. Conversation older than 24 hours
3. Wrong `restaurantId` parameter

**Solution:** Check conversation history:
```sql
SELECT * FROM "Message"
WHERE conversation_id IN (
  SELECT id FROM "Conversation"
  WHERE restaurant_id = 'xxx' AND customer_wa = '+966...'
)
ORDER BY created_at DESC
LIMIT 10;
```

### Issue: Template Not Found

**Problem:** Error about template not existing.

**Possible Causes:**
1. Twilio Content API credentials not configured
2. Template approval pending
3. Invalid template SID

**Solution:** 
- Check `TWILIO_API_KEY` and `TWILIO_API_SECRET` env vars
- Verify template is approved in Twilio console
- Use default template by omitting `templateSid`

### Issue: Message Failing Silently

**Problem:** API returns success but message not delivered.

**Solution:** Check outbound message logs:
```sql
SELECT * FROM "OutboundMessage"
WHERE to_phone = '+966...'
  AND status = 'failed'
ORDER BY created_at DESC
LIMIT 10;
```

## Related Documentation

- [Twilio WhatsApp API Documentation](https://www.twilio.com/docs/whatsapp)
- [WhatsApp Business 24h Window](https://developers.facebook.com/docs/whatsapp/pricing#conversations)
- [Prisma Schema Reference](../prisma/schema.prisma)


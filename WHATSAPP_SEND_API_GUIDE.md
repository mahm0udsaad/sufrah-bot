# WhatsApp Send API Guide

## Overview

The WhatsApp Send API allows you to send notifications to customers via WhatsApp. The API automatically handles:
- ✅ 24-hour messaging window detection
- ✅ Automatic fallback to templates when outside the 24h window
- ✅ Queue management for reliable delivery
- ✅ Quota enforcement
- ✅ Usage tracking

---

## Endpoint

```
POST /api/whatsapp/send
GET  /api/whatsapp/send
```

**Base URL:** `https://bot.sufrah.sa`

Both GET and POST methods are supported for easier integration with external dashboards.

---

## Authentication

Use Bearer token authentication with the `WHATSAPP_SEND_TOKEN` environment variable.

**Header:**
```
Authorization: Bearer YOUR_WHATSAPP_SEND_TOKEN
```

⚠️ **Important:** The token must match the `WHATSAPP_SEND_TOKEN` configured in your bot's environment variables.

---

## Request Parameters

### Required Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `phoneNumber` | string | Recipient's phone number (any format accepted) |
| `text` | string | Message text to send |

### Optional Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `fromNumber` | string | Sender WhatsApp number (defaults to `TWILIO_WHATSAPP_FROM`) |
| `templateVariables` | object | Variables for template messages (when outside 24h window) |

---

## Phone Number Formats

The API accepts multiple phone number formats and automatically standardizes them:

✅ **Accepted Formats:**
- `+966501234567` (E.164 format)
- `966501234567` (without +)
- `whatsapp:+966501234567` (WhatsApp format)
- `0501234567` (local format - converted to Saudi +966)

**Example conversions:**
```
Input: "0501234567"    → Output: "whatsapp:+966501234567"
Input: "+966501234567" → Output: "whatsapp:+966501234567"
Input: "966501234567"  → Output: "whatsapp:+966501234567"
```

---

## Request Examples

### Example 1: Simple POST Request (JSON)

```bash
curl -X POST https://bot.sufrah.sa/api/whatsapp/send \
  -H "Authorization: Bearer your_whatsapp_send_token_here" \
  -H "Content-Type: application/json" \
  -d '{
    "phoneNumber": "+966501234567",
    "text": "Your verification code is: 123456"
  }'
```

### Example 2: POST with Custom Sender

```bash
curl -X POST https://bot.sufrah.sa/api/whatsapp/send \
  -H "Authorization: Bearer your_whatsapp_send_token_here" \
  -H "Content-Type: application/json" \
  -d '{
    "phoneNumber": "0501234567",
    "text": "Your order is ready for pickup!",
    "fromNumber": "whatsapp:+966508034010"
  }'
```

### Example 3: GET Request (Query Parameters)

```bash
curl -G https://bot.sufrah.sa/api/whatsapp/send \
  -H "Authorization: Bearer your_whatsapp_send_token_here" \
  --data-urlencode "phoneNumber=+966501234567" \
  --data-urlencode "text=Hello from Sufrah!"
```

### Example 4: POST with Template Variables

For messages sent outside the 24-hour window, the API automatically uses templates:

```bash
curl -X POST https://bot.sufrah.sa/api/whatsapp/send \
  -H "Authorization: Bearer your_whatsapp_send_token_here" \
  -H "Content-Type: application/json" \
  -d '{
    "phoneNumber": "+966501234567",
    "text": "Your order #ORDER_NUMBER is out for delivery",
    "templateVariables": {
      "order_number": "12345",
      "delivery_time": "30 minutes"
    }
  }'
```

---

## JavaScript/TypeScript Examples

### Using Fetch API

```typescript
async function sendWhatsAppNotification(phoneNumber: string, message: string) {
  const response = await fetch('https://bot.sufrah.sa/api/whatsapp/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.WHATSAPP_SEND_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      phoneNumber,
      text: message,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to send notification');
  }

  return await response.json();
}

// Usage
try {
  const result = await sendWhatsAppNotification(
    '+966501234567',
    'Your verification code is: 123456'
  );
  console.log('Message sent:', result);
} catch (error) {
  console.error('Failed to send:', error);
}
```

### Using Axios

```typescript
import axios from 'axios';

const whatsappApi = axios.create({
  baseURL: 'https://bot.sufrah.sa',
  headers: {
    'Authorization': `Bearer ${process.env.WHATSAPP_SEND_TOKEN}`,
    'Content-Type': 'application/json',
  },
});

async function sendVerificationCode(phoneNumber: string, code: string) {
  try {
    const response = await whatsappApi.post('/api/whatsapp/send', {
      phoneNumber,
      text: `Your verification code is: ${code}. Valid for 10 minutes.`,
    });
    
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error('API Error:', error.response?.data);
      throw new Error(error.response?.data?.error || 'Failed to send');
    }
    throw error;
  }
}

// Usage
await sendVerificationCode('+966501234567', '123456');
```

---

## Response Formats

### Success Response (Queued)

When the message is queued for delivery (default behavior):

```json
{
  "status": "queued",
  "message": "Message queued for delivery",
  "jobId": "12345",
  "queuePosition": "waiting"
}
```

### Success Response (Direct Send)

When sent directly (queue disabled or fallback):

```json
{
  "status": "ok",
  "message": "Successfully sent",
  "channel": "freeform",
  "sid": "SM1234567890abcdef1234567890abcdef"
}
```

**Channel types:**
- `freeform` - Sent as regular message (within 24h window)
- `template` - Sent as template message (outside 24h window)

---

## Error Responses

### 400 Bad Request - Missing Parameters

```json
{
  "error": "`phoneNumber` is required"
}
```

```json
{
  "error": "`text` is required"
}
```

```json
{
  "error": "Invalid phone number"
}
```

### 401 Unauthorized

```json
{
  "error": "Unauthorized"
}
```

**Causes:**
- Missing `Authorization` header
- Invalid or mismatched `WHATSAPP_SEND_TOKEN`

### 429 Too Many Requests - Quota Exceeded

```json
{
  "error": "Usage quota exceeded",
  "details": {
    "used": 1050,
    "limit": 1000,
    "percentage": 105,
    "message": "Your usage quota has been exceeded. Please upgrade your plan or contact support."
  }
}
```

### 500 Internal Server Error

```json
{
  "error": "Twilio client not available. Please configure TWILIO_MASTER_SID and TWILIO_MASTER_AUTH or associate the sending number with a restaurant."
}
```

### 503 Service Unavailable

```json
{
  "error": "Messaging endpoint is disabled"
}
```

**Cause:** `WHATSAPP_SEND_TOKEN` is not configured in environment variables.

---

## How It Works

### Automatic 24-Hour Window Detection

The API automatically detects whether the recipient is within the 24-hour messaging window:

1. **Within 24h window** (customer messaged you recently):
   - ✅ Sends as **freeform** message
   - ✅ Any content allowed
   - ✅ Fast delivery

2. **Outside 24h window** (no recent customer message):
   - ✅ Automatically falls back to **template** message
   - ✅ Uses pre-approved WhatsApp template
   - ✅ Variables can be substituted

**You don't need to check the window yourself - the API handles it!**

---

## Queue Management

Messages are queued by default for reliable delivery:

- **FIFO Ordering:** Messages are delivered in the order they were queued
- **Per-Conversation Queuing:** Each conversation has its own queue
- **Automatic Retry:** Failed messages are retried automatically
- **Metrics:** Queue position and job status are tracked

**Queue can be disabled** by setting `WHATSAPP_SEND_QUEUE_ENABLED=false` in environment variables.

---

## Quota Management

The API enforces usage quotas per restaurant:

- **Automatic Checking:** Quota is checked before sending
- **429 Response:** Returns quota error when limit exceeded
- **Warning Logs:** Logs warnings when usage reaches 90%
- **Tracking:** Every message is tracked for quota enforcement

---

## Best Practices

### 1. **Store Your Token Securely**

```bash
# .env file
WHATSAPP_SEND_TOKEN=your_secure_random_token_here
```

Never hardcode tokens in your source code!

### 2. **Handle Errors Gracefully**

```typescript
try {
  await sendWhatsAppNotification(phone, message);
} catch (error) {
  // Log error
  console.error('WhatsApp send failed:', error);
  
  // Notify user via alternative channel
  await sendEmail(user, 'Notification via email');
  
  // Queue for retry
  await queueForRetry({ phone, message });
}
```

### 3. **Format Phone Numbers Consistently**

Always use international format with country code:

```typescript
// Good
sendNotification('+966501234567', message);

// Also works (will be converted)
sendNotification('0501234567', message);
```

### 4. **Rate Limiting**

Implement rate limiting on your side to avoid hitting quotas:

```typescript
import { RateLimiter } from 'rate-limiter-flexible';

const limiter = new RateLimiter({
  points: 10, // 10 requests
  duration: 1, // per 1 second
});

async function sendWithRateLimit(phone: string, text: string) {
  await limiter.consume(phone); // Throws error if limit exceeded
  return sendWhatsAppNotification(phone, text);
}
```

### 5. **Monitor Quota Usage**

Check your quota regularly:

```typescript
// Recommended: Track usage percentage
if (quotaUsage.percentage >= 90) {
  console.warn('Approaching quota limit!');
  notifyAdmins('Upgrade plan or reduce usage');
}
```

---

## Configuration

### Required Environment Variables

```bash
# Backend (.env)
WHATSAPP_SEND_TOKEN=your_secure_token_here
TWILIO_WHATSAPP_FROM=whatsapp:+966508034010
TWILIO_MASTER_SID=ACxxxxxxxxxxxxxxxxxxxxx
TWILIO_MASTER_AUTH=your_twilio_auth_token

# Optional
WHATSAPP_SEND_QUEUE_ENABLED=true
```

### Dashboard/Frontend Configuration

```bash
# Frontend (.env)
NEXT_PUBLIC_WHATSAPP_SEND_TOKEN=your_secure_token_here
NEXT_PUBLIC_BOT_API_URL=https://bot.sufrah.sa
```

---

## Testing

### Test the API Endpoint

```bash
# Test with curl
curl -X POST https://bot.sufrah.sa/api/whatsapp/send \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "phoneNumber": "+966501234567",
    "text": "Test message from API"
  }'
```

### Expected Success Response

```json
{
  "status": "queued",
  "message": "Message queued for delivery",
  "jobId": "12345",
  "queuePosition": "waiting"
}
```

---

## Common Use Cases

### 1. Sending Verification Codes

```typescript
async function sendVerificationCode(phoneNumber: string) {
  const code = generateRandomCode(); // e.g., 123456
  
  await fetch('https://bot.sufrah.sa/api/whatsapp/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${WHATSAPP_SEND_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      phoneNumber,
      text: `Your verification code is: ${code}\n\nValid for 10 minutes.\n\nDo not share this code with anyone.`,
    }),
  });
  
  return code;
}
```

### 2. Order Status Updates

```typescript
async function notifyOrderStatus(
  customerPhone: string,
  orderNumber: string,
  status: string
) {
  const messages = {
    confirmed: `✅ Order #${orderNumber} confirmed! Preparing your food now.`,
    ready: `🍽️ Order #${orderNumber} is ready for pickup!`,
    delivered: `✅ Order #${orderNumber} has been delivered. Enjoy your meal!`,
  };
  
  await fetch('https://bot.sufrah.sa/api/whatsapp/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${WHATSAPP_SEND_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      phoneNumber: customerPhone,
      text: messages[status],
    }),
  });
}
```

### 3. Marketing Notifications

```typescript
async function sendPromotion(phoneNumber: string, promoCode: string) {
  await fetch('https://bot.sufrah.sa/api/whatsapp/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${WHATSAPP_SEND_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      phoneNumber,
      text: `🎉 Special offer just for you!\n\nUse code ${promoCode} for 20% off your next order.\n\nValid until end of month.`,
      templateVariables: {
        promo_code: promoCode,
        discount: '20%',
      },
    }),
  });
}
```

---

## Troubleshooting

### Issue: 401 Unauthorized

**Solution:** Check that:
1. `Authorization` header is included
2. Token matches `WHATSAPP_SEND_TOKEN` in backend `.env`
3. Token format is `Bearer YOUR_TOKEN` (not just the token)

### Issue: 503 Service Unavailable

**Solution:** 
1. Check that `WHATSAPP_SEND_TOKEN` is set in backend environment
2. Restart the bot service after setting the variable

### Issue: 500 Twilio Client Error

**Solution:**
1. Verify `TWILIO_MASTER_SID` and `TWILIO_MASTER_AUTH` are set
2. Ensure the phone number in `TWILIO_WHATSAPP_FROM` is registered in Twilio
3. Check that the sender number is associated with a restaurant in the database

### Issue: Messages Not Delivered

**Solution:**
1. Check backend logs for queue errors
2. Verify Redis is running (queue requires Redis)
3. Ensure the outbound worker is running: `bun run src/workers/outboundWorker.ts`
4. Check that recipient's phone number is correct and WhatsApp-enabled

### Issue: 400 Invalid Phone Number

**Solution:**
1. Use international format: `+966501234567`
2. Ensure phone number is valid for Saudi Arabia (or your country)
3. Don't include spaces or special characters except `+`

---

## API Limits

| Limit Type | Default Value | Configurable |
|------------|---------------|--------------|
| Max Messages Per Minute | 60 | ✅ Per restaurant |
| Max Messages Per Day | 1,000 | ✅ Per restaurant |
| Max Conversations Per Month | Varies by plan | ✅ In database |
| Queue Retry Attempts | 3 | ✅ `QUEUE_RETRY_ATTEMPTS` |
| Backoff Delay | 5 seconds | ✅ `QUEUE_BACKOFF_DELAY` |

---

## Support

### Getting Help

- 📧 Email: info@sufrah.sa
- 📖 Docs: Check `docs/` folder in repository
- 🐛 Issues: Report in GitHub repository

### Useful Log Locations

```bash
# Check API logs
docker logs sufrah-bot -f | grep "whatsapp/send"

# Check queue logs
docker logs sufrah-bot -f | grep "WhatsApp"

# Check Twilio errors
docker logs sufrah-bot -f | grep "Twilio"
```

---

## Summary

✅ **Endpoint:** `POST /api/whatsapp/send`  
✅ **Auth:** Bearer token (`WHATSAPP_SEND_TOKEN`)  
✅ **Required:** `phoneNumber`, `text`  
✅ **Optional:** `fromNumber`, `templateVariables`  
✅ **Automatic:** 24h window detection, template fallback, queueing  
✅ **Quota:** Enforced per restaurant  
✅ **Reliable:** Queue-based with retries  

**Start sending WhatsApp notifications in 2 minutes! 🚀**


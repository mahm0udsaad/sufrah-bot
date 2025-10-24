# WhatsApp Send API - Quick Reference

## 🚀 Quick Start

### Endpoint
```
POST https://bot.sufrah.sa/api/whatsapp/send
```

### Headers
```
Authorization: Bearer YOUR_WHATSAPP_SEND_TOKEN
Content-Type: application/json
```

### Minimal Request
```json
{
  "phoneNumber": "+966501234567",
  "text": "Your message here"
}
```

---

## 📋 One-Minute Setup

### 1. Get Your Token
```bash
# Backend .env
WHATSAPP_SEND_TOKEN=your_secure_token_here
```

### 2. Copy-Paste Code

**JavaScript/TypeScript:**
```typescript
const sendWhatsApp = async (phone, message) => {
  const response = await fetch('https://bot.sufrah.sa/api/whatsapp/send', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer YOUR_TOKEN_HERE',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      phoneNumber: phone,
      text: message,
    }),
  });
  return response.json();
};

// Usage
await sendWhatsApp('+966501234567', 'Hello!');
```

**cURL:**
```bash
curl -X POST https://bot.sufrah.sa/api/whatsapp/send \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"phoneNumber":"+966501234567","text":"Hello!"}'
```

**Python:**
```python
import requests

def send_whatsapp(phone, message):
    response = requests.post(
        'https://bot.sufrah.sa/api/whatsapp/send',
        headers={
            'Authorization': 'Bearer YOUR_TOKEN',
            'Content-Type': 'application/json'
        },
        json={
            'phoneNumber': phone,
            'text': message
        }
    )
    return response.json()

# Usage
send_whatsapp('+966501234567', 'Hello!')
```

---

## 📝 Common Patterns

### Verification Code
```typescript
await sendWhatsApp(phone, 
  `Your verification code is: ${code}\n` +
  `Valid for 10 minutes.\n` +
  `Do not share this code.`
);
```

### Order Update
```typescript
await sendWhatsApp(phone,
  `✅ Order #${orderNum} confirmed!\n` +
  `Estimated delivery: ${time} minutes`
);
```

### Reminder
```typescript
await sendWhatsApp(phone,
  `🔔 Reminder: Your appointment is tomorrow at ${time}`
);
```

---

## ✅ Success Response

**Queued (default):**
```json
{
  "status": "queued",
  "message": "Message queued for delivery",
  "jobId": "12345"
}
```

**Direct:**
```json
{
  "status": "ok",
  "channel": "freeform",
  "sid": "SM..."
}
```

---

## ❌ Error Responses

| Status | Error | Solution |
|--------|-------|----------|
| 401 | Unauthorized | Check token matches `WHATSAPP_SEND_TOKEN` |
| 400 | `phoneNumber` required | Include `phoneNumber` field |
| 400 | `text` required | Include `text` field |
| 400 | Invalid phone number | Use format: `+966501234567` |
| 429 | Quota exceeded | Upgrade plan or reduce usage |
| 500 | Twilio client error | Check Twilio credentials |
| 503 | Endpoint disabled | Set `WHATSAPP_SEND_TOKEN` in backend |

---

## 📞 Phone Format Examples

All these work (automatically converted):
- `+966501234567` ✅
- `966501234567` ✅
- `0501234567` ✅ (assumes +966)
- `whatsapp:+966501234567` ✅

---

## 🔧 Configuration Checklist

**Backend (.env):**
```bash
WHATSAPP_SEND_TOKEN=your_token_here          # Required
TWILIO_WHATSAPP_FROM=whatsapp:+966508034010  # Required
TWILIO_MASTER_SID=ACxxx                      # Required
TWILIO_MASTER_AUTH=your_auth_token           # Required
WHATSAPP_SEND_QUEUE_ENABLED=true             # Optional (default: true)
```

---

## 🐛 Quick Debug

### Test Connection
```bash
curl https://bot.sufrah.sa/api/whatsapp/send \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"phoneNumber":"+966501234567","text":"Test"}'
```

### Check Logs
```bash
# API logs
docker logs sufrah-bot -f | grep "whatsapp/send"

# Queue logs
docker logs sufrah-bot -f | grep "WhatsApp"
```

---

## 💡 Pro Tips

1. **Automatic 24h Window Detection**
   - No need to check window yourself
   - API handles freeform vs template automatically

2. **Queue is Your Friend**
   - Messages are queued by default
   - FIFO ordering per conversation
   - Automatic retries on failure

3. **Quota Management**
   - API checks quota before sending
   - Returns 429 if exceeded
   - Track usage via dashboard

4. **Error Handling**
   ```typescript
   try {
     await sendWhatsApp(phone, message);
   } catch (error) {
     console.error('Send failed:', error);
     // Fallback to email or retry later
   }
   ```

---

## 📚 Full Documentation

For detailed info, see: `WHATSAPP_SEND_API_GUIDE.md`

---

## 🆘 Support

- Email: info@sufrah.sa
- Docs: `docs/` folder
- API Status: Check backend logs

---

**Ready to send? Start with the minimal example above! 🎉**


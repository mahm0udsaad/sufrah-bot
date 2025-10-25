# Button Click Issue - Diagnostic and Fix Guide

## Problem Summary

When users click the "View Order Details" button in WhatsApp after receiving a template notification, **no messages are being sent** and **no webhook logs appear**.

Based on your logs:
```
✅ [Notification] Sent as template message with "View Order Details" button.
📦 [MessageCache] Created cache entry for template sufrah_new_order_alert
✅ [Notification] Message delivered via template channel
📍 Routed to restaurant: rashad
⚠️ Twilio signature validation is disabled
```

Then **complete silence** after the button click - no webhook received.

## Root Cause Analysis

The issue is that **Twilio is NOT sending webhooks when the button is clicked**. This happens because:

### 1. Webhook URL Configuration Missing in Twilio Console

When using **Twilio Content Templates with Quick Reply buttons**, webhooks are ONLY sent if:
- The WhatsApp sender number has a configured **Status Callback URL**
- OR the phone number has a configured **WhatsApp Inbound URL**

**Without these configured, button clicks are silently ignored by Twilio.**

## Solution Steps

### Step 1: Verify Webhook Configuration in Twilio Console

1. Go to [Twilio Console - WhatsApp Senders](https://console.twilio.com/us1/develop/sms/senders/whatsapp-senders)
2. Click on your WhatsApp sender (e.g., `+966508034010`)
3. Scroll to **"WhatsApp Message URL"** section
4. Ensure it's set to your webhook endpoint:
   ```
   https://your-domain.com/whatsapp/webhook
   ```
   Or:
   ```
   https://your-domain.com/webhook
   ```

5. Set HTTP Method to: **POST**

6. (Optional) Set **Status Callback URL** to:
   ```
   https://your-domain.com/whatsapp/status
   ```

### Step 2: Restart Your Server to Apply Debug Logging

I've added debug logging to your webhook handler. Restart the server:

```bash
pm2 restart whatsapp-bot
```

Or if running locally:
```bash
bun run --watch index.ts
```

### Step 3: Test Button Click Again

1. Send a test notification with the button
2. Click "View Order Details" in WhatsApp
3. Watch the logs for these new debug messages:

**If webhook IS received:**
```
🔔 [Webhook] Received POST /whatsapp/webhook from TwilioProxy/1.1
📨 [Webhook] Payload keys: From, To, Body, MessageSid, ProfileName, ButtonPayload, ButtonText
🔘 [Webhook] Button detected - ButtonPayload: view_order, ButtonText: View Order Details
🔘 [ButtonClick] User requested "View Order Details" from +201157337829
📤 [ButtonClick] Sending cached order details to +201157337829
✅ [ButtonClick] Successfully sent cached message
```

**If webhook is NOT received (current issue):**
```
(Complete silence - no logs at all)
```

### Step 4: Check Twilio Debugger for Failed Webhooks

1. Go to [Twilio Console - Debugger](https://console.twilio.com/us1/monitor/logs/debugger)
2. Look for recent errors related to your WhatsApp number
3. Look for webhook delivery failures (e.g., "No webhook URL configured")

Common error messages:
- `"No destination URI configured"` - Webhook URL not set
- `"11200: HTTP retrieval failure"` - Your server is unreachable
- `"11750: Webhook responded with status 500"` - Your code is crashing

## Alternative: Check Template Configuration

### Verify the Quick Reply Template is Active

1. Go to [Twilio Console - Content Templates](https://console.twilio.com/us1/develop/sms/content-editor)
2. Find template: `sufrah_new_order_alert`
3. Check status: Should be **"Approved"** or **"Active"**
4. Verify the quick-reply button configuration:
   ```json
   {
     "type": "twilio/quick-reply",
     "body": "You have a new order made on Sufrah! 🎉",
     "actions": [
       {
         "title": "View Order Details",
         "id": "view_order"
       }
     ]
   }
   ```

### If Template is Not Approved:
- WhatsApp templates need Meta approval for production use
- In Sandbox/Testing mode, templates should work immediately
- Button clicks only work on **approved** templates in production

## Monitoring Button Clicks

### Check PM2 Logs
```bash
pm2 logs whatsapp-bot --lines 100
```

### Check Specific Webhook Logs
```bash
pm2 logs whatsapp-bot | grep -E "(Webhook|ButtonClick)"
```

### Check MessageCache Table
Verify the cached message exists:
```sql
SELECT 
  "id",
  "toPhone",
  "messageText",
  "delivered",
  "deliveredAt",
  "expiresAt",
  "createdAt"
FROM "MessageCache"
WHERE "toPhone" = 'whatsapp:+201157337829'  -- Replace with actual number
ORDER BY "createdAt" DESC
LIMIT 5;
```

Expected result:
- One row with `delivered = false`
- `expiresAt` should be in the future (48 hours from `createdAt`)
- `messageText` should contain the order details

## Troubleshooting Scenarios

### Scenario A: No Webhook Logs After Button Click

**Diagnosis**: Twilio webhook URL not configured

**Fix**:
1. Configure webhook URL in Twilio Console (Step 1 above)
2. Save and wait 1-2 minutes for propagation
3. Test button click again

### Scenario B: Webhook Received But No Message Sent

**Logs show**:
```
🔘 [ButtonClick] User requested "View Order Details"
⚠️ [ButtonClick] No cached message found for +201157337829
```

**Diagnosis**: MessageCache entry expired or missing

**Fix**:
1. Check MessageCache table (SQL query above)
2. If expired, send a fresh notification to create new cache entry
3. Click button within 48 hours of notification

### Scenario C: Webhook Received But Wrong Button ID

**Logs show**:
```
🔘 [Webhook] Button detected - ButtonPayload: some_other_id, ButtonText: Some Other Text
```

**Diagnosis**: Template has different button configuration

**Fix**:
1. Verify template in Twilio Console
2. Ensure button `id` is exactly: `view_order`
3. Ensure button `title` is: `View Order Details`
4. Update template if needed and wait for approval

### Scenario D: Error When Sending Cached Message

**Logs show**:
```
🔘 [ButtonClick] User requested "View Order Details"
📤 [ButtonClick] Sending cached order details
❌ [ButtonClick] Failed to send cached message: error 63016
```

**Diagnosis**: 24-hour session window expired again

**Fix**: This shouldn't happen because button clicks open a 24-hour window. If it does:
1. Check if `forceFreeform: true` is set in the `sendNotification` call (line 227 in inboundHandler.ts)
2. Verify it's using freeform channel, not template

## Testing Checklist

Run through this checklist to confirm the fix:

- [ ] Webhook URL configured in Twilio Console for your WhatsApp number
- [ ] Server restarted to enable debug logging
- [ ] Template `sufrah_new_order_alert` is approved/active
- [ ] Send test notification with button
- [ ] Check logs show: `✅ [Notification] Sent as template message`
- [ ] Check logs show: `📦 [MessageCache] Created cache entry`
- [ ] Click "View Order Details" button in WhatsApp
- [ ] Check logs show: `🔔 [Webhook] Received POST`
- [ ] Check logs show: `🔘 [Webhook] Button detected`
- [ ] Check logs show: `✅ [ButtonClick] Successfully sent cached message`
- [ ] User receives order details message in WhatsApp
- [ ] Verify MessageCache row is marked `delivered = true`

## Quick Diagnostic Commands

```bash
# Watch logs in real-time
pm2 logs whatsapp-bot --raw

# Filter for webhook activity only
pm2 logs whatsapp-bot --lines 200 | grep -E "(Webhook|ButtonClick|MessageCache)"

# Check if server is running
pm2 status

# Restart server
pm2 restart whatsapp-bot

# Check environment variables
pm2 show whatsapp-bot | grep "env"
```

## Need More Help?

If the issue persists:

1. **Capture full webhook payload**: Add this to your logs:
   ```typescript
   console.log('📨 [Webhook] Full payload:', JSON.stringify(payload, null, 2));
   ```

2. **Check Twilio webhook logs**: Visit [Twilio Debugger](https://console.twilio.com/us1/monitor/logs/debugger)

3. **Verify your public URL is accessible**: 
   ```bash
   curl -X POST https://your-domain.com/whatsapp/webhook \
     -H "Content-Type: application/x-www-form-urlencoded" \
     -d "From=whatsapp:+123456789&To=whatsapp:+966508034010&Body=test"
   ```

4. **Check if signature validation is blocking webhooks**: Your logs show it's disabled, but verify in `inboundHandler.ts`

## Summary

**Most Likely Issue**: Webhook URL not configured in Twilio Console for your WhatsApp sender number.

**Most Likely Fix**: 
1. Go to Twilio Console → WhatsApp Senders → (Your Number) → Set "WhatsApp Message URL" to your webhook endpoint
2. Restart your server
3. Test button click again

The debug logging I added will confirm whether webhooks are being received or not.


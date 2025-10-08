# WhatsApp Template Cache Fix - Implementation Summary

## 🐛 Issues Identified

### Issue #1: Phone Number Normalization Mismatch
**Problem:** 
- When SAVING cached messages: used `standardizeWhatsappNumber()` → `+201129177895` 
- When RETRIEVING cached messages: used `normalizePhoneNumber()` → `201129177895` (no `+`)
- Result: Database lookups failed because formats didn't match

**Impact:** 
- Button clicks couldn't find cached messages
- Users received "Sorry, order details are no longer available" instead of their order details
- Additional template messages were sent unnecessarily

### Issue #2: Subsequent Messages Not Updating Cache
**Problem:**
- When a second order arrived before user clicked the button, the cache wasn't updated
- `setCachedMessageOnTemplate(..., onlyIfMissing=true)` prevented overwriting existing cache
- Result: Users got the FIRST order details even when clicking after a SECOND order arrived

### Issue #3: Button Click Handler Sending Templates
**Problem:**
- When cached message not found (due to Issue #1), fallback called `sendNotification()`
- `sendNotification()` checks 24h window and sends template if outside window
- Result: Users received multiple templates instead of simple text responses

## ✅ Fixes Applied

### Fix #1: Standardized Phone Number Format
**Files Changed:** `src/services/whatsapp.ts`

**Functions Updated:**
1. `getCachedMessageForPhone()` - Line 897
   - Changed from `normalizePhoneNumber()` to `standardizeWhatsappNumber()`
   - Added debug logging to show lookup process

2. `findRecentTemplateSince()` - Line 956
   - Changed from `normalizePhoneNumber()` to `standardizeWhatsappNumber()`
   - Ensures consistent format when checking for recent templates

**Result:** Database lookups now use consistent `+XXXXXXXXXXX` format

### Fix #2: Always Update Cache with Latest Message
**Files Changed:** `src/services/whatsapp.ts`

**Location:** Line 1134
```typescript
// Before:
await setCachedMessageOnTemplate(recentTemplate.id, standardizedRecipient, trimmedText, true);

// After:
await setCachedMessageOnTemplate(recentTemplate.id, standardizedRecipient, trimmedText, false);
```

**Result:** Second/third orders now overwrite cached message, users always get the latest order details

### Fix #3: Direct Freeform Sending on Button Click
**Files Changed:** `index.ts`

**Locations Updated:**
1. Twilio Webhook Handler - Lines 1933-1947
2. Meta Webhook Handler - Lines 2063-2074

**Changes:**
```typescript
// Before:
await sendNotification(from, cachedMessage, { fromNumber: to });

// After:
await sendTextMessage(client, to, from, cachedMessage);
```

**Result:** 
- Button clicks send direct freeform messages (no 24h window check)
- No additional templates sent
- Faster response, cleaner user experience

### Fix #4: Enhanced Logging
**Files Changed:** `src/services/whatsapp.ts`

**Added Logs:**
- `checkMessageWindow()` - Shows normalization and lookup process
- `getCachedMessageForPhone()` - Shows standardization and found records
- `setCachedMessageOnTemplate()` - Shows cache update/skip decisions
- All cache operations now show message preview (first 50-80 chars)

## 🔄 Flow After Fixes

### Scenario 1: First Order (Customer Never Messaged)
```
1. API receives order notification for +201234567890
2. checkMessageWindow() → No inbound messages found
3. sendNotification() → channel = 'template'
4. findRecentTemplateSince() → No recent templates found
5. Send template with "View Order Details" button
6. Cache message in metadata.cachedMessage.text
7. Save to OutboundMessage table with toPhone="+201234567890"
```

### Scenario 2: Second Order (Before Button Click)
```
1. API receives another order for same customer
2. checkMessageWindow() → Still no inbound messages
3. sendNotification() → channel = 'template'
4. findRecentTemplateSince() → FINDS previous template ✅
5. setCachedMessageOnTemplate(..., false) → UPDATES cache with new order ✅
6. Return existing template SID (no new template sent)
```

### Scenario 3: Button Click
```
1. Twilio/Meta sends button payload: "view_order"
2. Extract from = "201234567890" (no + prefix)
3. consumeCachedMessageForPhone("201234567890")
   → standardizeWhatsappNumber() → "+201234567890" ✅
   → Find OutboundMessage where toPhone="+201234567890" ✅
   → Extract metadata.cachedMessage.text ✅
4. sendTextMessage() directly (no template, no 24h check) ✅
5. Mark cache as delivered in metadata
6. Customer receives latest order details!
```

## 📊 Database Schema

### OutboundMessage Table Structure
```typescript
{
  id: string             // Primary key
  toPhone: string        // Format: "+201234567890" (standardized)
  fromPhone: string      // Sender number
  channel: string        // "freeform" | "template"
  templateName: string   // "sufrah_new_order_alert"
  templateSid: string    // Twilio content SID
  status: string         // "pending" | "sent" | "failed"
  body: string          // Cached message (fallback)
  metadata: {
    cachedMessage: {
      text: string            // Full order details
      cachedAt: string        // ISO timestamp
      purpose: string         // "view_order_details_response"
      delivered?: boolean     // Marked when button clicked
      deliveredAt?: string    // ISO timestamp of delivery
    }
  }
  createdAt: DateTime
}
```

## 🧪 Testing Recommendations

### Test Case 1: Basic Flow
1. Send order notification via `/api/whatsapp/send`
2. Verify template sent with button
3. Click "View Order Details" button
4. Verify cached message received as freeform text

### Test Case 2: Multiple Orders
1. Send first order notification
2. Send second order notification (within 1 minute)
3. Verify no second template sent (logs show cache update)
4. Click button
5. Verify SECOND order details received (not first)

### Test Case 3: Phone Number Formats
Test with various formats to ensure normalization works:
- `+201234567890`
- `201234567890`
- `whatsapp:+201234567890`
- All should work identically

### Test Case 4: Missing Cache
1. Manually delete cached message from database
2. Click button
3. Verify fallback message sent as freeform (not template)

## 📝 Verification Logs

After fixes, successful flow should show:
```
📦 [Cache] Looking up cached message for 201129177895 (standardized: +201129177895)
📦 [Cache] Found template record for +201129177895 { hasMetadata: true, hasBody: true }
✅ [Cache] Retrieved cached message from metadata for +201129177895: "طلب جديد من منصة سفرة..."
🔘 [ButtonClick] User requested "View Order Details" from 201129177895
📤 [ButtonClick] Sending cached order details to 201129177895
✅ [ButtonClick] Successfully sent cached message to 201129177895
```

## 🚀 Deployment Notes

1. No database migrations required (using existing OutboundMessage table)
2. No environment variables changed
3. Backward compatible with existing cached messages
4. Safe to deploy immediately

## 📌 Key Functions Reference

- `standardizeWhatsappNumber()` - Ensures `+` prefix format
- `normalizePhoneNumber()` - Removes `+` prefix (use for Message table lookups only)
- `getCachedMessageForPhone()` - Retrieves latest cached message
- `setCachedMessageOnTemplate()` - Updates cache on existing template
- `findRecentTemplateSince()` - Finds template sent after a timestamp
- `consumeCachedMessageForPhone()` - Retrieves and marks cache as delivered
- `sendNotification()` - Main API endpoint handler with 24h window logic


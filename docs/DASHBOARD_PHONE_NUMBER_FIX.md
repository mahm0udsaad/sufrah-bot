# Dashboard Phone Number Format Fix

## Issue
The dashboard is storing phone numbers **without the `+` prefix** in both:
- `RestaurantProfile.whatsapp_number` → `966502045939`
- `RestaurantBot.whatsappNumber` → `966502045939`

This causes routing issues because Twilio webhooks send `whatsapp:+966502045939` (with `+`).

## Current State
```javascript
// What dashboard stores now:
{
  whatsappNumber: "966502045939"  // No + prefix
}
```

## What We Fixed (Bot Side)
✅ Our bot now handles **both formats** automatically:
- Tries `+966502045939` first
- Falls back to `966502045939` if not found
- Works regardless of dashboard format

## Recommendation for Dashboard

### Option 1: Store WITH + Prefix (Recommended)
Update your onboarding/admin forms to **always add `+` prefix**:

```typescript
// When saving phone number
const normalizedPhone = phone.startsWith('+') ? phone : `+${phone}`;

await prisma.restaurant.update({
  where: { id: restaurantId },
  data: {
    whatsappNumber: normalizedPhone  // +966502045939
  }
});

await prisma.restaurantBot.update({
  where: { id: botId },
  data: {
    whatsappNumber: normalizedPhone  // +966502045939
  }
});
```

### Option 2: Keep Current Format (No Change Needed)
✅ Our bot handles both formats, so you can keep storing without `+`
- No dashboard changes required
- Bot routing works automatically

## Testing After Fix

### Test 1: Send Message to Ocean Restaurant
```bash
# From WhatsApp, send "hey" to +966502045939
# Expected: Bot responds with welcome message
```

### Test 2: Check Logs
```bash
pm2 logs bun-api --lines 20
# Should see: "📍 Routed to restaurant: Ocean Restaurant Bot"
# Should NOT see: "⚠️ No restaurant found for WhatsApp number"
```

### Test 3: Verify Dashboard Display
```bash
curl 'https://bot.sufrah.sa/api/admin/bots/cmgtzdhz00001kjue7jha87eu' | jq '.whatsappNumber'
# Current: "966502045939"
# After fix: "+966502045939" (if you implement Option 1)
```

## Migration Script (Optional)

If you want to normalize existing records to use `+` prefix:

```sql
-- Update RestaurantBot table
UPDATE "RestaurantBot"
SET "whatsappFrom" = '+' || "whatsappFrom"
WHERE "whatsappFrom" NOT LIKE '+%'
  AND "whatsappFrom" NOT LIKE 'whatsapp:%';

-- Update RestaurantProfile table  
UPDATE "RestaurantProfile"
SET whatsapp_number = '+' || whatsapp_number
WHERE whatsapp_number NOT LIKE '+%'
  AND whatsapp_number IS NOT NULL;
```

## Summary

**Current Status**: ✅ **Working** (bot handles both formats)

**Recommended**: Add `+` prefix when storing numbers for consistency

**Required**: ❌ **No changes required** - bot is already fixed to handle both formats

## Example Code for Dashboard

### Onboarding Link Sender
```typescript
// app/api/onboarding/link-sender/route.ts

export async function POST(req: Request) {
  const { restaurantId, senderId } = await req.json();
  
  // Get sender details
  const sender = await fetch(`https://bot.sufrah.sa/api/admin/bots/${senderId}`).then(r => r.json());
  
  // Normalize phone number (add + if missing)
  const normalizedPhone = sender.whatsappNumber.startsWith('+') 
    ? sender.whatsappNumber 
    : `+${sender.whatsappNumber}`;
  
  // Update restaurant profile
  await prisma.restaurant.update({
    where: { id: restaurantId },
    data: {
      whatsappNumber: normalizedPhone  // Always store with +
    }
  });
  
  // Link bot to restaurant
  await fetch(`https://bot.sufrah.sa/api/admin/bots/${senderId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ restaurantId })
  });
}
```

### Admin Bot Form
```typescript
// components/BotForm.tsx

function BotForm({ onSubmit }) {
  const handleSubmit = (formData) => {
    // Normalize phone number
    const phone = formData.whatsappNumber;
    const normalized = phone.startsWith('+') ? phone : `+${phone}`;
    
    onSubmit({
      ...formData,
      whatsappNumber: normalized
    });
  };
  
  return (
    <form onSubmit={handleSubmit}>
      <input
        name="whatsappNumber"
        placeholder="+966502045939"
        // Accept both formats, normalize on submit
      />
    </form>
  );
}
```

## Contact

Questions? Check `docs/PHONE_NUMBER_FORMATS.md` for detailed format specifications.


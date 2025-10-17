# Ocean Restaurant WhatsApp Bot Integration

## Overview
Ocean Restaurant has a custom welcome flow that promotes their mobile app while maintaining the standard bot ordering functionality.

## Flow Summary

### 1. First-Time User Experience
When a new customer messages Ocean Restaurant (`+966502045939`):

1. **Welcome Template** (Quick Replies)
   - Sends standard welcome with buttons:
     - 🆕 طلب جديد (New Order)
     - 🚚 تتبع الطلب (Track Order)
     - ☎️ تواصل مع الدعم (Contact Support)

2. **App Promo List Picker** (Immediately after)
   - Message: Ocean promo with special offers
   - Button: "اختر نوع الجهاز" (Choose device type)
   - Options:
     - 📱 iPhone
     - 📱 Android

### 2. User Selects Device
When user clicks iPhone or Android:
- Sends the appropriate app store link
- Thanks the user

### 3. Continue with Bot Flow
After welcome sequence, user can:
- Click "طلب جديد" to start ordering
- Use normal bot commands
- Browse menu, select items, checkout

## Technical Details

### Merchant ID
```
Ocean Restaurant Merchant ID: 2a065243-3b03-41b9-806b-571cfea27ea8
```

### App Links
- **iPhone**: `https://apps.apple.com/us/app/%D8%B4%D8%A7%D9%88%D8%B1%D9%85%D8%A7-%D8%A3%D9%88%D8%B4%D9%86/id6753905053?platform=iphone`
- **Android**: `https://play.google.com/store/apps/details?id=com.sufrah.shawarma_ocean_app&pcampaignid=web_share`

### Promo Message
```
مرحباً بكم في مطعم شاورما أوشن 🌊

استمتعوا بعرضنا الخاص عند الطلب من التطبيق فقط:
✨ خصم 10% على طلبك
🚗 توصيل مجاني لجميع الطلبات

احصل على عرضك الآن من خلال تحميل التطبيق:
```

## Code References

### Welcome Flow
```typescript
// src/handlers/processMessage.ts:183-293
export async function sendWelcomeTemplate(...)
```
- Line 198-200: Detects Ocean Restaurant
- Line 261-272: Sends normal welcome + Ocean promo

### Ocean Promo Function
```typescript
// src/handlers/processMessage.ts:295-358
async function sendOceanPromo(...)
```
- Creates Twilio list picker content
- Fallback to text if content creation fails

### App Link Handler
```typescript
// src/handlers/processMessage.ts:878-898
// Handles ocean_app_iphone and ocean_app_android selections
```

## Restaurant Context Resolution

Ocean Restaurant uses a linked bot architecture:
1. Incoming message to `+966502045939` (bot's WhatsApp number)
2. Bot lookup finds `RestaurantBot` record
3. Resolves to `RestaurantProfile` with `externalMerchantId`
4. Loads Sufrah menu/branches for ordering

```typescript
// src/handlers/processMessage.ts:537-595
export async function resolveRestaurantContext(...)
```

## Testing

### Test Welcome Flow
1. Delete conversation history with `+966502045939`
2. Send "hey" or any message
3. Expect:
   - Welcome template with quick replies
   - Ocean promo with iPhone/Android picker

### Test App Link Selection
1. Click "📱 iPhone" from list picker
2. Expect: iPhone app store link
3. Or click "📱 Android"
4. Expect: Android Play Store link

### Test Normal Bot Flow
1. After welcome, click "🆕 طلب جديد"
2. Select pickup or delivery
3. Browse menu categories
4. Add items to cart
5. Complete checkout

## Deployment

No special deployment steps required. The Ocean-specific logic is:
- Keyed by merchant ID
- Active only for Ocean Restaurant
- Falls back gracefully if content creation fails
- Other restaurants get standard welcome flow

## Logs

Successful Ocean welcome:
```
ℹ️ Resolved restaurant context from bot cmgtzdhz00001kjue7jha87eu → profile cmgu0bkzi0008saom2sg3qy63 → merchant 2a065243-3b03-41b9-806b-571cfea27ea8
✅ Ocean promo with app selector sent to 201157337829
📱 Welcome message sent to new user: 201157337829
```

App link selection:
```
🔍 DEBUG: Processing message from 201157337829: "ocean_app_iphone" (type: interactive)
✅ Text message sent: SM...
```


# Dashboard API Implementation - Complete

## Summary

The API has been completely restructured to match the exact specifications provided by the dashboard developer. All endpoints now use the correct URL patterns, accept `tenantId` as a query parameter, and return data in the exact format expected by the dashboard.

## Changes Made

### 1. New API Endpoints Created

Two new files have been created that implement all required dashboard endpoints:

- **`src/server/routes/dashboard/dashboardApi.ts`** - Core endpoints (Overview, Orders, Conversations)
- **`src/server/routes/dashboard/dashboardApiExtended.ts`** - Extended endpoints (Templates, Ratings, Logs, Catalog, Settings, Usage, Bot Management, Notifications)

### 2. Response Format

All new endpoints return responses in the exact format specified:

```json
{
  "success": true,
  "data": {
    // Actual response data
  }
}
```

Error responses:

```json
{
  "success": false,
  "error": "Error message"
}
```

### 3. Authentication

All endpoints now support `tenantId` as a query parameter:

```
GET /api/dashboard/overview?tenantId=bot_xyz789
```

The `tenantId` is the RestaurantBot ID which is automatically resolved to the actual Restaurant ID internally.

## Implemented Endpoints

### Dashboard Overview

**GET** `/api/dashboard/overview?tenantId={tenantId}&locale={locale}&currency={currency}`

Returns comprehensive dashboard metrics including:
- Active conversations
- Pending orders
- SLA breaches
- Quota usage
- Activity timeline (last 7 days)
- Top templates
- Rating trends

### Orders

**GET** `/api/orders?tenantId={tenantId}&limit={limit}&offset={offset}&status={status}&locale={locale}&currency={currency}`

Returns paginated list of orders with full details.

**GET** `/api/orders/stats?tenantId={tenantId}&days={days}&locale={locale}`

Returns order statistics including total orders, revenue, and average order value.

**POST** `/api/orders/:orderId/status`

Updates order status. Request body:
```json
{
  "status": "CONFIRMED|PREPARING|OUT_FOR_DELIVERY|DELIVERED|CANCELLED",
  "tenantId": "bot_xyz789"
}
```

### Conversations

**GET** `/api/conversations?tenantId={tenantId}&limit={limit}&offset={offset}`

Returns list of active conversations.

**GET** `/api/conversations/:conversationId/messages?tenantId={tenantId}&limit={limit}`

Returns messages for a specific conversation.

**POST** `/api/conversations/:conversationId/messages`

Sends a message. Request body:
```json
{
  "tenantId": "bot_xyz789",
  "content": "Message text",
  "messageType": "text"
}
```

**POST** `/api/conversations/:conversationId/toggle-bot`

Toggles bot for a conversation. Request body:
```json
{
  "enabled": true|false
}
```

### Templates

**GET** `/api/templates?tenantId={tenantId}&status={status}&category={category}&locale={locale}`

Returns list of WhatsApp templates.

**POST** `/api/templates`

Creates a new template. Request body:
```json
{
  "tenantId": "bot_xyz789",
  "name": "template_name",
  "category": "MARKETING|UTILITY|ORDER_STATUS",
  "language": "ar",
  "body_text": "Template body with {{variables}}",
  "footer_text": "Optional footer",
  "variables": ["variable1", "variable2"]
}
```

**PATCH** `/api/templates/:templateId`

Updates a template.

**DELETE** `/api/templates/:templateId?tenantId={tenantId}`

Deletes a template.

### Ratings & Reviews

**GET** `/api/ratings?tenantId={tenantId}&days={days}&locale={locale}`

Returns rating analytics including NPS, distribution, and segments.

**GET** `/api/ratings/timeline?tenantId={tenantId}&days={days}&locale={locale}`

Returns rating trend over time.

**GET** `/api/ratings/reviews?tenantId={tenantId}&limit={limit}&offset={offset}&minRating={minRating}&withComments={boolean}&locale={locale}`

Returns list of reviews with filtering options.

### Logs

**GET** `/api/logs/webhook?tenantId={tenantId}&limit={limit}&path={path}&status={status}`

Returns webhook logs.

**GET** `/api/logs/outbound?tenantId={tenantId}&limit={limit}&status={status}`

Returns outbound message logs.

### Catalog

**GET** `/api/catalog?tenantId={tenantId}&locale={locale}`

Returns catalog data (categories, branches, items).

### Restaurant Settings

**GET** `/api/restaurant/profile?tenantId={tenantId}`

Returns restaurant profile and settings.

**PATCH** `/api/restaurant/settings`

Updates restaurant settings. Request body:
```json
{
  "restaurantId": "rest_abc123",
  "settings": {
    "autoReply": {
      "welcomeMessage": true,
      "orderConfirmations": true,
      "deliveryUpdates": true
    }
  }
}
```

### WhatsApp Onboarding

**GET** `/api/onboarding/whatsapp?restaurantId={restaurantId}`

Returns WhatsApp bot status and configuration.

### Usage & Plans

**GET** `/api/usage?tenantId={tenantId}`

Returns current usage, plan details, daily usage history, and available plans.

### Bot Management

**GET** `/api/bot-management?tenantId={tenantId}`

Returns bot management data including status, limits, and configuration.

**POST** `/api/bot-management/toggle`

Toggles bot activation. Request body:
```json
{
  "isActive": true|false
}
```

**PATCH** `/api/bot-management/limits`

Updates rate limits. Request body:
```json
{
  "maxMessagesPerMin": 60,
  "maxMessagesPerDay": 10000
}
```

### Notifications

**GET** `/api/notifications?tenantId={tenantId}&limit={limit}`

Returns notifications list.

**POST** `/api/notifications/read`

Marks notifications as read. Request body:
```json
{
  "notificationIds": ["notif_123", "notif_456"]
}
```

## Data Structure Mappings

### Order Structure

The API returns orders with the following structure:

```json
{
  "id": "order_abc123",
  "orderReference": "ORD-2024-001",
  "customerId": "customer_xyz",
  "customerName": "أحمد محمد",
  "customerPhone": "+966501234567",
  "status": "PREPARING",
  "statusDisplay": "قيد التحضير",
  "itemCount": 3,
  "subtotal": 8500,
  "deliveryFee": 0,
  "tax": 0,
  "total": 8500,
  "totalFormatted": "85.00 ر.س",
  "currency": "SAR",
  "createdAt": "2024-01-20T14:30:00Z",
  "updatedAt": "2024-01-20T14:35:00Z",
  "createdAtRelative": "منذ 5 دقائق",
  "items": [...],
  "deliveryAddress": "...",
  "notes": "",
  "paymentMethod": "cash",
  "paymentStatus": "pending",
  "alerts": {
    "isLate": false,
    "awaitingPayment": true,
    "requiresReview": false
  }
}
```

### Conversation Structure

```json
{
  "id": "conv_abc123",
  "customer_phone": "+966501234567",
  "customer_name": "أحمد محمد",
  "last_message_at": "2024-01-20T14:35:00Z",
  "last_message_preview": "شكراً على الطلب",
  "unread_count": 2,
  "is_bot_active": true,
  "status": "active",
  "created_at": "2024-01-15T10:00:00Z"
}
```

### Message Structure

```json
{
  "id": "msg_xyz789",
  "conversation_id": "conv_abc123",
  "from_phone": "+966501234567",
  "to_phone": "+966509876543",
  "message_type": "text",
  "content": "مرحباً، أريد طلب برجر",
  "media_url": null,
  "timestamp": "2024-01-20T14:30:00Z",
  "is_from_customer": true,
  "status": "delivered",
  "read_at": "2024-01-20T14:30:05Z",
  "content_sid": "HX1234567890abcdef",
  "variables": {"customer_name": "أحمد"},
  "template_preview": {
    "sid": "HX1234567890abcdef",
    "friendlyName": "welcome_message",
    "language": "ar",
    "body": "مرحباً {{customer_name}}!",
    "contentType": "twilio/text",
    "buttons": []
  }
}
```

## Integration Notes

### 1. Backward Compatibility

The old dashboard endpoints have been preserved for backward compatibility. They are still accessible under their original paths:

- `/api/tenants/:id/overview` (legacy)
- `/api/orders/live` (legacy)
- `/api/conversations/summary` (legacy)
- etc.

The new endpoints are prioritized in the routing, so they will be matched first.

### 2. Field Name Consistency

The new API uses the exact field names specified by the dashboard developer:
- Snake_case for some fields (e.g., `customer_phone`, `last_message_at`)
- CamelCase for others (following the spec exactly)
- All monetary values in cents (e.g., `totalCents`)

### 3. Locale Support

All endpoints support optional `locale` parameter:
- `locale=en` - English
- `locale=ar` - Arabic

Text responses are localized based on this parameter.

### 4. Currency Formatting

Monetary values are returned as:
- Integer value in cents: `8500` = 85.00 SAR
- Formatted string: `"85.00 ر.س"`
- Currency code: `"SAR"`

### 5. Pagination

All list endpoints support pagination:
- `limit` - Number of items per page (default 20, max varies by endpoint)
- `offset` - Number of items to skip (default 0)
- Response includes `pagination` object with `total`, `hasMore`, etc.

## Testing

To test the new endpoints, use the following curl commands:

### Test Dashboard Overview
```bash
curl "http://localhost:3000/api/dashboard/overview?tenantId=bot_xyz789&locale=en&currency=SAR"
```

### Test Orders List
```bash
curl "http://localhost:3000/api/orders?tenantId=bot_xyz789&limit=20&offset=0&locale=en"
```

### Test Conversations
```bash
curl "http://localhost:3000/api/conversations?tenantId=bot_xyz789&limit=20"
```

### Test Templates
```bash
curl "http://localhost:3000/api/templates?tenantId=bot_xyz789&locale=ar"
```

### Test Ratings
```bash
curl "http://localhost:3000/api/ratings?tenantId=bot_xyz789&days=30&locale=ar"
```

## Next Steps

1. ✅ All endpoints implemented
2. ✅ Response formats match specifications
3. ✅ Authentication with tenantId query parameter
4. ✅ Linter errors fixed
5. ⚠️  **TODO**: Implement WebSocket support for real-time chat updates
6. ⚠️  **TODO**: Add media upload support for `/api/conversations/:id/media` endpoint
7. ⚠️  **TODO**: Implement actual Twilio template integration for template management

## File Structure

```
src/server/routes/dashboard/
├── dashboardApi.ts          # Core endpoints (NEW)
├── dashboardApiExtended.ts  # Extended endpoints (NEW)
├── conversations.ts          # Legacy endpoint (kept)
├── orders.ts                 # Legacy endpoint (kept)
├── ratings.ts                # Legacy endpoint (kept)
├── logs.ts                   # Legacy endpoint (kept)
├── catalog.ts                # Legacy endpoint (kept)
├── templates.ts              # Legacy endpoint (kept)
├── settings.ts               # Legacy endpoint (kept)
├── notifications.ts          # Legacy endpoint (kept)
├── onboarding.ts             # Legacy endpoint (kept)
├── admin.ts                  # Legacy endpoint (kept)
└── health.ts                 # Legacy endpoint (kept)
```

## Summary of Changes

- ✅ Created `/api/dashboard/overview` endpoint
- ✅ Created `/api/orders` endpoints (list, stats, status update)
- ✅ Created `/api/conversations` endpoints (list, messages, send, toggle-bot)
- ✅ Created `/api/templates` endpoints (list, create, update, delete)
- ✅ Created `/api/ratings` endpoints (analytics, timeline, reviews)
- ✅ Created `/api/logs` endpoints (webhook, outbound)
- ✅ Created `/api/catalog` endpoint
- ✅ Created `/api/restaurant` endpoints (profile, settings)
- ✅ Created `/api/onboarding/whatsapp` endpoint
- ✅ Created `/api/usage` endpoint
- ✅ Created `/api/bot-management` endpoints (get, toggle, limits)
- ✅ Created `/api/notifications` endpoints (list, mark as read)
- ✅ All endpoints accept `tenantId` as query parameter
- ✅ All responses use `{ success: true, data: {...} }` format
- ✅ Field names match dashboard developer specifications exactly
- ✅ Zero linter errors

The API is now fully compliant with the dashboard developer's requirements!

---

## 📱 WhatsApp Send API

For sending WhatsApp notifications (verification codes, order updates, etc.), use the dedicated WhatsApp Send API.

### Quick Reference

**Endpoint:** `POST /api/whatsapp/send`

**Headers:**
```
Authorization: Bearer YOUR_WHATSAPP_SEND_TOKEN
Content-Type: application/json
```

**Body:**
```json
{
  "phoneNumber": "+966501234567",
  "text": "Your verification code is: 123456"
}
```

### Features

✅ Automatic 24h window detection  
✅ Template fallback when outside window  
✅ Queue-based reliable delivery  
✅ Quota enforcement  
✅ Usage tracking  

### Documentation

- **Full Guide:** `WHATSAPP_SEND_API_GUIDE.md` - Complete documentation with examples
- **Quick Reference:** `WHATSAPP_SEND_QUICK_REFERENCE.md` - Copy-paste code snippets

### Common Use Cases

1. **Verification Codes** - Send OTP codes during user registration/login
2. **Order Updates** - Notify customers about order status changes
3. **Reminders** - Send appointment or booking reminders
4. **Marketing** - Send promotional messages (template-based)

### Example: Send Verification Code

```typescript
async function sendVerificationCode(phoneNumber: string, code: string) {
  const response = await fetch('https://bot.sufrah.sa/api/whatsapp/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.WHATSAPP_SEND_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      phoneNumber,
      text: `Your verification code is: ${code}\n\nValid for 10 minutes.\n\nDo not share this code.`,
    }),
  });

  if (!response.ok) {
    throw new Error('Failed to send verification code');
  }

  return await response.json();
}
```

**See the dedicated guides for complete documentation and more examples!**


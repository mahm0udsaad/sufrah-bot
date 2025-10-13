# Dashboard Database Schema Guide

**Date:** October 12, 2025  
**Purpose:** Guide for the dashboard AI agent to correctly integrate with the updated bot backend database

---

## Summary of Recent Updates

We've made critical fixes to ensure the dashboard receives real-time updates and can correctly read all data:

1. ✅ **WebSocket Bridge Fixed** - Redis events now properly broadcast to WebSocket clients
2. ✅ **File Table Added** - Support for media file tracking
3. ✅ **Order Items Tracking** - Orders now save individual items to display in dashboard
4. ✅ **Real-time Events** - Messages, conversations, and orders publish to Redis → WebSocket
5. ✅ **Message Persistence** - All messages (inbound/outbound) save to `Message` table for chat history

---

## Database Schema Overview

### Core Tables You'll Use

#### 1. **Message** Table (Chat History)
All messages (inbound and outbound, including media) are stored here.

```typescript
interface Message {
  id: string;                    // CUID
  restaurantId: string;          // Foreign key to Restaurant
  conversationId: string;        // Foreign key to Conversation
  direction: 'IN' | 'OUT';       // Message direction
  waSid: string | null;          // WhatsApp/Twilio message SID (unique)
  messageType: string;           // 'text', 'image', 'video', 'document', 'audio', 'location', 'interactive', 'button'
  content: string;               // Message text body
  mediaUrl: string | null;       // URL to media file (if applicable)
  metadata: Json | null;         // Additional data (fromPhone, toPhone, location coords, etc.)
  createdAt: Date;               // Message timestamp
}
```

**Key Points:**
- `mediaUrl` stores the URL for images, videos, documents, audio files
- `messageType` indicates the type of content
- `metadata` contains extra info like phone numbers, location coordinates, button payloads
- Query by `conversationId` to get chat history
- **Both manual messages from dashboard and bot messages are saved here**

#### 2. **Conversation** Table
Each customer-restaurant conversation thread.

```typescript
interface Conversation {
  id: string;                    // CUID
  restaurantId: string;          // Foreign key to Restaurant
  customerWa: string;            // Customer WhatsApp number (normalized)
  customerName: string | null;   // Customer display name
  status: 'active' | 'closed';   // Conversation status
  lastMessageAt: Date;           // Timestamp of last message
  unreadCount: number;           // Number of unread messages (default: 0)
  isBotActive: boolean;          // Whether bot automation is enabled (default: true)
  createdAt: Date;
  updatedAt: Date;
}
```

**Unique Constraint:** `(restaurantId, customerWa)` - One conversation per customer per restaurant

**Key Points:**
- `unreadCount` increments on new inbound messages, resets when dashboard marks as read
- `isBotActive` can be toggled via API to pause/resume bot for specific conversations
- `lastMessageAt` used for sorting conversations (most recent first)

#### 3. **Order** Table
Customer orders with metadata and status tracking.

```typescript
interface Order {
  id: string;                    // CUID
  restaurantId: string;          // Foreign key to Restaurant
  conversationId: string;        // Foreign key to Conversation
  status: OrderStatus;           // 'DRAFT' | 'CONFIRMED' | 'PREPARING' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'CANCELLED'
  statusStage: number;           // Internal stage counter (default: 0)
  orderReference: string | null; // Sufrah order number (unique)
  orderType: string | null;      // 'Delivery', 'Takeaway', 'DineIn', 'FromCar'
  paymentMethod: string | null;  // 'Cash', 'Online'
  totalCents: number;            // Total amount in cents (default: 0)
  currency: string;              // Currency code (default: 'SAR')
  deliveryAddress: string | null;// Full delivery address
  deliveryLat: string | null;    // Latitude for delivery
  deliveryLng: string | null;    // Longitude for delivery
  branchId: string | null;       // Sufrah branch ID
  branchName: string | null;     // Branch display name
  branchAddress: string | null;  // Branch address
  rating: number | null;         // Customer rating (1-5)
  ratingComment: string | null;  // Customer rating comment
  ratedAt: Date | null;          // When rating was submitted
  ratingAskedAt: Date | null;    // When rating prompt was sent
  meta: Json | null;             // Extra data (payment links, Sufrah response, etc.)
  createdAt: Date;
  updatedAt: Date;
}
```

**Key Points:**
- `totalCents` stores amount in cents (divide by 100 for display: `5000` → `50.00 SAR`)
- `meta` contains:
  - `orderNumber`: Sufrah order number
  - `paymentLink`: Online payment URL (if applicable)
  - `paymentUpdate`: Payment status webhook data
  - `sufrahResponse`: Full API response from Sufrah
- `status` is updated by payment webhooks and manual updates

#### 4. **OrderItem** Table
Individual items within each order (NEW - now properly saved!)

```typescript
interface OrderItem {
  id: string;                    // Custom ID: `${orderId}-${productId}`
  orderId: string;               // Foreign key to Order
  name: string;                  // Item name
  qty: number;                   // Quantity ordered
  unitCents: number;             // Price per unit in cents
  totalCents: number;            // Total price (qty × unit + addons) in cents
}
```

**Key Points:**
- **Now properly saved when orders are created!**
- Query by `orderId` to get all items in an order
- Prices in cents (divide by 100 for display)
- Includes addon prices in `totalCents`

#### 5. **File** Table (NEW!)
Track uploaded media files (for dashboard media messages).

```typescript
interface File {
  id: string;                    // CUID
  userId: string | null;         // Foreign key to User (optional)
  fileName: string;              // Original filename
  mimeType: string;              // MIME type (e.g., 'image/jpeg', 'application/pdf')
  fileSize: number;              // File size in bytes
  url: string;                   // Public URL to access the file
  bucket: string | null;         // Storage bucket name (if using S3/R2)
  objectKey: string | null;      // Object key in storage (if using S3/R2)
  createdAt: Date;
  updatedAt: Date;
}
```

**Usage:**
- When restaurant uploads media via dashboard, create a File record
- Store the file in your storage (e.g., Cloudflare R2, S3)
- Use the `File.url` when calling `/api/conversations/:id/send-media`

#### 6. **Restaurant** Table
Restaurant profiles (multi-tenant).

```typescript
interface Restaurant {
  id: string;                    // Custom ID
  userId: string;                // Foreign key to User (unique)
  name: string;                  // Restaurant name
  description: string | null;
  address: string | null;
  phone: string | null;
  whatsappNumber: string | null; // WhatsApp Business number
  logoUrl: string | null;
  isActive: boolean;             // Whether restaurant is active (default: true)
  twilioAccountSid: string | null;
  twilioAuthToken: string | null;
  status: OnboardingStatus;      // 'PENDING_APPROVAL' | 'ACTIVE' | 'REJECTED'
  externalMerchantId: string | null; // Sufrah merchant ID
  createdAt: Date;
  updatedAt: Date;
}
```

**Key Points:**
- Each restaurant has their own Twilio credentials (multi-tenant)
- `status` controls onboarding approval flow
- `externalMerchantId` links to Sufrah for order submission

---

## Real-Time WebSocket Events

The dashboard should connect to: `wss://bot.sufrah.sa/ws`

### Events You'll Receive

#### 1. Connection Events
```typescript
{ type: "connection", data: "connected" }
{ type: "conversation.bootstrap", data: Conversation[] }
{ type: "bot.status", data: { enabled: boolean } }
```

#### 2. Message Events
```typescript
{
  type: "message.created",
  data: {
    id: string;
    conversationId: string;
    fromPhone: string;
    content: string;
    messageType: string;
    direction: 'IN' | 'OUT';
    createdAt: Date;
    mediaUrl?: string;
  }
}
```

#### 3. Conversation Events
```typescript
{
  type: "conversation.updated",
  data: {
    id: string;
    customerPhone: string;
    customerName: string;
    unreadCount: number;
    lastMessageAt: Date;
    isBotActive: boolean;
    status: string;
  }
}
```

#### 4. Order Events (NEW!)
```typescript
{
  type: "order.created" | "order.updated",
  data: {
    order: {
      id: string;
      orderReference: string;
      status: string;
      orderType: string;
      paymentMethod: string;
      totalCents: number;
      currency: string;
      createdAt: Date;
      items: OrderItem[];
    }
  }
}
```

---

## API Endpoints for Dashboard

### Chat & Messaging

#### Get Conversations
```http
GET /api/conversations
Response: Conversation[]
```

#### Get Messages for Conversation
```http
GET /api/conversations/:conversationId/messages
Response: Message[]
```
- Replace `:conversationId` with the customer's WhatsApp number or conversation ID

#### Send Text Message
```http
POST /api/conversations/:conversationId/send
Content-Type: application/json

{
  "message": "Hello customer!"
}

Response: { message: Message }
```

#### Send Media Message (Images, Documents, etc.)
```http
POST /api/conversations/:conversationId/send-media
Content-Type: application/json

{
  "mediaUrl": "https://your-cdn.com/image.jpg",  // Or "mediaUrls": ["url1", "url2"]
  "caption": "Optional caption",
  "mediaType": "image"  // 'image' | 'document' | 'video' | 'audio'
}

Response: { message: Message }
```

**Important Notes:**
- Dashboard must upload files to your own storage first
- Then send the public URL via this endpoint
- Bot will forward the media via Twilio to customer
- **Message is automatically saved to database** ✅

#### Toggle Bot for Conversation
```http
POST /api/conversations/:conversationId/toggle-bot
Content-Type: application/json

{
  "enabled": false  // Pause bot for this conversation
}

Response: { success: true, isBotActive: boolean }
```

### Orders

#### Get Orders for Restaurant
```sql
-- Query via Prisma/SQL
SELECT * FROM "Order" 
WHERE "restaurant_id" = $restaurantId 
ORDER BY "created_at" DESC
```

#### Get Order with Items
```sql
-- Query via Prisma
const order = await prisma.order.findUnique({
  where: { id: orderId },
  include: { items: true }
});
```

### Bot Control

#### Global Bot Toggle
```http
POST /api/bot/toggle
Content-Type: application/json

{
  "enabled": false  // Stop bot globally
}

Response: { enabled: boolean }
```

---

## Important Implementation Notes

### 1. Message History
- **All messages are now saved to the `Message` table**, including:
  - Inbound messages from customers
  - Outbound messages from bot
  - **Manual messages sent from dashboard** ✅
  - Media messages (images, documents, videos, audio)

- To display chat history:
```typescript
const messages = await prisma.message.findMany({
  where: { conversationId },
  orderBy: { createdAt: 'asc' },
  take: 100
});
```

### 2. Media Support
- `Message.mediaUrl` contains the file URL
- `Message.messageType` indicates type: `'image'`, `'document'`, `'video'`, `'audio'`
- Display media inline based on type
- For dashboard uploads:
  1. Upload to your storage (Cloudflare R2, S3, etc.)
  2. Create a `File` record (optional, for tracking)
  3. Send via `/api/conversations/:id/send-media` with the URL

### 3. Order Display
- **Order items are now saved** ✅
- Display format:
```typescript
// Price formatting
const displayTotal = (order.totalCents / 100).toFixed(2); // "50.00"
const displayCurrency = order.currency; // "SAR"

// Item display
order.items.forEach(item => {
  const itemPrice = (item.unitCents / 100).toFixed(2);
  const itemTotal = (item.totalCents / 100).toFixed(2);
  console.log(`${item.name} × ${item.qty} - ${itemTotal} ${order.currency}`);
});
```

- Payment status from webhook:
```typescript
const paymentUpdate = order.meta?.paymentUpdate;
if (paymentUpdate) {
  console.log(`Payment Status: ${paymentUpdate.paymentStatus}`);
  console.log(`Order Status: ${paymentUpdate.status}`);
}
```

### 4. Real-Time Updates
- **WebSocket now works!** ✅
- The Redis → WebSocket bridge is active
- Subscribe to all events and update UI accordingly
- Use optimistic updates when user sends messages
- Confirm with WebSocket event for consistency

### 5. Multi-Tenancy
- Always filter by `restaurantId` when querying data
- Get `restaurantId` from authenticated user's session:
```typescript
const restaurant = await prisma.restaurant.findUnique({
  where: { userId: session.user.id }
});

// Then use restaurant.id in all queries
const conversations = await prisma.conversation.findMany({
  where: { restaurantId: restaurant.id }
});
```

---

## Database Migration Applied

Migration: `20251012184426_add_file_table_and_fix_usage_log`

**Changes:**
1. Added `File` table for media tracking
2. Fixed `UsageLog.id` to auto-generate with `@default(cuid())`
3. Order items now properly save when orders are created

**To regenerate TypeScript types:**
```bash
bunx prisma generate
```

---

## Testing Checklist

### WebSocket Testing
- [ ] Connect to `wss://bot.sufrah.sa/ws`
- [ ] Receive `connection` event on open
- [ ] Receive `conversation.bootstrap` with conversation list
- [ ] Send test message from customer → Receive `message.created` event
- [ ] Place test order → Receive `order.created` event

### Message Testing
- [ ] Load conversation → Display all messages (IN and OUT)
- [ ] Send text message from dashboard → Appears in chat immediately
- [ ] Upload image → Send via media endpoint → Displays in chat
- [ ] Refresh page → All messages still visible (persisted to DB)

### Order Testing
- [ ] View orders list with correct totals
- [ ] Click order → See all order items with quantities and prices
- [ ] Receive payment webhook → Order status updates in real-time
- [ ] Display payment link if `paymentMethod === 'Online'`

---

## Common Issues & Solutions

### Issue: Messages don't appear after page refresh
**Solution:** Query the `Message` table directly, not just in-memory state
```typescript
const messages = await prisma.message.findMany({
  where: { conversationId },
  orderBy: { createdAt: 'asc' }
});
```

### Issue: Order items are empty
**Solution:** Use `include: { items: true }` when fetching orders
```typescript
const order = await prisma.order.findUnique({
  where: { id },
  include: { items: true }
});
```

### Issue: WebSocket not receiving events
**Solution:** Ensure:
1. Bot server is running (`bun run index.ts`)
2. Redis is connected
3. WebSocket connection is established before events fire
4. Check browser console for connection errors

### Issue: Media URLs not loading
**Solution:** 
1. Ensure URLs are publicly accessible
2. Check CORS headers on your storage
3. Use HTTPS URLs, not HTTP
4. Verify URL is saved to `Message.mediaUrl`

---

## Example Queries

### Get Recent Conversations with Last Message
```typescript
const conversations = await prisma.conversation.findMany({
  where: { restaurantId },
  include: {
    messages: {
      orderBy: { createdAt: 'desc' },
      take: 1
    }
  },
  orderBy: { lastMessageAt: 'desc' },
  take: 50
});
```

### Get Orders with Items and Conversation
```typescript
const orders = await prisma.order.findMany({
  where: { restaurantId },
  include: {
    items: true,
    conversation: true
  },
  orderBy: { createdAt: 'desc' },
  take: 50
});
```

### Search Conversations by Customer
```typescript
const conversations = await prisma.conversation.findMany({
  where: {
    restaurantId,
    OR: [
      { customerWa: { contains: searchTerm } },
      { customerName: { contains: searchTerm, mode: 'insensitive' } }
    ]
  }
});
```

---

## Summary for Dashboard Agent

**Key Takeaways:**
1. ✅ All messages (including dashboard-sent ones) are saved to `Message` table
2. ✅ Order items are now saved to `OrderItem` table  
3. ✅ WebSocket events work in real-time (Redis → WebSocket bridge is active)
4. ✅ Media messages supported via `mediaUrl` field
5. ✅ Use provided API endpoints for sending messages and media
6. ✅ Query database directly for persistent data (don't rely only on WebSocket)
7. ✅ Filter everything by `restaurantId` for multi-tenancy

**Always:**
- Use `include: { items: true }` when fetching orders
- Convert cents to currency display (`totalCents / 100`)
- Handle both IN and OUT message directions in chat UI
- Support all `messageType` values: text, image, document, video, audio, location

---

**Backend is ready! The schema is aligned and properly tracking all data.** 🚀


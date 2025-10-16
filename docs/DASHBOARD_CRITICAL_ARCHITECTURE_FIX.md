# 🚨 CRITICAL: Dashboard Architecture Fix Required

## Executive Summary

**PROBLEM**: The dashboard is currently reading data from an **in-memory cache** instead of the **database**. This causes:
1. ❌ All conversations/messages disappear when the server restarts
2. ❌ Bot stops responding to customers after conversations go stale
3. ❌ Each new sender/bot doesn't show isolated conversations
4. ❌ Data appears to be "lost" but it's actually in the database

**SOLUTION**: Switch to **database-backed REST APIs** for data fetching, use WebSocket **only** for real-time updates.

---

## 🔴 The Problem Explained

### Current (BROKEN) Architecture

```
┌──────────────┐
│   Dashboard  │
└──────┬───────┘
       │
       │ WebSocket Bootstrap
       │ GET /api/conversations (in-memory)
       ▼
┌──────────────────────────┐
│  In-Memory Cache (Map)   │ ◄─── CLEARED ON RESTART!
│  - conversations         │
│  - messages              │
└──────────────────────────┘
       │
       │ Data is saved here
       ▼
┌──────────────────────────┐
│  PostgreSQL Database     │ ◄─── DATA IS SAFE HERE
│  - Conversation table    │
│  - Message table         │
└──────────────────────────┘
```

**What happens:**
1. Bot receives WhatsApp messages
2. Messages are saved to **database** ✅
3. Messages are also cached in **memory** (Map) ✅
4. Dashboard connects via WebSocket
5. Dashboard receives data from **memory cache** ❌
6. Server restarts (`pm2 restart all`)
7. Memory cache is **CLEARED** ❌
8. Dashboard shows **NOTHING** ❌
9. Database still has **ALL DATA** but dashboard can't see it! ❌

### Why Bot Stops Responding

The bot logic checks in-memory conversation state to determine if a conversation exists and what state it's in. After restart:
- Memory is cleared
- Bot thinks there's no conversation
- Bot doesn't respond until new conversation is created
- Old conversations are "orphaned"

---

## ✅ The Solution

### New (CORRECT) Architecture

```
┌──────────────┐
│   Dashboard  │
└──────┬───────┘
       │
       │ 1. Initial Load: REST API → Database
       │    GET /api/db/conversations
       │    GET /api/db/conversations/:id/messages
       │
       │ 2. Real-time Updates: WebSocket
       │    (only for NEW messages/updates)
       ▼
┌──────────────────────────┐
│  PostgreSQL Database     │ ◄─── SOURCE OF TRUTH
│  - Conversation table    │
│  - Message table         │
│  - RestaurantBot table   │
└──────────────────────────┘
```

**Correct Flow:**
1. Dashboard loads → Fetch from **database** via REST API ✅
2. Show all historical data ✅
3. Keep WebSocket open for **real-time updates only** ✅
4. Server restarts → Dashboard refetches from database ✅
5. No data loss ✅

---

## 📡 New Database-Backed API Endpoints

All new endpoints are under `/api/db/*`

### Authentication

All requests require:
```
Authorization: Bearer YOUR_DASHBOARD_PAT
X-Restaurant-Id: restaurant_id
```

Get these from environment variables or config.

### 1. List Conversations

**Endpoint:** `GET /api/db/conversations`

**Query Parameters:**
- `status` (optional): `active` or `closed`
- `limit` (optional): number of conversations, default 50
- `offset` (optional): pagination offset, default 0

**Example Request:**
```bash
curl -X GET 'https://bot.sufrah.sa/api/db/conversations?status=active&limit=20' \
  -H 'Authorization: Bearer YOUR_PAT' \
  -H 'X-Restaurant-Id: rest_123'
```

**Response:**
```json
[
  {
    "id": "clxxx123",
    "restaurantId": "rest_123",
    "customerPhone": "whatsapp:+966501234567",
    "customerName": "Ahmed Ali",
    "status": "active",
    "lastMessageAt": "2025-10-16T10:30:00.000Z",
    "unreadCount": 3,
    "isBotActive": true,
    "createdAt": "2025-10-15T08:00:00.000Z",
    "updatedAt": "2025-10-16T10:30:00.000Z"
  }
]
```

### 2. Get Conversation Messages

**Endpoint:** `GET /api/db/conversations/:conversationId/messages`

**Query Parameters:**
- `limit` (optional): number of messages, default 100
- `offset` (optional): pagination offset, default 0

**Example Request:**
```bash
curl -X GET 'https://bot.sufrah.sa/api/db/conversations/clxxx123/messages' \
  -H 'Authorization: Bearer YOUR_PAT' \
  -H 'X-Restaurant-Id: rest_123'
```

**Response:**
```json
[
  {
    "id": "msg_001",
    "conversationId": "clxxx123",
    "restaurantId": "rest_123",
    "direction": "IN",
    "messageType": "text",
    "content": "مرحبا، أريد طلب طعام",
    "mediaUrl": null,
    "waSid": "WAxxxx",
    "createdAt": "2025-10-16T10:30:00.000Z",
    "metadata": {
      "fromPhone": "whatsapp:+966501234567",
      "toPhone": "whatsapp:+966508034010"
    }
  },
  {
    "id": "msg_002",
    "conversationId": "clxxx123",
    "restaurantId": "rest_123",
    "direction": "OUT",
    "messageType": "text",
    "content": "مرحباً! كيف يمكنني مساعدتك؟",
    "mediaUrl": null,
    "waSid": "WAyyyy",
    "createdAt": "2025-10-16T10:30:05.000Z",
    "metadata": {
      "fromPhone": "whatsapp:+966508034010",
      "toPhone": "whatsapp:+966501234567"
    }
  }
]
```

### 3. Get Conversation Stats

**Endpoint:** `GET /api/db/conversations/stats`

**Response:**
```json
{
  "totalConversations": 150,
  "activeConversations": 42,
  "totalUnread": 18
}
```

### 4. Get Specific Conversation

**Endpoint:** `GET /api/db/conversations/:conversationId`

**Response:** Single conversation object

### 5. List Bots for Restaurant

**Endpoint:** `GET /api/db/restaurants/:restaurantId/bots`

**Response:**
```json
[
  {
    "id": "bot_001",
    "name": "Sufrah Bot",
    "restaurantName": "Sufrah",
    "whatsappNumber": "whatsapp:+966508034010",
    "status": "ACTIVE",
    "isActive": true,
    "createdAt": "2025-10-01T00:00:00.000Z",
    "updatedAt": "2025-10-16T00:00:00.000Z"
  }
]
```

---

## 🔧 Implementation Guide for Dashboard

### Step 1: Create API Service

Create `services/conversationsDb.ts`:

```typescript
const API_BASE = 'https://bot.sufrah.sa/api/db';
const DASHBOARD_PAT = process.env.NEXT_PUBLIC_DASHBOARD_PAT;
const RESTAURANT_ID = 'your_restaurant_id'; // Get from auth/context

interface Conversation {
  id: string;
  restaurantId: string;
  customerPhone: string;
  customerName: string | null;
  status: 'active' | 'closed';
  lastMessageAt: string;
  unreadCount: number;
  isBotActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface Message {
  id: string;
  conversationId: string;
  restaurantId: string;
  direction: 'IN' | 'OUT';
  messageType: string;
  content: string;
  mediaUrl: string | null;
  waSid: string | null;
  createdAt: string;
  metadata?: any;
}

async function fetchWithAuth(url: string) {
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${DASHBOARD_PAT}`,
      'X-Restaurant-Id': RESTAURANT_ID,
    },
  });
  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }
  return response.json();
}

export async function getConversations(
  status?: 'active' | 'closed',
  limit = 50
): Promise<Conversation[]> {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  params.set('limit', String(limit));
  
  return fetchWithAuth(`${API_BASE}/conversations?${params}`);
}

export async function getConversationMessages(
  conversationId: string,
  limit = 100
): Promise<Message[]> {
  return fetchWithAuth(
    `${API_BASE}/conversations/${conversationId}/messages?limit=${limit}`
  );
}

export async function getConversationStats() {
  return fetchWithAuth(`${API_BASE}/conversations/stats`);
}

export async function getRestaurantBots(restaurantId: string) {
  return fetchWithAuth(`${API_BASE}/restaurants/${restaurantId}/bots`);
}
```

### Step 2: Update Dashboard Component

**BEFORE (WRONG):**
```typescript
// ❌ DON'T DO THIS - reads from in-memory cache
useEffect(() => {
  socket.on('conversation.bootstrap', (data) => {
    setConversations(data); // This is in-memory cache!
  });
}, []);
```

**AFTER (CORRECT):**
```typescript
// ✅ DO THIS - reads from database
import { getConversations, getConversationMessages } from './services/conversationsDb';

function Dashboard() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);

  // 1. Load initial data from DATABASE
  useEffect(() => {
    async function loadData() {
      try {
        const data = await getConversations('active');
        setConversations(data);
      } catch (error) {
        console.error('Failed to load conversations:', error);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  // 2. Connect WebSocket for REAL-TIME UPDATES ONLY
  useEffect(() => {
    const socket = new WebSocket('wss://bot.sufrah.sa/ws');

    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);

      // Handle real-time updates
      switch (message.type) {
        case 'message.created':
          // Add new message to existing conversation
          handleNewMessage(message.data);
          break;

        case 'conversation.updated':
          // Update conversation in list
          handleConversationUpdate(message.data);
          break;

        // IGNORE bootstrap - we already have data from DB
        case 'conversation.bootstrap':
          console.log('Ignoring bootstrap, using DB data');
          break;
      }
    };

    return () => socket.close();
  }, []);

  // Helper to handle new messages
  function handleNewMessage(message: Message) {
    // Update the specific conversation with new message
    // Optionally fetch latest messages for that conversation
  }

  function handleConversationUpdate(conversation: Conversation) {
    setConversations(prev =>
      prev.map(c => c.id === conversation.id ? conversation : c)
    );
  }

  return (
    <div>
      {loading ? (
        <LoadingSpinner />
      ) : (
        <ConversationList conversations={conversations} />
      )}
    </div>
  );
}
```

### Step 3: Handle Server Restarts Gracefully

```typescript
useEffect(() => {
  const socket = new WebSocket('wss://bot.sufrah.sa/ws');

  socket.onclose = () => {
    console.log('WebSocket closed, refetching data from DB...');
    // Refetch from database when connection closes
    getConversations('active').then(setConversations);
  };

  // Reconnect logic
  let reconnectInterval: NodeJS.Timeout;
  socket.onerror = () => {
    reconnectInterval = setInterval(() => {
      console.log('Attempting to reconnect...');
      // Try to reconnect and refetch data
    }, 5000);
  };

  return () => {
    socket.close();
    clearInterval(reconnectInterval);
  };
}, []);
```

### Step 4: Multi-Tenancy Support

Each restaurant/sender should see ONLY their conversations:

```typescript
// Get restaurant ID from authentication context
const { restaurantId } = useAuth();

// Pass restaurant ID in header
const headers = {
  'Authorization': `Bearer ${DASHBOARD_PAT}`,
  'X-Restaurant-Id': restaurantId, // Critical for multi-tenancy
};

// API automatically filters conversations by restaurant ID
const conversations = await getConversations('active');
// Returns ONLY conversations for this restaurant
```

**For Admin Dashboard (All Senders):**
```typescript
// Get all restaurants/bots first
const bots = await fetch('/api/admin/bots').then(r => r.json());

// For each bot, fetch its conversations
const allConversations = await Promise.all(
  bots.map(bot =>
    fetch(`/api/db/conversations`, {
      headers: {
        'Authorization': `Bearer ${DASHBOARD_PAT}`,
        'X-Restaurant-Id': bot.restaurantId,
      },
    }).then(r => r.json())
  )
);

// Group conversations by bot/restaurant
const conversationsByBot = allConversations.reduce((acc, convs, idx) => {
  acc[bots[idx].id] = convs;
  return acc;
}, {});
```

---

## 🐛 Fixing the Bot Responsiveness Issue

The bot stops responding because it checks in-memory state. We need to ensure the bot also checks the database for existing conversations.

**Location:** `src/handlers/processMessage.ts` or `src/webhooks/inboundHandler.ts`

**Issue:** Bot relies on in-memory conversation state
**Fix:** Always check database first

```typescript
// BEFORE (in processMessage.ts)
let conversation = getConversationById(customerPhone); // ❌ in-memory only

// AFTER
let conversation = await findOrCreateConversation(restaurantId, customerPhone);
// ✅ This checks database, creates if not exists
```

The backend code already saves to database, we just need to ensure it READS from database too when processing messages.

---

## 📋 Migration Checklist

### Backend Changes ✅ (Already Done)
- [x] Created `/api/db/conversations` endpoint
- [x] Created `/api/db/conversations/:id/messages` endpoint
- [x] Created `/api/db/conversations/stats` endpoint
- [x] Added database-backed conversation service
- [x] Added authentication/authorization
- [x] Added multi-tenancy support (restaurant filtering)

### Dashboard Changes ⏳ (You Need to Do)
- [ ] Create `services/conversationsDb.ts` API service
- [ ] Update conversation list component to use database API
- [ ] Update message list component to use database API
- [ ] Change WebSocket usage to real-time updates only
- [ ] Remove dependency on `conversation.bootstrap` event
- [ ] Add loading states for initial data fetch
- [ ] Add error handling for API failures
- [ ] Add reconnection logic for WebSocket
- [ ] Test with server restarts
- [ ] Test with multiple restaurants/senders
- [ ] Add pagination for large conversation lists
- [ ] Add search/filter functionality

### Testing
- [ ] Load dashboard → should show all conversations from database
- [ ] Restart server (`pm2 restart all`)
- [ ] Reload dashboard → should still show all conversations
- [ ] Send new WhatsApp message → should appear in real-time via WebSocket
- [ ] Switch between different restaurants → should show isolated conversations
- [ ] Check bot responds to old conversations after restart

---

## 🔑 Key Principles

### 1. Database is Source of Truth
```
Database = Long-term storage (persists across restarts)
Memory Cache = Short-term performance optimization
WebSocket = Real-time delivery mechanism
```

### 2. Data Flow
```
WhatsApp Message
  → Save to Database (permanent)
  → Update Memory Cache (temporary, for performance)
  → Broadcast via WebSocket (real-time delivery)
  
Dashboard Load
  → Fetch from Database (shows all historical data)
  → Connect to WebSocket (receives new updates)
```

### 3. Multi-Tenancy
```
Each Restaurant/Bot = Isolated namespace
  - Has own conversations
  - Has own messages
  - Has own customers
  
Admin Dashboard = Can see all restaurants
  - Requires special permissions
  - Fetches data for each restaurant separately
```

---

## 🚀 Next Steps

1. **Immediate** (Dashboard Developer):
   - Implement database-backed API calls
   - Update WebSocket usage
   - Test thoroughly with server restarts

2. **Short-term**:
   - Add pagination for large datasets
   - Add search/filter functionality
   - Add real-time status indicators

3. **Long-term**:
   - Consider adding Redis cache layer for performance
   - Add analytics/reporting based on database queries
   - Implement conversation archiving

---

## 📞 Testing the New APIs

### Test 1: List Conversations
```bash
curl -X GET 'https://bot.sufrah.sa/api/db/conversations' \
  -H 'Authorization: Bearer YOUR_PAT' \
  -H 'X-Restaurant-Id: YOUR_RESTAURANT_ID'
```

Expected: Returns all conversations from database

### Test 2: Get Messages
```bash
curl -X GET 'https://bot.sufrah.sa/api/db/conversations/CONV_ID/messages' \
  -H 'Authorization: Bearer YOUR_PAT' \
  -H 'X-Restaurant-Id: YOUR_RESTAURANT_ID'
```

Expected: Returns all messages for that conversation

### Test 3: Restart Server
```bash
# In VPS
pm2 restart all

# Then test API again - should still return data
curl -X GET 'https://bot.sufrah.sa/api/db/conversations' \
  -H 'Authorization: Bearer YOUR_PAT' \
  -H 'X-Restaurant-Id: YOUR_RESTAURANT_ID'
```

Expected: ✅ Data still there (from database)

### Test 4: Old Test (Broken)
```bash
curl -X GET 'https://bot.sufrah.sa/api/conversations'
# ❌ This returns empty after restart (in-memory cache cleared)
```

---

## 💡 FAQ

**Q: Should we stop using WebSocket?**
A: No! Keep WebSocket for real-time updates. Just don't use it as the primary data source.

**Q: What about performance?**
A: Database queries with proper indexes are very fast. For very high traffic, add Redis cache layer later.

**Q: Do we need to migrate existing data?**
A: No! Data is already in the database. You just need to READ from it.

**Q: What about the old `/api/conversations` endpoint?**
A: Keep it for backward compatibility, but dashboard should use `/api/db/conversations` instead.

**Q: How do we handle multiple restaurants?**
A: Use `X-Restaurant-Id` header. Each restaurant sees only their data. Admin can fetch for multiple restaurants.

**Q: What if database is slow?**
A: Add pagination, lazy loading, and proper indexes. Consider Redis cache for hot data.

---

## 🎯 Success Criteria

Your dashboard implementation is correct when:

✅ Dashboard shows all conversations after server restart
✅ Historical messages are visible
✅ New messages appear in real-time
✅ Each restaurant sees only their conversations
✅ Bot responds to old conversations after restart
✅ No data loss on `pm2 restart all`
✅ Multiple senders work independently

---

## 📚 Related Documentation

- `ADMIN_BOT_REGISTRATION_GUIDE.md` - How to register new senders
- `DASHBOARD_DATABASE_SCHEMA_GUIDE.md` - Database schema reference
- `DASHBOARD_INTEGRATION.md` - General dashboard integration guide

---

## ⚠️ Common Mistakes to Avoid

1. ❌ Using `conversation.bootstrap` as primary data source
2. ❌ Relying on in-memory cache for initial load
3. ❌ Not passing `X-Restaurant-Id` header
4. ❌ Fetching data on every WebSocket message
5. ❌ Not handling server reconnection
6. ❌ Mixing database and cache data inconsistently

---

## 🏆 Best Practices

1. ✅ Always fetch initial data from database
2. ✅ Use WebSocket only for incremental updates
3. ✅ Add proper error handling and retry logic
4. ✅ Show loading states during data fetch
5. ✅ Implement pagination for large datasets
6. ✅ Cache restaurant ID in auth context
7. ✅ Add proper TypeScript types
8. ✅ Test with server restarts frequently

---

**Questions?** Check the backend code or ask for clarification.


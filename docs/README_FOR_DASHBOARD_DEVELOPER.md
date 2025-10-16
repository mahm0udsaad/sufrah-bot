# 📖 Dashboard Developer Guide

## 🚨 CRITICAL: Read This First

Your dashboard has a **critical bug** that causes all conversations and messages to disappear when the server restarts. This document explains the problem and provides step-by-step instructions to fix it.

---

## 📋 Table of Contents

1. [The Problem](#the-problem)
2. [What You Need to Do](#what-you-need-to-do)
3. [New API Endpoints](#new-api-endpoints)
4. [Implementation Guide](#implementation-guide)
5. [Bot Registration UI](#bot-registration-ui)
6. [Testing](#testing)
7. [FAQ](#faq)

---

## 🔴 The Problem

### Current Behavior (BROKEN)
1. Dashboard loads → Shows conversations ✅
2. Server restarts (`pm2 restart all`) 
3. Dashboard reloads → Shows NOTHING ❌
4. Data appears "lost" but it's actually in the database

### Why This Happens

Your dashboard is reading from an **in-memory cache** that gets cleared on restart:

```javascript
// ❌ WRONG - This is what you're currently doing
useEffect(() => {
  socket.on('conversation.bootstrap', (data) => {
    setConversations(data); // This data is from memory, not database!
  });
}, []);
```

When server restarts:
- In-memory cache is cleared
- WebSocket sends empty `conversation.bootstrap`
- Dashboard shows nothing
- **BUT**: All data is safe in PostgreSQL database!

---

## ✅ What You Need to Do

### Part 1: Fix Data Persistence (HIGH PRIORITY)

**Goal**: Make dashboard read from database instead of memory

**Steps**:
1. Read `DASHBOARD_CRITICAL_ARCHITECTURE_FIX.md` (detailed guide)
2. Create API service that uses new `/api/db/*` endpoints
3. Update dashboard to fetch from database on load
4. Use WebSocket only for real-time updates
5. Test with server restart

**Time Estimate**: 2-4 hours
**Impact**: Critical - Fixes data loss bug

### Part 2: Build Bot Registration UI (MEDIUM PRIORITY)

**Goal**: Allow admin to register new WhatsApp senders via UI

**Steps**:
1. Read `ADMIN_BOT_REGISTRATION_GUIDE.md` (detailed guide)
2. Create `/admin/bots` page
3. Implement bot list view
4. Implement registration form
5. Add edit/delete functionality

**Time Estimate**: 4-6 hours
**Impact**: New feature - Enables multi-sender support

---

## 📡 New API Endpoints

### Database-Backed APIs (Use These!)

All endpoints under `/api/db/*` read from PostgreSQL database.

#### Authentication
```http
Authorization: Bearer YOUR_DASHBOARD_PAT
X-Restaurant-Id: restaurant_id
```

#### List Conversations
```http
GET /api/db/conversations?status=active&limit=50
```

**Response**:
```json
[
  {
    "id": "conv_123",
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

#### Get Messages
```http
GET /api/db/conversations/:conversationId/messages?limit=100
```

**Response**:
```json
[
  {
    "id": "msg_001",
    "conversationId": "conv_123",
    "restaurantId": "rest_123",
    "direction": "IN",
    "messageType": "text",
    "content": "مرحبا، أريد طلب طعام",
    "mediaUrl": null,
    "waSid": "WAxxxx",
    "createdAt": "2025-10-16T10:30:00.000Z"
  }
]
```

#### Get Stats
```http
GET /api/db/conversations/stats
```

**Response**:
```json
{
  "totalConversations": 150,
  "activeConversations": 42,
  "totalUnread": 18
}
```

### Admin APIs (For Bot Management)

#### List Bots
```http
GET /api/admin/bots
```

#### Register New Bot
```http
POST /api/admin/bots
Content-Type: application/json

{
  "name": "Sufrah Bot",
  "restaurantName": "Sufrah",
  "whatsappNumber": "whatsapp:+966508034010",
  "accountSid": "AC...",
  "authToken": "...",
  "senderSid": "XE23c4f8b55966a1bfd101338f4c68b8cb",
  "wabaId": "777730705047590",
  "status": "ACTIVE"
}
```

---

## 💻 Implementation Guide

### Step 1: Create API Service

Create `services/conversationsDb.ts`:

```typescript
const API_BASE = 'https://bot.sufrah.sa/api/db';
const DASHBOARD_PAT = process.env.NEXT_PUBLIC_DASHBOARD_PAT;

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
}

async function fetchWithAuth(url: string, restaurantId: string) {
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${DASHBOARD_PAT}`,
      'X-Restaurant-Id': restaurantId,
    },
  });
  
  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }
  
  return response.json();
}

export async function getConversations(
  restaurantId: string,
  status?: 'active' | 'closed'
): Promise<Conversation[]> {
  const params = new URLSearchParams({ limit: '50' });
  if (status) params.set('status', status);
  
  return fetchWithAuth(
    `${API_BASE}/conversations?${params}`,
    restaurantId
  );
}

export async function getMessages(
  conversationId: string,
  restaurantId: string
): Promise<Message[]> {
  return fetchWithAuth(
    `${API_BASE}/conversations/${conversationId}/messages`,
    restaurantId
  );
}

export async function getStats(restaurantId: string) {
  return fetchWithAuth(
    `${API_BASE}/conversations/stats`,
    restaurantId
  );
}
```

### Step 2: Update Dashboard Component

**Replace this:**
```typescript
// ❌ WRONG - Don't use this anymore
useEffect(() => {
  socket.on('conversation.bootstrap', (data) => {
    setConversations(data);
  });
}, []);
```

**With this:**
```typescript
// ✅ CORRECT - Read from database
import { getConversations, getMessages } from '@/services/conversationsDb';
import { useAuth } from '@/hooks/useAuth'; // Get restaurant ID

function Dashboard() {
  const { restaurantId } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);

  // 1. Load data from DATABASE on mount
  useEffect(() => {
    async function loadConversations() {
      try {
        setLoading(true);
        const data = await getConversations(restaurantId, 'active');
        setConversations(data);
      } catch (error) {
        console.error('Failed to load conversations:', error);
        // Show error toast
      } finally {
        setLoading(false);
      }
    }
    
    loadConversations();
  }, [restaurantId]);

  // 2. Connect WebSocket for REAL-TIME UPDATES only
  useEffect(() => {
    const ws = new WebSocket('wss://bot.sufrah.sa/ws');

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);

      switch (msg.type) {
        case 'message.created':
          // New message arrived - update UI
          handleNewMessage(msg.data);
          break;

        case 'conversation.updated':
          // Conversation updated - refresh that conversation
          handleConversationUpdate(msg.data);
          break;

        case 'conversation.bootstrap':
          // IGNORE - we already have data from database
          console.log('Ignoring bootstrap, using DB data');
          break;
      }
    };

    ws.onclose = () => {
      console.log('WebSocket closed, refetching from DB...');
      loadConversations();
    };

    return () => ws.close();
  }, [restaurantId]);

  function handleNewMessage(message: Message) {
    // Update conversation list with new message
    setConversations(prev => {
      const updated = [...prev];
      const convIndex = updated.findIndex(c => c.id === message.conversationId);
      if (convIndex >= 0) {
        updated[convIndex] = {
          ...updated[convIndex],
          lastMessageAt: message.createdAt,
          unreadCount: updated[convIndex].unreadCount + 1,
        };
        // Move to top
        const [conv] = updated.splice(convIndex, 1);
        updated.unshift(conv);
      }
      return updated;
    });
  }

  function handleConversationUpdate(conversation: Conversation) {
    setConversations(prev =>
      prev.map(c => c.id === conversation.id ? conversation : c)
    );
  }

  if (loading) {
    return <LoadingSpinner />;
  }

  return (
    <div>
      <ConversationList conversations={conversations} />
    </div>
  );
}
```

### Step 3: Test

1. Load dashboard → Should show conversations from database ✅
2. Restart server: `pm2 restart all`
3. Reload dashboard → Should STILL show conversations ✅
4. Send WhatsApp message → Should appear in real-time ✅

---

## 🎨 Bot Registration UI

### Create Admin Page

**Route**: `/admin/bots`

**Components Needed**:
1. **BotList** - Table or grid of registered bots
2. **BotForm** - Registration/edit form
3. **BotCard** - Display bot details

### BotList Component

```typescript
import { useEffect, useState } from 'react';

interface Bot {
  id: string;
  name: string;
  restaurantName: string;
  whatsappNumber: string;
  senderSid: string;
  status: 'ACTIVE' | 'PENDING' | 'FAILED';
  isActive: boolean;
  createdAt: string;
}

export function BotList() {
  const [bots, setBots] = useState<Bot[]>([]);

  useEffect(() => {
    fetch('https://bot.sufrah.sa/api/admin/bots')
      .then(r => r.json())
      .then(setBots);
  }, []);

  return (
    <div>
      <h1>Registered Bots</h1>
      <button onClick={() => openRegisterForm()}>
        Register New Bot
      </button>

      <table>
        <thead>
          <tr>
            <th>Restaurant Name</th>
            <th>WhatsApp Number</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {bots.map(bot => (
            <tr key={bot.id}>
              <td>{bot.restaurantName}</td>
              <td>{bot.whatsappNumber}</td>
              <td>
                <span className={`status-${bot.status.toLowerCase()}`}>
                  {bot.status}
                </span>
              </td>
              <td>
                <button onClick={() => editBot(bot)}>Edit</button>
                <button onClick={() => deleteBot(bot.id)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

### BotForm Component

```typescript
export function BotForm({ bot, onClose }: { bot?: Bot, onClose: () => void }) {
  const [formData, setFormData] = useState({
    name: bot?.name || '',
    restaurantName: bot?.restaurantName || '',
    whatsappNumber: bot?.whatsappNumber || '',
    accountSid: bot?.accountSid || '',
    authToken: '',
    senderSid: bot?.senderSid || '',
    wabaId: bot?.wabaId || '',
  });

  // Quick-fill buttons for known senders
  const PRESETS = {
    sufrah: {
      name: 'Sufrah Bot',
      restaurantName: 'Sufrah',
      whatsappNumber: 'whatsapp:+966508034010',
      senderSid: 'XE23c4f8b55966a1bfd101338f4c68b8cb',
      wabaId: '777730705047590',
    },
    ocean: {
      name: 'Ocean Restaurant Bot',
      restaurantName: 'مطعم شاورما وفلافل أوشن',
      whatsappNumber: 'whatsapp:+966502045939',
      senderSid: 'XE803ebc75db963fdfa0e813d6f4f001f6',
      wabaId: '777730705047590',
    },
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    
    const url = bot
      ? `https://bot.sufrah.sa/api/admin/bots/${bot.id}`
      : 'https://bot.sufrah.sa/api/admin/bots';
      
    const method = bot ? 'PUT' : 'POST';

    try {
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        const error = await response.json();
        alert(error.error || 'Failed to save bot');
        return;
      }

      alert('Bot saved successfully!');
      onClose();
    } catch (error) {
      alert('Failed to save bot');
      console.error(error);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <h2>{bot ? 'Edit Bot' : 'Register New Bot'}</h2>

      {/* Quick-fill buttons */}
      <div className="presets">
        <button type="button" onClick={() => setFormData({ ...formData, ...PRESETS.sufrah })}>
          🍽️ Fill Sufrah Data
        </button>
        <button type="button" onClick={() => setFormData({ ...formData, ...PRESETS.ocean })}>
          🥙 Fill Ocean Data
        </button>
      </div>

      <div>
        <label>Bot Name *</label>
        <input
          required
          value={formData.name}
          onChange={e => setFormData({ ...formData, name: e.target.value })}
        />
      </div>

      <div>
        <label>Restaurant Name *</label>
        <input
          required
          value={formData.restaurantName}
          onChange={e => setFormData({ ...formData, restaurantName: e.target.value })}
        />
      </div>

      <div>
        <label>WhatsApp Number *</label>
        <input
          required
          placeholder="whatsapp:+966501234567"
          value={formData.whatsappNumber}
          onChange={e => setFormData({ ...formData, whatsappNumber: e.target.value })}
        />
      </div>

      <div>
        <label>Twilio Account SID *</label>
        <input
          required
          placeholder="AC..."
          value={formData.accountSid}
          onChange={e => setFormData({ ...formData, accountSid: e.target.value })}
        />
      </div>

      <div>
        <label>Twilio Auth Token *</label>
        <input
          required
          type="password"
          value={formData.authToken}
          onChange={e => setFormData({ ...formData, authToken: e.target.value })}
        />
      </div>

      <div>
        <label>Sender SID</label>
        <input
          placeholder="XE..."
          value={formData.senderSid}
          onChange={e => setFormData({ ...formData, senderSid: e.target.value })}
        />
      </div>

      <div>
        <label>WABA ID</label>
        <input
          value={formData.wabaId}
          onChange={e => setFormData({ ...formData, wabaId: e.target.value })}
        />
      </div>

      <div className="actions">
        <button type="submit">Save Bot</button>
        <button type="button" onClick={onClose}>Cancel</button>
      </div>
    </form>
  );
}
```

---

## 🧪 Testing

### Test Script

Run the provided test script:

```bash
cd docs
./TEST_NEW_APIS.sh
```

### Manual Testing

#### Test 1: Data Persistence
```bash
# 1. Open dashboard - note number of conversations
# 2. SSH to server
ssh your-server

# 3. Restart server
pm2 restart all

# 4. Refresh dashboard
# Expected: Same number of conversations shown ✅
```

#### Test 2: Real-time Updates
```bash
# 1. Open dashboard
# 2. Send WhatsApp message from phone
# 3. Dashboard should show new message immediately ✅
```

#### Test 3: Bot Registration
```bash
# 1. Go to /admin/bots
# 2. Click "Register New Bot"
# 3. Click "Fill Sufrah Data"
# 4. Add Account SID and Auth Token
# 5. Submit
# 6. Bot should appear in list ✅
# 7. Send WhatsApp to that number
# 8. Message should be processed ✅
```

---

## ❓ FAQ

### Q: Do we still use WebSocket?
**A**: Yes! But only for real-time updates, not as the primary data source.

### Q: What about old `/api/conversations` endpoint?
**A**: It still works but reads from memory. Use `/api/db/conversations` instead.

### Q: Do we need database migrations?
**A**: No! Database schema is unchanged. You just read from it now.

### Q: How do multiple restaurants work?
**A**: Use `X-Restaurant-Id` header. Each restaurant sees only their conversations.

### Q: What if API is slow?
**A**: Add loading states, pagination, and caching. Database queries are fast with proper indexes.

### Q: Can we cache API responses?
**A**: Yes, but keep cache fresh. Use WebSocket updates to invalidate cache.

---

## 📚 Additional Resources

- **DASHBOARD_CRITICAL_ARCHITECTURE_FIX.md** - Detailed architecture explanation
- **ADMIN_BOT_REGISTRATION_GUIDE.md** - Complete bot registration guide  
- **IMPLEMENTATION_SUMMARY.md** - Overview of all changes
- **BOT_RESPONSIVENESS_FIX.md** - Bot session recovery (backend)

---

## 🆘 Need Help?

1. **API not working?**
   - Check authentication headers
   - Verify `X-Restaurant-Id` is correct
   - Check browser console for errors

2. **Data still disappearing?**
   - Verify you're using `/api/db/*` endpoints
   - Check you're not using `conversation.bootstrap` event
   - Make sure initial data comes from database fetch

3. **Real-time updates not working?**
   - Check WebSocket connection
   - Verify event handlers are set up
   - Check browser console for WebSocket errors

---

**Good luck! 🚀**

The backend is ready and waiting for you. All APIs are tested and working.


# Dashboard Integration with External Bot Service

## Overview

The dashboard application communicates with an **external WhatsApp bot service** hosted at `bot.sufrah.sa`. This service handles all WhatsApp messaging, conversation management, and bot automation logic.

**Your dashboard's role**: Display conversations, messages, and provide a UI for managing bots and sending messages.

**Bot service's role**: Process WhatsApp messages, run bot automation, store data in database.

---

## 🔗 Service URLs

You already have these environment variables configured in your dashboard:

```env
BOT_URL="https://bot.sufrah.sa"
BOT_WS_URL="wss://bot.sufrah.sa/ws"
BOT_API_URL="https://bot.sufrah.sa/api"
BOT_API_TOKEN="sufrah_bot_0DJKLldY4IP7dBwEagEywUrC9Z4waN9yi3idlpMQLaM"
```

### What Each URL Does

| Variable | URL | Purpose |
|----------|-----|---------|
| `BOT_URL` | `https://bot.sufrah.sa` | Base URL for the bot service |
| `BOT_WS_URL` | `wss://bot.sufrah.sa/ws` | WebSocket endpoint for real-time updates |
| `BOT_API_URL` | `https://bot.sufrah.sa/api` | REST API base endpoint |
| `BOT_API_TOKEN` | `sufrah_bot_...` | Authentication token for API calls |

---

## 🔐 Authentication

### For REST API Calls

All REST API requests to the bot service require authentication using **one of these methods**:

#### Method 1: Bearer Token (Recommended for Dashboard)
```http
Authorization: Bearer sufrah_bot_0DJKLldY4IP7dBwEagEywUrC9Z4waN9yi3idlpMQLaM
X-Restaurant-Id: your_restaurant_id
```

#### Method 2: API Key Header
```http
X-API-Key: your_api_key
X-Restaurant-Id: your_restaurant_id
```

**Important**: The `X-Restaurant-Id` header is required for multi-tenancy. Each restaurant sees only their data.

### For WebSocket Connection

WebSocket connections don't require authentication headers, but you should identify the restaurant after connection:

```javascript
const ws = new WebSocket('wss://bot.sufrah.sa/ws');

ws.onopen = () => {
  // Optionally send identification
  ws.send(JSON.stringify({
    type: 'identify',
    restaurantId: 'your_restaurant_id'
  }));
};
```

---

## 📡 API Endpoints

### Base Configuration

```typescript
// config/botService.ts
export const BOT_SERVICE = {
  baseUrl: process.env.BOT_URL || 'https://bot.sufrah.sa',
  apiUrl: process.env.BOT_API_URL || 'https://bot.sufrah.sa/api',
  wsUrl: process.env.BOT_WS_URL || 'wss://bot.sufrah.sa/ws',
  apiToken: process.env.BOT_API_TOKEN || '',
};
```

### Available Endpoints

#### 1. Database-Backed APIs (Use These!)

These read from the PostgreSQL database and persist across server restarts:

```typescript
// Get conversations from database
GET ${BOT_API_URL}/db/conversations
Headers:
  Authorization: Bearer ${BOT_API_TOKEN}
  X-Restaurant-Id: ${restaurantId}
Query params:
  ?status=active&limit=50&offset=0

// Get messages from database
GET ${BOT_API_URL}/db/conversations/${conversationId}/messages
Headers:
  Authorization: Bearer ${BOT_API_TOKEN}
  X-Restaurant-Id: ${restaurantId}
Query params:
  ?limit=100&offset=0

// Get statistics
GET ${BOT_API_URL}/db/conversations/stats
Headers:
  Authorization: Bearer ${BOT_API_TOKEN}
  X-Restaurant-Id: ${restaurantId}

// Get restaurant bots
GET ${BOT_API_URL}/db/restaurants/${restaurantId}/bots
Headers:
  Authorization: Bearer ${BOT_API_TOKEN}
  X-Restaurant-Id: ${restaurantId}
```

#### 2. Admin APIs (Bot Management)

```typescript
// List all bots
GET ${BOT_API_URL}/admin/bots

// Get specific bot
GET ${BOT_API_URL}/admin/bots/${botId}

// Register new bot
POST ${BOT_API_URL}/admin/bots
Body: {
  name: string,
  restaurantName: string,
  whatsappNumber: string,
  accountSid: string,
  authToken: string,
  senderSid?: string,
  wabaId?: string,
  ...
}

// Update bot
PUT ${BOT_API_URL}/admin/bots/${botId}
Body: Partial bot data

// Delete bot
DELETE ${BOT_API_URL}/admin/bots/${botId}
```

#### 3. Legacy APIs (In-Memory - Avoid)

These read from in-memory cache and will be empty after server restart:

```typescript
// ❌ Don't use these - data disappears on restart
GET ${BOT_API_URL}/conversations
GET ${BOT_API_URL}/conversations/${conversationId}/messages
```

#### 4. Messaging APIs (Send Messages)

```typescript
// Send text message
POST ${BOT_API_URL}/conversations/${conversationId}/send
Headers:
  Authorization: Bearer ${BOT_API_TOKEN}
  X-Restaurant-Id: ${restaurantId}
Body: {
  message: string
}

// Send media message
POST ${BOT_API_URL}/conversations/${conversationId}/send-media
Headers:
  Authorization: Bearer ${BOT_API_TOKEN}
  X-Restaurant-Id: ${restaurantId}
Body: {
  mediaUrl: string,
  caption?: string,
  mediaType?: 'image' | 'document' | 'audio' | 'video'
}

// Toggle bot on/off for conversation
POST ${BOT_API_URL}/conversations/${conversationId}/toggle-bot
Headers:
  Authorization: Bearer ${BOT_API_TOKEN}
  X-Restaurant-Id: ${restaurantId}
Body: {
  enabled: boolean
}
```

---

## 🔌 WebSocket Real-Time Events

### Connection Setup

```typescript
// services/websocket.ts
import { BOT_SERVICE } from '@/config/botService';

class BotWebSocket {
  private ws: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private listeners: Map<string, Set<Function>> = new Map();

  connect() {
    this.ws = new WebSocket(BOT_SERVICE.wsUrl);

    this.ws.onopen = () => {
      console.log('✅ Connected to bot service');
      this.clearReconnectTimer();
    };

    this.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        this.handleMessage(message);
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
    };

    this.ws.onclose = () => {
      console.log('❌ Disconnected from bot service');
      this.scheduleReconnect();
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  }

  private handleMessage(message: any) {
    const { type, data } = message;
    const listeners = this.listeners.get(type);
    if (listeners) {
      listeners.forEach(callback => callback(data));
    }
  }

  on(eventType: string, callback: Function) {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set());
    }
    this.listeners.get(eventType)!.add(callback);
    
    return () => {
      this.listeners.get(eventType)?.delete(callback);
    };
  }

  private scheduleReconnect() {
    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => {
      console.log('🔄 Attempting to reconnect...');
      this.connect();
    }, 5000);
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  disconnect() {
    this.clearReconnectTimer();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

export const botWebSocket = new BotWebSocket();
```

### Event Types

```typescript
// message.created - New message received
{
  type: 'message.created',
  data: {
    id: string,
    conversationId: string,
    fromPhone: string,
    content: string,
    messageType: string,
    direction: 'IN' | 'OUT',
    createdAt: string
  }
}

// conversation.updated - Conversation state changed
{
  type: 'conversation.updated',
  data: {
    id: string,
    customerPhone: string,
    customerName: string,
    unreadCount: number,
    lastMessageAt: string,
    isBotActive: boolean
  }
}

// conversation.bootstrap - Initial data (IGNORE THIS)
{
  type: 'conversation.bootstrap',
  data: Array<Conversation>
}
// ⚠️ Don't use bootstrap data - fetch from database instead

// bot.status - Bot enabled/disabled globally
{
  type: 'bot.status',
  data: {
    enabled: boolean
  }
}

// order.updated - Order status changed
{
  type: 'order.updated',
  data: {
    id: string,
    status: string,
    orderReference: string
  }
}
```

---

## 💻 Implementation Example

### Create API Service

```typescript
// services/botApi.ts
import { BOT_SERVICE } from '@/config/botService';

interface ApiOptions {
  restaurantId?: string;
  params?: Record<string, string>;
}

class BotApiService {
  private async fetch<T>(
    endpoint: string,
    options: RequestInit = {},
    apiOptions: ApiOptions = {}
  ): Promise<T> {
    const url = new URL(`${BOT_SERVICE.apiUrl}${endpoint}`);
    
    // Add query parameters
    if (apiOptions.params) {
      Object.entries(apiOptions.params).forEach(([key, value]) => {
        url.searchParams.set(key, value);
      });
    }

    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${BOT_SERVICE.apiToken}`,
      ...options.headers,
    };

    // Add restaurant ID if provided
    if (apiOptions.restaurantId) {
      headers['X-Restaurant-Id'] = apiOptions.restaurantId;
    }

    const response = await fetch(url.toString(), {
      ...options,
      headers,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || `API error: ${response.status}`);
    }

    return response.json();
  }

  // Get conversations from database
  async getConversations(restaurantId: string, status?: 'active' | 'closed') {
    const params: Record<string, string> = { limit: '50' };
    if (status) params.status = status;

    return this.fetch('/db/conversations', {}, { 
      restaurantId,
      params 
    });
  }

  // Get messages from database
  async getMessages(conversationId: string, restaurantId: string) {
    return this.fetch(
      `/db/conversations/${conversationId}/messages`,
      {},
      { restaurantId, params: { limit: '100' } }
    );
  }

  // Get conversation stats
  async getStats(restaurantId: string) {
    return this.fetch('/db/conversations/stats', {}, { restaurantId });
  }

  // Send text message
  async sendMessage(conversationId: string, restaurantId: string, message: string) {
    return this.fetch(
      `/conversations/${conversationId}/send`,
      {
        method: 'POST',
        body: JSON.stringify({ message }),
      },
      { restaurantId }
    );
  }

  // List all bots (admin)
  async listBots() {
    return this.fetch('/admin/bots');
  }

  // Register new bot (admin)
  async registerBot(botData: any) {
    return this.fetch('/admin/bots', {
      method: 'POST',
      body: JSON.stringify(botData),
    });
  }

  // Update bot (admin)
  async updateBot(botId: string, botData: any) {
    return this.fetch(`/admin/bots/${botId}`, {
      method: 'PUT',
      body: JSON.stringify(botData),
    });
  }

  // Delete bot (admin)
  async deleteBot(botId: string) {
    return this.fetch(`/admin/bots/${botId}`, {
      method: 'DELETE',
    });
  }
}

export const botApi = new BotApiService();
```

### Use in Dashboard Component

```typescript
// components/ConversationList.tsx
import { useEffect, useState } from 'react';
import { botApi } from '@/services/botApi';
import { botWebSocket } from '@/services/websocket';
import { useAuth } from '@/hooks/useAuth';

export function ConversationList() {
  const { restaurantId } = useAuth();
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);

  // 1. Load initial data from DATABASE (via bot service)
  useEffect(() => {
    async function loadConversations() {
      try {
        setLoading(true);
        const data = await botApi.getConversations(restaurantId, 'active');
        setConversations(data);
      } catch (error) {
        console.error('Failed to load conversations:', error);
        toast.error('Failed to load conversations');
      } finally {
        setLoading(false);
      }
    }

    loadConversations();
  }, [restaurantId]);

  // 2. Connect to WebSocket for REAL-TIME updates
  useEffect(() => {
    botWebSocket.connect();

    // Listen for new messages
    const unsubscribeMessage = botWebSocket.on('message.created', (message) => {
      console.log('New message:', message);
      // Update conversation list
      handleNewMessage(message);
    });

    // Listen for conversation updates
    const unsubscribeConv = botWebSocket.on('conversation.updated', (conv) => {
      console.log('Conversation updated:', conv);
      updateConversation(conv);
    });

    return () => {
      unsubscribeMessage();
      unsubscribeConv();
      botWebSocket.disconnect();
    };
  }, []);

  function handleNewMessage(message: any) {
    setConversations(prev => {
      const updated = [...prev];
      const index = updated.findIndex(c => c.id === message.conversationId);
      
      if (index >= 0) {
        // Update existing conversation
        updated[index] = {
          ...updated[index],
          lastMessageAt: message.createdAt,
          unreadCount: updated[index].unreadCount + 1,
        };
        
        // Move to top
        const [conv] = updated.splice(index, 1);
        updated.unshift(conv);
      }
      
      return updated;
    });
  }

  function updateConversation(conversation: any) {
    setConversations(prev =>
      prev.map(c => c.id === conversation.id ? { ...c, ...conversation } : c)
    );
  }

  if (loading) {
    return <LoadingSpinner />;
  }

  return (
    <div>
      {conversations.map(conv => (
        <ConversationCard key={conv.id} conversation={conv} />
      ))}
    </div>
  );
}
```

---

## 🔑 Environment Variables Setup

### In Your Dashboard `.env` File

```env
# Bot Service Configuration
BOT_URL=https://bot.sufrah.sa
BOT_WS_URL=wss://bot.sufrah.sa/ws
BOT_API_URL=https://bot.sufrah.sa/api
BOT_API_TOKEN=sufrah_bot_0DJKLldY4IP7dBwEagEywUrC9Z4waN9yi3idlpMQLaM

# Make available to browser (Next.js)
NEXT_PUBLIC_BOT_URL=https://bot.sufrah.sa
NEXT_PUBLIC_BOT_WS_URL=wss://bot.sufrah.sa/ws
NEXT_PUBLIC_BOT_API_URL=https://bot.sufrah.sa/api
```

**Security Note**: `BOT_API_TOKEN` should only be used on the **server side** (API routes, server components). Don't expose it in client-side code.

### For Server-Side API Calls

```typescript
// pages/api/conversations.ts (Next.js API route)
import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { restaurantId } = req.query;

  try {
    const response = await fetch(
      `${process.env.BOT_API_URL}/db/conversations`,
      {
        headers: {
          'Authorization': `Bearer ${process.env.BOT_API_TOKEN}`,
          'X-Restaurant-Id': restaurantId as string,
        },
      }
    );

    const data = await response.json();
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch conversations' });
  }
}
```

### For Client-Side Calls (Public URLs Only)

```typescript
// Use your own API routes, or call bot service directly with public token
const response = await fetch('/api/conversations?restaurantId=' + restaurantId);
```

---

## 🧪 Testing the Connection

### Test 1: Check Bot Service is Reachable

```bash
# Test health endpoint
curl https://bot.sufrah.sa/health
```

Expected response:
```json
{
  "status": "healthy",
  "timestamp": "2025-10-16T...",
  "uptime": 12345,
  "welcomedUsers": 100,
  "activeCarts": 5,
  "botEnabled": true
}
```

### Test 2: Test API Authentication

```bash
# Test with your token
curl https://bot.sufrah.sa/api/admin/bots \
  -H "Authorization: Bearer sufrah_bot_0DJKLldY4IP7dBwEagEywUrC9Z4waN9yi3idlpMQLaM"
```

### Test 3: Test Database API

```bash
# Replace with actual restaurant ID
curl https://bot.sufrah.sa/api/db/conversations \
  -H "Authorization: Bearer sufrah_bot_0DJKLldY4IP7dBwEagEywUrC9Z4waN9yi3idlpMQLaM" \
  -H "X-Restaurant-Id: your_restaurant_id"
```

### Test 4: Test WebSocket

```javascript
// In browser console
const ws = new WebSocket('wss://bot.sufrah.sa/ws');
ws.onmessage = (e) => console.log('Message:', JSON.parse(e.data));
ws.onopen = () => console.log('Connected!');
```

---

## ⚠️ Important Notes

### 1. Service is External
The bot service (`bot.sufrah.sa`) is a **separate application** from your dashboard. It:
- Runs independently on its own server
- Has its own database (PostgreSQL)
- Can be restarted without affecting your dashboard
- Handles all WhatsApp message processing

### 2. Data Flow
```
WhatsApp → Bot Service → Database
                ↓           ↓
           WebSocket    REST API
                ↓           ↓
              Dashboard (Your App)
```

### 3. Always Use Database APIs
```typescript
// ✅ CORRECT - Use /api/db/* endpoints
const convs = await fetch(`${BOT_API_URL}/db/conversations`);

// ❌ WRONG - Don't use /api/conversations (in-memory)
const convs = await fetch(`${BOT_API_URL}/conversations`);
```

### 4. WebSocket is for Updates Only
```typescript
// ✅ CORRECT
const data = await botApi.getConversations(restaurantId); // Database
botWebSocket.on('message.created', handleNewMessage); // Real-time

// ❌ WRONG
botWebSocket.on('conversation.bootstrap', setConversations); // Memory cache
```

### 5. Multi-Tenancy
Each restaurant must send their ID in headers:
```typescript
headers: {
  'X-Restaurant-Id': restaurantId // REQUIRED
}
```

---

## 📚 Related Documentation

- **README_FOR_DASHBOARD_DEVELOPER.md** - Quick start guide
- **DASHBOARD_CRITICAL_ARCHITECTURE_FIX.md** - Architecture details
- **ADMIN_BOT_REGISTRATION_GUIDE.md** - Bot registration UI
- **IMPLEMENTATION_SUMMARY.md** - Overview of all changes

---

## 🆘 Troubleshooting

### Issue: "Unauthorized" Error

**Solution**: Check your `BOT_API_TOKEN` is correct and included in headers:
```typescript
headers: {
  'Authorization': `Bearer ${BOT_API_TOKEN}`
}
```

### Issue: "Restaurant not found" or Empty Data

**Solution**: Verify `X-Restaurant-Id` header is set correctly:
```typescript
headers: {
  'X-Restaurant-Id': 'your_restaurant_id'
}
```

### Issue: WebSocket Keeps Disconnecting

**Solution**: Implement reconnection logic (see example above). WebSocket will auto-reconnect.

### Issue: Data Still Disappearing

**Solution**: Make sure you're using `/api/db/*` endpoints, not `/api/conversations`:
```typescript
// ✅ Use this
GET /api/db/conversations

// ❌ Not this
GET /api/conversations
```

### Issue: CORS Errors

**Solution**: Bot service already has CORS enabled. If you still see errors, check:
1. You're using HTTPS (not HTTP)
2. Your domain is allowed
3. Headers are properly set

---

## ✅ Checklist

Before going to production, verify:

- [ ] Environment variables are configured
- [ ] Bot service health check works
- [ ] API authentication works
- [ ] Can fetch conversations from database
- [ ] Can fetch messages from database
- [ ] WebSocket connects successfully
- [ ] Real-time messages appear
- [ ] Data persists after bot service restart
- [ ] Multi-tenancy works (each restaurant isolated)
- [ ] Error handling is in place
- [ ] Loading states are shown
- [ ] Reconnection logic works

---

**Remember**: The bot service (`bot.sufrah.sa`) is your backend. Your dashboard is just a UI that displays the data from this service. Always fetch from the database APIs for reliable data!


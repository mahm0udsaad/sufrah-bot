# Dashboard API - Frontend Integration Guide

## ✅ Important: No Database Changes Required!

**The backend developer has completed all database work.** You only need:
1. The API URL
2. Authentication token (PAT)
3. This integration guide

**No database setup needed on your end!**

---

## Overview

A complete dashboard API backend has been implemented to power your rich owner dashboard. This guide will help you integrate these APIs into your frontend application.

## 🚀 Quick Start

### Base URL

```
Production: https://your-api-domain.com
Development: http://localhost:3000
```

### Authentication

All dashboard endpoints require authentication. You have two options:

#### Option 1: Personal Access Token (PAT) - For Restaurant Users

```typescript
const headers = {
  'Authorization': `Bearer ${DASHBOARD_PAT}`,
  'X-Restaurant-Id': restaurantId,
  'Accept-Language': 'en', // or 'ar' for Arabic
  'Content-Type': 'application/json'
};
```

#### Option 2: API Key - For Admin Users

```typescript
const headers = {
  'X-API-Key': BOT_API_KEY,
  'Accept-Language': 'en',
  'Content-Type': 'application/json'
};
```

### Environment Variables

Add to your `.env`:

```bash
REACT_APP_API_URL=http://localhost:3000
REACT_APP_DASHBOARD_PAT=your-secret-pat-token
REACT_APP_BOT_API_KEY=your-admin-api-key
```

---

## 📊 Core Features & Endpoints

### 1. Dashboard Home Page

**Endpoint:** `GET /api/tenants/:restaurantId/overview`

**Use Case:** Display key metrics on dashboard home page

**Request:**
```typescript
const fetchDashboardOverview = async (restaurantId: string) => {
  const response = await fetch(
    `${API_URL}/api/tenants/${restaurantId}/overview?currency=SAR`,
    {
      headers: {
        'Authorization': `Bearer ${DASHBOARD_PAT}`,
        'X-Restaurant-Id': restaurantId,
        'Accept-Language': locale, // 'en' or 'ar'
      }
    }
  );
  return response.json();
};
```

**Response:**
```typescript
{
  data: {
    restaurantId: string;
    restaurantName: string;
    activeConversations: number;
    pendingOrders: number;
    slaBreaches: number;
    quotaUsage: {
      used: number;
      limit: number;
      remaining: number;
      percentUsed: number;
    };
    ratingTrend: {
      averageRating: number;
      totalRatings: number;
      trend: 'up' | 'down' | 'stable';
      changePercent: number;
    };
    recentActivity: {
      messagesLast24h: number;
      ordersLast24h: number;
      conversationsLast24h: number;
    };
  };
  meta: {
    locale: string;
    currency: string;
    timestamp: string;
  };
}
```

**UI Components:**
- Metric cards for conversations, orders, SLA breaches
- Quota usage progress bar
- Rating trend chart
- Activity timeline

---

### 2. Conversations (Chat Management)

**Endpoint:** `GET /api/conversations/summary`

**Use Case:** Display active conversations with SLA tracking

**Request:**
```typescript
const fetchConversations = async (limit = 20, offset = 0) => {
  const url = new URL(`${API_URL}/api/conversations/summary`);
  url.searchParams.append('limit', limit.toString());
  url.searchParams.append('offset', offset.toString());
  
  const response = await fetch(url.toString(), {
    headers: {
      'Authorization': `Bearer ${DASHBOARD_PAT}`,
      'X-Restaurant-Id': restaurantId,
    }
  });
  return response.json();
};
```

**Response:**
```typescript
{
  data: {
    conversations: Array<{
      id: string;
      customerWa: string;
      customerName: string;
      lastMessageAt: string;
      lastMessagePreview: string;
      lastMessageRelative: string; // "5 minutes ago"
      unreadCount: number;
      channel: 'bot' | 'agent';
      channelDisplay: string; // Localized
      escalated: boolean;
      slaStatus: {
        breached: boolean;
        minutesRemaining: number;
      };
    }>;
    pagination: {
      total: number;
      limit: number;
      offset: number;
      hasMore: boolean;
    };
  };
  meta: { locale: string; currency: string; timestamp: string };
}
```

**UI Components:**
- Conversation list with badges (unread count, SLA warning)
- Click to view transcript
- Filter by escalated/SLA breached
- Infinite scroll with pagination

**Get Full Transcript:**
```typescript
const fetchTranscript = async (conversationId: string) => {
  const response = await fetch(
    `${API_URL}/api/conversations/${conversationId}/transcript`,
    { headers }
  );
  return response.json();
};
```

**Update Conversation (Transfer to Agent):**
```typescript
const transferToAgent = async (conversationId: string) => {
  const response = await fetch(
    `${API_URL}/api/conversations/${conversationId}`,
    {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ isBotActive: false })
    }
  );
  return response.json();
};
```

**Export Conversation:**
```typescript
const exportConversation = async (conversationId: string) => {
  const response = await fetch(
    `${API_URL}/api/conversations/${conversationId}/export`,
    { headers }
  );
  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `conversation-${conversationId}.txt`;
  a.click();
};
```

---

### 3. Orders Management

**Endpoint:** `GET /api/orders/live`

**Use Case:** Real-time order feed with status tracking

**Request:**
```typescript
const fetchOrders = async (limit = 20, offset = 0, status?: string) => {
  const url = new URL(`${API_URL}/api/orders/live`);
  url.searchParams.append('limit', limit.toString());
  url.searchParams.append('offset', offset.toString());
  if (status) url.searchParams.append('status', status);
  
  const response = await fetch(url.toString(), { headers });
  return response.json();
};
```

**Response:**
```typescript
{
  data: {
    orders: Array<{
      id: string;
      orderReference: string;
      status: 'CONFIRMED' | 'PREPARING' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'CANCELLED';
      statusDisplay: string; // Localized
      customerName: string;
      totalCents: number;
      totalFormatted: string; // "SAR 150.00"
      currency: string;
      itemCount: number;
      createdAt: string;
      createdAtRelative: string;
      preparationTime: number; // minutes
      alerts: {
        isLate: boolean;
        awaitingPayment: boolean;
        requiresReview: boolean;
      };
    }>;
    pagination: { total: number; limit: number; offset: number; hasMore: boolean };
  };
  meta: { locale: string; currency: string; timestamp: string };
}
```

**UI Components:**
- Order cards with status badges
- Alert indicators (late, awaiting payment)
- Status update dropdown
- Filter by status

**Update Order Status:**
```typescript
const updateOrderStatus = async (orderId: string, status: string) => {
  const response = await fetch(
    `${API_URL}/api/orders/${orderId}`,
    {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ status })
    }
  );
  return response.json();
};
```

**Get Order Statistics:**
```typescript
const fetchOrderStats = async (days = 30) => {
  const response = await fetch(
    `${API_URL}/api/orders/stats?days=${days}`,
    { headers }
  );
  return response.json();
};
```

---

### 4. Ratings & Reviews

**Endpoint:** `GET /api/ratings`

**Use Case:** Display rating analytics with NPS

**Request:**
```typescript
const fetchRatings = async (days = 30) => {
  const response = await fetch(
    `${API_URL}/api/ratings?days=${days}`,
    { headers }
  );
  return response.json();
};
```

**Response:**
```typescript
{
  data: {
    period: { days: number; startDate: string; endDate: string };
    summary: {
      totalRatings: number;
      averageRating: number;
      nps: number; // Net Promoter Score
      responseRate: number;
      trend: 'up' | 'down' | 'stable';
      changePercent: number;
    };
    distribution: {
      1: number;
      2: number;
      // ... up to 10
    };
    segments: {
      promoters: number;
      passives: number;
      detractors: number;
      promotersPercent: number;
      passivesPercent: number;
      detractorsPercent: number;
    };
    withComments: number;
  };
  meta: { locale: string; currency: string; timestamp: string };
}
```

**UI Components:**
- NPS score display
- Rating distribution bar chart
- Segment pie chart (promoters/passives/detractors)
- Trend indicator

**Get Reviews with Comments:**
```typescript
const fetchReviews = async (limit = 20, offset = 0, minRating = 1, withComments = false) => {
  const url = new URL(`${API_URL}/api/ratings/reviews`);
  url.searchParams.append('limit', limit.toString());
  url.searchParams.append('offset', offset.toString());
  url.searchParams.append('min_rating', minRating.toString());
  if (withComments) url.searchParams.append('with_comments', 'true');
  
  const response = await fetch(url.toString(), { headers });
  return response.json();
};
```

**Get Rating Timeline:**
```typescript
const fetchRatingTimeline = async (days = 30) => {
  const response = await fetch(
    `${API_URL}/api/ratings/timeline?days=${days}`,
    { headers }
  );
  return response.json();
};
```

---

### 5. Notifications

**Endpoint:** `GET /api/notifications`

**Use Case:** Real-time alerts for owners

**Request:**
```typescript
const fetchNotifications = async (includeRead = false) => {
  const url = new URL(`${API_URL}/api/notifications`);
  if (includeRead) url.searchParams.append('include_read', 'true');
  
  const response = await fetch(url.toString(), { headers });
  return response.json();
};
```

**Response:**
```typescript
{
  data: {
    notifications: Array<{
      id: string;
      type: 'new_order' | 'failed_send' | 'quota_warning' | 'template_expiring' | 'sla_breach' | 'webhook_error';
      severity: 'info' | 'warning' | 'error';
      title: string;
      message: string;
      data?: any;
      read: boolean;
      createdAt: string;
      createdAtRelative: string;
    }>;
    unreadCount: number;
    totalCount: number;
  };
  meta: { locale: string; currency: string; timestamp: string };
}
```

**UI Components:**
- Notification bell icon with badge (unread count)
- Notification dropdown/panel
- Color-coded by severity
- Auto-refresh every 30 seconds

**Polling Example:**
```typescript
useEffect(() => {
  const interval = setInterval(() => {
    fetchNotifications().then(data => {
      setNotifications(data.data.notifications);
      setUnreadCount(data.data.unreadCount);
    });
  }, 30000); // Poll every 30 seconds
  
  return () => clearInterval(interval);
}, []);
```

---

### 6. Bot Management

**Endpoint:** `GET /api/bot`

**Use Case:** Display bot health and configuration

**Request:**
```typescript
const fetchBotStatus = async (includeHistory = false) => {
  const url = new URL(`${API_URL}/api/bot`);
  if (includeHistory) {
    url.searchParams.append('include_history', 'true');
    url.searchParams.append('history_hours', '24');
  }
  
  const response = await fetch(url.toString(), { headers });
  return response.json();
};
```

**Response:**
```typescript
{
  data: {
    botId: string;
    botName: string;
    whatsappNumber: string;
    status: 'ACTIVE' | 'PENDING' | 'FAILED';
    statusDisplay: string;
    isVerified: boolean;
    verifiedAt: string | null;
    lastWebhookAt: string | null;
    webhookHealth: {
      healthy: boolean;
      errorRate: number;
      requestsLastHour: number;
      errorsLastHour: number;
    };
    rateLimits: {
      maxMessagesPerMin: number;
      maxMessagesPerDay: number;
    };
    messagesLastHour: number;
    messageHistory?: Array<{
      timestamp: string;
      sent: number;
      received: number;
      total: number;
    }>;
  };
  meta: { locale: string; currency: string; timestamp: string };
}
```

**Update Bot Settings:**
```typescript
const updateBotSettings = async (settings: {
  maxMessagesPerMin?: number;
  maxMessagesPerDay?: number;
  isActive?: boolean;
}) => {
  const response = await fetch(`${API_URL}/api/bot`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(settings)
  });
  return response.json();
};
```

---

### 7. Templates Management

**Endpoint:** `GET /api/templates`

**Use Case:** Manage WhatsApp message templates

**Request:**
```typescript
const fetchTemplates = async (status?: string, category?: string) => {
  const url = new URL(`${API_URL}/api/templates`);
  if (status) url.searchParams.append('status', status);
  if (category) url.searchParams.append('category', category);
  
  const response = await fetch(url.toString(), { headers });
  return response.json();
};
```

**Create Template:**
```typescript
const createTemplate = async (template: {
  name: string;
  category: string;
  language?: string;
  body_text: string;
  footer_text?: string;
  variables?: string[];
}) => {
  const response = await fetch(`${API_URL}/api/templates`, {
    method: 'POST',
    headers,
    body: JSON.stringify(template)
  });
  return response.json();
};
```

**Update Template:**
```typescript
const updateTemplate = async (templateId: string, updates: any) => {
  const response = await fetch(`${API_URL}/api/templates/${templateId}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(updates)
  });
  return response.json();
};
```

**Delete Template:**
```typescript
const deleteTemplate = async (templateId: string) => {
  const response = await fetch(`${API_URL}/api/templates/${templateId}`, {
    method: 'DELETE',
    headers
  });
  return response.json();
};
```

---

### 8. Catalog Management

**Endpoint:** `GET /api/catalog/categories`

**Use Case:** Display menu categories and items

**Request:**
```typescript
const fetchCategories = async () => {
  const response = await fetch(
    `${API_URL}/api/catalog/categories`,
    { headers }
  );
  return response.json();
};
```

**Get Branches:**
```typescript
const fetchBranches = async () => {
  const response = await fetch(
    `${API_URL}/api/catalog/branches`,
    { headers }
  );
  return response.json();
};
```

**Get Sync Status:**
```typescript
const fetchSyncStatus = async () => {
  const response = await fetch(
    `${API_URL}/api/catalog/sync-status`,
    { headers }
  );
  return response.json();
};
```

---

### 9. Settings & Profile

**Endpoint:** `GET /api/settings/profile`

**Use Case:** Restaurant profile management

**Request:**
```typescript
const fetchProfile = async () => {
  const response = await fetch(
    `${API_URL}/api/settings/profile`,
    { headers }
  );
  return response.json();
};
```

**Update Profile:**
```typescript
const updateProfile = async (updates: {
  name?: string;
  description?: string;
  address?: string;
  phone?: string;
  logoUrl?: string;
}) => {
  const response = await fetch(`${API_URL}/api/settings/profile`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(updates)
  });
  return response.json();
};
```

**Get Audit Logs:**
```typescript
const fetchAuditLogs = async (limit = 50, offset = 0) => {
  const url = new URL(`${API_URL}/api/settings/audit-logs`);
  url.searchParams.append('limit', limit.toString());
  url.searchParams.append('offset', offset.toString());
  
  const response = await fetch(url.toString(), { headers });
  return response.json();
};
```

---

### 10. Logs & Monitoring

**Endpoint:** `GET /api/logs`

**Use Case:** View webhook logs and errors

**Request:**
```typescript
const fetchLogs = async (filters: {
  limit?: number;
  offset?: number;
  severity?: 'info' | 'warning' | 'error';
  startDate?: string;
  endDate?: string;
}) => {
  const url = new URL(`${API_URL}/api/logs`);
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined) {
      url.searchParams.append(key, value.toString());
    }
  });
  
  const response = await fetch(url.toString(), { headers });
  return response.json();
};
```

**Export Logs (CSV):**
```typescript
const exportLogs = async (startDate: string, endDate: string) => {
  const url = new URL(`${API_URL}/api/logs/export`);
  url.searchParams.append('start_date', startDate);
  url.searchParams.append('end_date', endDate);
  
  const response = await fetch(url.toString(), { headers });
  const blob = await response.blob();
  const downloadUrl = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = downloadUrl;
  a.download = `logs-${startDate}-${endDate}.csv`;
  a.click();
};
```

---

### 11. Onboarding

**Endpoint:** `GET /api/onboarding`

**Use Case:** Track onboarding progress

**Request:**
```typescript
const fetchOnboardingProgress = async () => {
  const response = await fetch(
    `${API_URL}/api/onboarding`,
    { headers }
  );
  return response.json();
};
```

**Response:**
```typescript
{
  data: {
    status: 'PENDING_APPROVAL' | 'ACTIVE' | 'REJECTED';
    progress: {
      completed: number;
      total: number;
      percent: number;
    };
    checklist: Array<{
      id: string;
      title: string;
      description: string;
      completed: boolean;
      required: boolean;
    }>;
    verification: {
      userVerified: boolean;
      botVerified: boolean;
      timeline: Array<{
        step: string;
        status: 'completed' | 'in_progress' | 'failed';
        timestamp: string;
        error?: string;
      }>;
    };
  };
  meta: { locale: string; currency: string; timestamp: string };
}
```

---

### 12. Health Check

**Endpoint:** `GET /api/health`

**Use Case:** Monitor API health status

**Request:**
```typescript
const checkHealth = async () => {
  const response = await fetch(`${API_URL}/api/health`);
  return response.json();
};
```

---

## 🛠 React Hooks Examples

### Custom Hook for Dashboard Data

```typescript
import { useState, useEffect } from 'react';

export const useDashboardOverview = (restaurantId: string) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const response = await fetch(
          `${process.env.REACT_APP_API_URL}/api/tenants/${restaurantId}/overview`,
          {
            headers: {
              'Authorization': `Bearer ${process.env.REACT_APP_DASHBOARD_PAT}`,
              'X-Restaurant-Id': restaurantId,
              'Accept-Language': localStorage.getItem('locale') || 'en',
            }
          }
        );
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        
        const result = await response.json();
        setData(result.data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [restaurantId]);

  return { data, loading, error };
};
```

### Custom Hook for Pagination

```typescript
export const useOrders = (restaurantId: string, pageSize = 20) => {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [offset, setOffset] = useState(0);

  const loadMore = async () => {
    if (loading || !hasMore) return;
    
    setLoading(true);
    try {
      const response = await fetch(
        `${API_URL}/api/orders/live?limit=${pageSize}&offset=${offset}`,
        { headers }
      );
      const result = await response.json();
      
      setOrders(prev => [...prev, ...result.data.orders]);
      setHasMore(result.data.pagination.hasMore);
      setOffset(prev => prev + pageSize);
    } catch (err) {
      console.error('Failed to load orders:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMore();
  }, []);

  return { orders, loading, hasMore, loadMore };
};
```

### Custom Hook for Real-time Notifications

```typescript
export const useNotifications = (restaurantId: string, pollInterval = 30000) => {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    const fetchNotifications = async () => {
      try {
        const response = await fetch(
          `${API_URL}/api/notifications`,
          { headers }
        );
        const result = await response.json();
        setNotifications(result.data.notifications);
        setUnreadCount(result.data.unreadCount);
      } catch (err) {
        console.error('Failed to fetch notifications:', err);
      }
    };

    fetchNotifications();
    const interval = setInterval(fetchNotifications, pollInterval);

    return () => clearInterval(interval);
  }, [restaurantId, pollInterval]);

  return { notifications, unreadCount };
};
```

---

## 🌍 Internationalization (i18n)

All endpoints support localization. Set the `Accept-Language` header:

```typescript
headers: {
  'Accept-Language': 'ar' // Arabic
  // or
  'Accept-Language': 'en' // English
}
```

**Localized Fields in Responses:**
- `statusDisplay` - Localized status labels
- `channelDisplay` - Localized channel names
- Formatted currencies (SAR format)
- Formatted dates and times
- Relative times ("5 minutes ago" / "منذ 5 دقائق")

---

## 🎨 UI Component Suggestions

### Dashboard Home
```jsx
<DashboardOverview>
  <MetricsGrid>
    <MetricCard title="Active Conversations" value={data.activeConversations} />
    <MetricCard title="Pending Orders" value={data.pendingOrders} />
    <MetricCard title="SLA Breaches" value={data.slaBreaches} alert />
    <QuotaCard usage={data.quotaUsage} />
  </MetricsGrid>
  
  <RatingTrendChart data={data.ratingTrend} />
  
  <ActivityTimeline data={data.recentActivity} />
</DashboardOverview>
```

### Conversations List
```jsx
<ConversationsList>
  {conversations.map(conv => (
    <ConversationCard key={conv.id}>
      <CustomerInfo name={conv.customerName} phone={conv.customerWa} />
      <MessagePreview>{conv.lastMessagePreview}</MessagePreview>
      <TimeAgo>{conv.lastMessageRelative}</TimeAgo>
      {conv.unreadCount > 0 && <Badge>{conv.unreadCount}</Badge>}
      {conv.slaStatus.breached && <AlertBadge>SLA Breach</AlertBadge>}
      <ChannelBadge>{conv.channelDisplay}</ChannelBadge>
    </ConversationCard>
  ))}
</ConversationsList>
```

### Orders Feed
```jsx
<OrdersFeed>
  {orders.map(order => (
    <OrderCard key={order.id}>
      <OrderHeader>
        <OrderRef>{order.orderReference}</OrderRef>
        <StatusBadge status={order.status}>{order.statusDisplay}</StatusBadge>
      </OrderHeader>
      
      <CustomerInfo>{order.customerName}</CustomerInfo>
      <OrderTotal>{order.totalFormatted}</OrderTotal>
      
      {order.alerts.isLate && <Alert type="warning">Order is late</Alert>}
      {order.alerts.awaitingPayment && <Alert type="info">Awaiting payment</Alert>}
      
      <StatusUpdater orderId={order.id} currentStatus={order.status} />
    </OrderCard>
  ))}
</OrdersFeed>
```

### Notifications Bell
```jsx
<NotificationBell>
  <BellIcon>
    {unreadCount > 0 && <Badge>{unreadCount}</Badge>}
  </BellIcon>
  
  <NotificationDropdown>
    {notifications.map(notif => (
      <NotificationItem key={notif.id} severity={notif.severity}>
        <Title>{notif.title}</Title>
        <Message>{notif.message}</Message>
        <Time>{notif.createdAtRelative}</Time>
      </NotificationItem>
    ))}
  </NotificationDropdown>
</NotificationBell>
```

---

## ⚡ Performance Tips

1. **Use Pagination:** All list endpoints support `limit` and `offset`
2. **Cache Data:** Use React Query or SWR for caching
3. **Debounce Searches:** Wait for user to stop typing
4. **Lazy Load:** Load data on scroll or tab activation
5. **Polling Strategy:** Use different intervals for different data
   - Notifications: 30 seconds
   - Orders: 60 seconds
   - Statistics: 5 minutes

**Example with React Query:**
```typescript
import { useQuery } from '@tanstack/react-query';

export const useOrders = (restaurantId: string) => {
  return useQuery({
    queryKey: ['orders', restaurantId],
    queryFn: () => fetchOrders(),
    refetchInterval: 60000, // Refetch every minute
    staleTime: 30000, // Consider data stale after 30s
  });
};
```

---

## 🐛 Error Handling

All endpoints return errors in this format:

```typescript
{
  error: string;
  details?: any;
}
```

**Status Codes:**
- `200` - Success
- `201` - Created
- `400` - Bad Request (missing parameters)
- `401` - Unauthorized (invalid/missing token)
- `403` - Forbidden (no access to resource)
- `404` - Not Found
- `500` - Server Error
- `503` - Service Unavailable

**Example Error Handler:**
```typescript
const handleApiError = (response: Response, data: any) => {
  switch (response.status) {
    case 401:
      // Redirect to login
      window.location.href = '/login';
      break;
    case 403:
      toast.error('You do not have permission to access this resource');
      break;
    case 404:
      toast.error('Resource not found');
      break;
    case 500:
      toast.error('Server error. Please try again later.');
      break;
    default:
      toast.error(data.error || 'An error occurred');
  }
};
```

---

## 📱 Mobile Considerations

1. **Reduce payload size:** Use smaller `limit` values on mobile
2. **Disable auto-refresh:** Battery consideration
3. **Compress images:** Use appropriate quality settings
4. **Touch-friendly UI:** Larger tap targets
5. **Offline support:** Cache critical data

---

## 🔐 Security Best Practices

1. **Never expose tokens in code:** Use environment variables
2. **Store tokens securely:** Use secure storage (not localStorage for sensitive data)
3. **Validate responses:** Don't trust data blindly
4. **Use HTTPS:** Always in production
5. **Implement rate limiting:** On your side too
6. **Log out on 401:** Clear tokens and redirect

---

## 📞 Support & Resources

- **API Reference:** See `DASHBOARD_API_COMPLETE_REFERENCE.md` for detailed endpoint documentation
- **Implementation Details:** See `DASHBOARD_BACKEND_IMPLEMENTATION_SUMMARY.md`
- **Usage Tracking:** See `USAGE_API_CLIENT.md`

---

## ✅ Checklist for Integration

- [ ] Set up environment variables
- [ ] Implement authentication headers
- [ ] Create API client/service layer
- [ ] Implement error handling
- [ ] Add loading states
- [ ] Implement pagination
- [ ] Add i18n support
- [ ] Test with both English and Arabic
- [ ] Implement notifications polling
- [ ] Add real-time updates for orders
- [ ] Test on mobile devices
- [ ] Implement offline handling
- [ ] Add analytics tracking
- [ ] Performance optimization
- [ ] Security audit

---

## 🚦 Getting Started Steps

1. **Set up authentication:**
   ```typescript
   // src/services/api.ts
   const API_URL = process.env.REACT_APP_API_URL;
   const PAT = process.env.REACT_APP_DASHBOARD_PAT;
   
   export const getHeaders = (restaurantId: string) => ({
     'Authorization': `Bearer ${PAT}`,
     'X-Restaurant-Id': restaurantId,
     'Accept-Language': localStorage.getItem('locale') || 'en',
     'Content-Type': 'application/json',
   });
   ```

2. **Create API client:**
   ```typescript
   // src/services/dashboard.ts
   export const dashboardApi = {
     getOverview: (restaurantId) => 
       fetch(`${API_URL}/api/tenants/${restaurantId}/overview`, {
         headers: getHeaders(restaurantId)
       }).then(r => r.json()),
     
     getConversations: (restaurantId, params) =>
       fetch(`${API_URL}/api/conversations/summary?${new URLSearchParams(params)}`, {
         headers: getHeaders(restaurantId)
       }).then(r => r.json()),
     
     // ... more methods
   };
   ```

3. **Use in components:**
   ```typescript
   import { dashboardApi } from './services/dashboard';
   
   function Dashboard() {
     const { data, loading } = useDashboardOverview(restaurantId);
     
     if (loading) return <Spinner />;
     
     return (
       <div>
         <h1>{data.restaurantName}</h1>
         <MetricsGrid data={data} />
       </div>
     );
   }
   ```

---

## 🎉 You're Ready!

You now have everything you need to integrate the dashboard API into your frontend. Start with the overview endpoint, then gradually add more features. Happy coding! 🚀

For questions or issues, refer to the complete API reference documentation.


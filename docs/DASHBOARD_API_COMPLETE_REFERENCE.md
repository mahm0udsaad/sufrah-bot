# Dashboard API - Complete Reference

This document provides a comprehensive reference for the Rich Owner Dashboard API backend implementation. All endpoints are i18n-friendly, support localization, and follow REST conventions.

## Table of Contents

1. [Authentication](#authentication)
2. [Global Endpoints](#global-endpoints)
3. [Bot Management](#bot-management)
4. [Catalog Management](#catalog-management)
5. [Conversations (Chats)](#conversations-chats)
6. [Orders](#orders)
7. [Ratings & Reviews](#ratings--reviews)
8. [Logs & Audit Trail](#logs--audit-trail)
9. [Templates](#templates)
10. [Settings](#settings)
11. [Onboarding](#onboarding)
12. [Notifications](#notifications)
13. [Usage & Quota](#usage--quota)
14. [Admin (Internal)](#admin-internal)
15. [Observability](#observability)

---

## Authentication

All dashboard APIs use one of two authentication methods:

### 1. Personal Access Token (PAT) - For Restaurant-Specific Access

```http
Authorization: Bearer <DASHBOARD_PAT>
X-Restaurant-Id: <restaurant_id>
```

### 2. API Key - For Admin/Internal Access

```http
X-API-Key: <BOT_API_KEY>
```

### Environment Variables

```bash
DASHBOARD_PAT=your-secret-pat-token
BOT_API_KEY=your-admin-api-key
```

---

## Global Endpoints

### Overview Endpoint

Get aggregated metrics for a restaurant dashboard home page.

**GET** `/api/tenants/:restaurantId/overview`

**Query Parameters:**
- `currency` (optional): Currency code (default: `SAR`)

**Response:**
```json
{
  "data": {
    "restaurantId": "rest_123",
    "restaurantName": "Ocean Restaurant",
    "activeConversations": 15,
    "pendingOrders": 8,
    "slaBreaches": 2,
    "quotaUsage": {
      "used": 450,
      "limit": 1000,
      "remaining": 550,
      "percentUsed": 45.0
    },
    "ratingTrend": {
      "averageRating": 4.5,
      "totalRatings": 120,
      "trend": "up",
      "changePercent": 5.2
    },
    "recentActivity": {
      "messagesLast24h": 234,
      "ordersLast24h": 12,
      "conversationsLast24h": 8
    }
  },
  "meta": {
    "locale": "en",
    "currency": "SAR",
    "timestamp": "2025-10-22T10:00:00.000Z"
  }
}
```

---

## Bot Management

### Get Bot Configuration & Health

**GET** `/api/bot`

**Query Parameters:**
- `include_history` (optional): Include message history (default: `false`)
- `history_hours` (optional): Hours of history to include (default: `24`, max: `168`)

**Response:**
```json
{
  "data": {
    "botId": "bot_123",
    "botName": "Ocean Bot",
    "whatsappNumber": "+966500000001",
    "status": "ACTIVE",
    "statusDisplay": "Active",
    "isVerified": true,
    "verifiedAt": "2025-10-15T10:00:00.000Z",
    "lastWebhookAt": "2025-10-22T09:55:00.000Z",
    "webhookHealth": {
      "healthy": true,
      "errorRate": 1.2,
      "requestsLastHour": 150,
      "errorsLastHour": 2
    },
    "rateLimits": {
      "maxMessagesPerMin": 60,
      "maxMessagesPerDay": 1000
    },
    "messagesLastHour": 145,
    "messageHistory": [
      {
        "timestamp": "2025-10-22T09:00:00.000Z",
        "sent": 45,
        "received": 50,
        "total": 95
      }
    ]
  },
  "meta": {
    "locale": "en",
    "currency": "SAR",
    "timestamp": "2025-10-22T10:00:00.000Z"
  }
}
```

### Update Bot Settings

**PATCH** `/api/bot`

**Request Body:**
```json
{
  "maxMessagesPerMin": 80,
  "maxMessagesPerDay": 1500,
  "isActive": true
}
```

**Response:**
```json
{
  "data": {
    "botId": "bot_123",
    "updated": true,
    "changes": {
      "maxMessagesPerMin": 80,
      "maxMessagesPerDay": 1500
    }
  },
  "meta": {
    "locale": "en",
    "currency": "SAR",
    "timestamp": "2025-10-22T10:00:00.000Z"
  }
}
```

---

## Catalog Management

### Get Categories

**GET** `/api/catalog/categories`

**Response:**
```json
{
  "data": {
    "merchantId": "merchant_123",
    "categories": [
      {
        "id": "cat_1",
        "name": "Main Dishes",
        "nameAr": "الأطباق الرئيسية",
        "itemCount": 25,
        "activeItemCount": 23
      }
    ],
    "summary": {
      "totalCategories": 10,
      "totalItems": 150,
      "activeItems": 145,
      "unavailableItems": 5
    },
    "lastSync": "2025-10-22T09:50:00.000Z"
  },
  "meta": {
    "locale": "en",
    "currency": "SAR",
    "timestamp": "2025-10-22T10:00:00.000Z"
  }
}
```

### Get Branches

**GET** `/api/catalog/branches`

**Response:**
```json
{
  "data": {
    "merchantId": "merchant_123",
    "branches": [
      {
        "id": "branch_1",
        "name": "Main Branch",
        "nameAr": "الفرع الرئيسي",
        "address": "123 Main St, Riyadh",
        "city": "Riyadh",
        "phone": "+966500000001",
        "isActive": true
      }
    ],
    "totalBranches": 5,
    "activeBranches": 5,
    "lastSync": "2025-10-22T09:50:00.000Z"
  },
  "meta": {
    "locale": "en",
    "currency": "SAR",
    "timestamp": "2025-10-22T10:00:00.000Z"
  }
}
```

### Get Sync Status

**GET** `/api/catalog/sync-status`

**Response:**
```json
{
  "data": {
    "syncEnabled": true,
    "merchantId": "merchant_123",
    "lastSuccessfulSync": "2025-10-22T09:50:00.000Z",
    "syncStatus": "healthy",
    "pendingJobs": 0,
    "failedJobs": 0
  },
  "meta": {
    "locale": "en",
    "currency": "SAR",
    "timestamp": "2025-10-22T10:00:00.000Z"
  }
}
```

---

## Conversations (Chats)

### Get Conversation Summary

**GET** `/api/conversations/summary`

**Query Parameters:**
- `limit` (optional): Max results (default: `20`, max: `100`)
- `offset` (optional): Pagination offset (default: `0`)

**Response:**
```json
{
  "data": {
    "conversations": [
      {
        "id": "conv_123",
        "customerWa": "+966500000001",
        "customerName": "Ahmed",
        "lastMessageAt": "2025-10-22T09:45:00.000Z",
        "lastMessagePreview": "I'd like to order...",
        "lastMessageRelative": "15 minutes ago",
        "unreadCount": 2,
        "isBotActive": true,
        "channel": "bot",
        "channelDisplay": "Bot",
        "escalated": false,
        "escalatedDisplay": null,
        "slaStatus": {
          "breached": false,
          "minutesRemaining": 0
        }
      }
    ],
    "pagination": {
      "total": 45,
      "limit": 20,
      "offset": 0,
      "hasMore": true
    }
  },
  "meta": {
    "locale": "en",
    "currency": "SAR",
    "timestamp": "2025-10-22T10:00:00.000Z"
  }
}
```

### Get Conversation Transcript

**GET** `/api/conversations/:id/transcript`

**Response:**
```json
{
  "data": {
    "conversationId": "conv_123",
    "customerWa": "+966500000001",
    "customerName": "Ahmed",
    "status": "active",
    "messageCount": 15,
    "messages": [
      {
        "id": "msg_1",
        "direction": "IN",
        "messageType": "text",
        "content": "Hello, I'd like to order",
        "mediaUrl": null,
        "createdAt": "2025-10-22T09:30:00.000Z",
        "createdAtRelative": "30 minutes ago"
      }
    ]
  },
  "meta": {
    "locale": "en",
    "currency": "SAR",
    "timestamp": "2025-10-22T10:00:00.000Z"
  }
}
```

### Export Conversation

**GET** `/api/conversations/:id/export`

**Response:** Plain text file download

### Update Conversation

**PATCH** `/api/conversations/:id`

**Request Body:**
```json
{
  "isBotActive": false,
  "status": "closed",
  "unreadCount": 0
}
```

**Response:**
```json
{
  "data": {
    "conversationId": "conv_123",
    "updated": true,
    "changes": {
      "isBotActive": false,
      "status": "closed"
    }
  },
  "meta": {
    "locale": "en",
    "currency": "SAR",
    "timestamp": "2025-10-22T10:00:00.000Z"
  }
}
```

---

## Orders

### Get Live Order Feed

**GET** `/api/orders/live`

**Query Parameters:**
- `limit` (optional): Max results (default: `20`, max: `100`)
- `offset` (optional): Pagination offset (default: `0`)
- `status` (optional): Filter by status

**Response:**
```json
{
  "data": {
    "orders": [
      {
        "id": "order_123",
        "orderReference": "ORD-20251022-001",
        "status": "PREPARING",
        "statusDisplay": "Preparing",
        "statusStage": 2,
        "customerName": "Ahmed",
        "customerWa": "+966500000001",
        "totalCents": 15000,
        "totalFormatted": "SAR 150.00",
        "currency": "SAR",
        "itemCount": 3,
        "orderType": "delivery",
        "paymentMethod": "cash",
        "branchName": "Main Branch",
        "createdAt": "2025-10-22T09:00:00.000Z",
        "createdAtRelative": "1 hour ago",
        "updatedAt": "2025-10-22T09:30:00.000Z",
        "preparationTime": 60,
        "alerts": {
          "isLate": true,
          "awaitingPayment": false,
          "requiresReview": false
        }
      }
    ],
    "pagination": {
      "total": 150,
      "limit": 20,
      "offset": 0,
      "hasMore": true
    }
  },
  "meta": {
    "locale": "en",
    "currency": "SAR",
    "timestamp": "2025-10-22T10:00:00.000Z"
  }
}
```

### Get Order Details

**GET** `/api/orders/:id`

**Response:**
```json
{
  "data": {
    "id": "order_123",
    "orderReference": "ORD-20251022-001",
    "status": "PREPARING",
    "statusDisplay": "Preparing",
    "statusStage": 2,
    "customer": {
      "name": "Ahmed",
      "phone": "+966500000001"
    },
    "items": [
      {
        "id": "item_1",
        "name": "Grilled Chicken",
        "qty": 2,
        "unitCents": 5000,
        "unitFormatted": "SAR 50.00",
        "totalCents": 10000,
        "totalFormatted": "SAR 100.00"
      }
    ],
    "totalCents": 15000,
    "totalFormatted": "SAR 150.00",
    "currency": "SAR",
    "orderType": "delivery",
    "paymentMethod": "cash",
    "deliveryAddress": "123 Main St, Riyadh",
    "branchName": "Main Branch",
    "branchAddress": "456 Branch St, Riyadh",
    "rating": null,
    "ratingComment": null,
    "ratedAt": null,
    "createdAt": "2025-10-22T09:00:00.000Z",
    "createdAtRelative": "1 hour ago",
    "updatedAt": "2025-10-22T09:30:00.000Z"
  },
  "meta": {
    "locale": "en",
    "currency": "SAR",
    "timestamp": "2025-10-22T10:00:00.000Z"
  }
}
```

### Update Order Status

**PATCH** `/api/orders/:id`

**Request Body:**
```json
{
  "status": "OUT_FOR_DELIVERY",
  "meta": {
    "driverName": "Mohammed",
    "estimatedArrival": "2025-10-22T10:30:00.000Z"
  }
}
```

**Response:**
```json
{
  "data": {
    "orderId": "order_123",
    "updated": true,
    "changes": {
      "status": "OUT_FOR_DELIVERY",
      "statusStage": 3
    },
    "newStatus": "OUT_FOR_DELIVERY",
    "newStatusDisplay": "Out for Delivery"
  },
  "meta": {
    "locale": "en",
    "currency": "SAR",
    "timestamp": "2025-10-22T10:00:00.000Z"
  }
}
```

### Get Order Statistics

**GET** `/api/orders/stats`

**Query Parameters:**
- `days` (optional): Days to include (default: `30`, max: `365`)

**Response:**
```json
{
  "data": {
    "period": {
      "days": 30,
      "startDate": "2025-09-22T10:00:00.000Z",
      "endDate": "2025-10-22T10:00:00.000Z"
    },
    "totalOrders": 150,
    "totalRevenueCents": 450000,
    "totalRevenueFormatted": "SAR 4,500.00",
    "avgPrepTimeMinutes": 35,
    "ordersByStatus": [
      {
        "status": "DELIVERED",
        "statusDisplay": "Delivered",
        "count": 120
      },
      {
        "status": "CANCELLED",
        "statusDisplay": "Cancelled",
        "count": 10
      }
    ]
  },
  "meta": {
    "locale": "en",
    "currency": "SAR",
    "timestamp": "2025-10-22T10:00:00.000Z"
  }
}
```

---

## Ratings & Reviews

### Get Rating Analytics

**GET** `/api/ratings`

**Query Parameters:**
- `days` (optional): Days to include (default: `30`, max: `365`)

**Response:**
```json
{
  "data": {
    "period": {
      "days": 30,
      "startDate": "2025-09-22T10:00:00.000Z",
      "endDate": "2025-10-22T10:00:00.000Z"
    },
    "summary": {
      "totalRatings": 120,
      "averageRating": 4.5,
      "nps": 65,
      "responseRate": 0,
      "trend": "up",
      "changePercent": 5.2
    },
    "distribution": {
      "1": 2,
      "2": 3,
      "3": 5,
      "4": 30,
      "5": 80
    },
    "segments": {
      "promoters": 80,
      "passives": 30,
      "detractors": 10,
      "promotersPercent": 67,
      "passivesPercent": 25,
      "detractorsPercent": 8
    },
    "withComments": 45
  },
  "meta": {
    "locale": "en",
    "currency": "SAR",
    "timestamp": "2025-10-22T10:00:00.000Z"
  }
}
```

### Get Reviews with Comments

**GET** `/api/ratings/reviews`

**Query Parameters:**
- `limit` (optional): Max results (default: `20`, max: `100`)
- `offset` (optional): Pagination offset (default: `0`)
- `min_rating` (optional): Minimum rating (default: `1`)
- `max_rating` (optional): Maximum rating (default: `10`)
- `with_comments` (optional): Only reviews with comments (default: `false`)

**Response:**
```json
{
  "data": {
    "reviews": [
      {
        "orderId": "order_123",
        "orderReference": "ORD-20251022-001",
        "rating": 5,
        "comment": "Excellent service and food!",
        "customer": {
          "name": "Ahmed",
          "phone": "+966500000001"
        },
        "branchName": "Main Branch",
        "ratedAt": "2025-10-22T08:00:00.000Z",
        "ratedAtRelative": "2 hours ago",
        "orderCreatedAt": "2025-10-21T20:00:00.000Z"
      }
    ],
    "pagination": {
      "total": 45,
      "limit": 20,
      "offset": 0,
      "hasMore": true
    }
  },
  "meta": {
    "locale": "en",
    "currency": "SAR",
    "timestamp": "2025-10-22T10:00:00.000Z"
  }
}
```

### Get Rating Timeline

**GET** `/api/ratings/timeline`

**Query Parameters:**
- `days` (optional): Days to include (default: `30`, max: `365`)

**Response:**
```json
{
  "data": {
    "timeline": [
      {
        "date": "2025-10-22",
        "count": 5,
        "average": 4.6,
        "nps": 70
      },
      {
        "date": "2025-10-21",
        "count": 8,
        "average": 4.4,
        "nps": 60
      }
    ]
  },
  "meta": {
    "locale": "en",
    "currency": "SAR",
    "timestamp": "2025-10-22T10:00:00.000Z"
  }
}
```

---

## Logs & Audit Trail

### Get Logs

**GET** `/api/logs`

**Query Parameters:**
- `limit` (optional): Max results (default: `50`, max: `500`)
- `offset` (optional): Pagination offset (default: `0`)
- `event_type` (optional): Filter by event type
- `severity` (optional): Filter by severity (`info`, `warning`, `error`)
- `start_date` (optional): ISO 8601 date
- `end_date` (optional): ISO 8601 date

**Response:**
```json
{
  "data": {
    "logs": [
      {
        "id": "log_123",
        "requestId": "req_abc",
        "method": "POST",
        "path": "/whatsapp/webhook",
        "statusCode": 200,
        "errorMessage": null,
        "severity": "info",
        "correlatedOrderId": null,
        "correlatedMessageSid": "SM123",
        "responseLatency": null,
        "createdAt": "2025-10-22T09:55:00.000Z",
        "createdAtRelative": "5 minutes ago",
        "preview": "New message received"
      }
    ],
    "pagination": {
      "total": 1500,
      "limit": 50,
      "offset": 0,
      "hasMore": true
    },
    "retentionPolicy": {
      "days": 90,
      "message": "Logs are retained for 90 days"
    }
  },
  "meta": {
    "locale": "en",
    "currency": "SAR",
    "timestamp": "2025-10-22T10:00:00.000Z"
  }
}
```

### Get Single Log

**GET** `/api/logs/:id`

### Export Logs (Compliance)

**GET** `/api/logs/export`

**Query Parameters:**
- `start_date` (required): ISO 8601 date
- `end_date` (required): ISO 8601 date

**Response:** CSV file download

### Get Log Statistics

**GET** `/api/logs/stats`

**Query Parameters:**
- `hours` (optional): Hours to include (default: `24`, max: `168`)

**Response:**
```json
{
  "data": {
    "period": {
      "hours": 24,
      "startDate": "2025-10-21T10:00:00.000Z",
      "endDate": "2025-10-22T10:00:00.000Z"
    },
    "totalLogs": 1500,
    "errorLogs": 15,
    "warningLogs": 30,
    "successLogs": 1455,
    "errorRate": 1.0
  },
  "meta": {
    "locale": "en",
    "currency": "SAR",
    "timestamp": "2025-10-22T10:00:00.000Z"
  }
}
```

---

## Templates

### List Templates

**GET** `/api/templates`

**Query Parameters:**
- `limit` (optional): Max results (default: `50`, max: `200`)
- `offset` (optional): Pagination offset (default: `0`)
- `status` (optional): Filter by status
- `category` (optional): Filter by category

**Response:**
```json
{
  "data": {
    "templates": [
      {
        "id": "tpl_123",
        "name": "welcome_message",
        "category": "marketing",
        "language": "en",
        "status": "approved",
        "statusDisplay": "Approved",
        "templateSid": "HX123",
        "usageCount": 150,
        "lastUsed": "2025-10-22T09:00:00.000Z",
        "lastUsedRelative": "1 hour ago",
        "createdAt": "2025-10-01T10:00:00.000Z",
        "updatedAt": "2025-10-15T10:00:00.000Z",
        "hasVariables": true
      }
    ],
    "pagination": {
      "total": 25,
      "limit": 50,
      "offset": 0,
      "hasMore": false
    }
  },
  "meta": {
    "locale": "en",
    "currency": "SAR",
    "timestamp": "2025-10-22T10:00:00.000Z"
  }
}
```

### Get Template Details

**GET** `/api/templates/:id`

### Create Template

**POST** `/api/templates`

**Request Body:**
```json
{
  "name": "new_promotion",
  "category": "marketing",
  "language": "en",
  "body_text": "Check out our special offer!",
  "footer_text": "Reply STOP to unsubscribe",
  "variables": ["{{1}}", "{{2}}"]
}
```

### Update Template

**PATCH** `/api/templates/:id`

### Delete Template

**DELETE** `/api/templates/:id`

### Get Template Cache Metrics

**GET** `/api/templates/cache/metrics`

**Response:**
```json
{
  "data": {
    "totalEntries": 450,
    "uniqueTemplates": 25,
    "cacheHitRate": 85.5,
    "avgRetrievalTime": 12.5
  },
  "meta": {
    "locale": "en",
    "currency": "SAR",
    "timestamp": "2025-10-22T10:00:00.000Z"
  }
}
```

---

## Settings

### Get Restaurant Profile

**GET** `/api/settings/profile`

**Response:**
```json
{
  "data": {
    "id": "rest_123",
    "name": "Ocean Restaurant",
    "description": "Finest seafood in town",
    "address": "123 Main St, Riyadh",
    "phone": "+966500000001",
    "whatsappNumber": "+966500000002",
    "logoUrl": "https://example.com/logo.png",
    "isActive": true,
    "status": "ACTIVE",
    "owner": {
      "name": "Ahmed Al-Rahman",
      "phone": "+966500000001",
      "email": "ahmed@example.com"
    },
    "bot": {
      "whatsappNumber": "+966500000002",
      "supportContact": "+966500000003",
      "paymentLink": "https://pay.example.com"
    },
    "externalMerchantId": "merchant_123",
    "createdAt": "2025-09-01T10:00:00.000Z",
    "updatedAt": "2025-10-15T10:00:00.000Z"
  },
  "meta": {
    "locale": "en",
    "currency": "SAR",
    "timestamp": "2025-10-22T10:00:00.000Z"
  }
}
```

### Update Restaurant Profile

**PATCH** `/api/settings/profile`

**Request Body:**
```json
{
  "name": "Ocean Restaurant & Grill",
  "description": "Updated description",
  "address": "456 New St, Riyadh",
  "phone": "+966500000005",
  "logoUrl": "https://example.com/new-logo.png"
}
```

### Get Audit Logs

**GET** `/api/settings/audit-logs`

**Query Parameters:**
- `limit` (optional): Max results (default: `50`, max: `200`)
- `offset` (optional): Pagination offset (default: `0`)

**Response:**
```json
{
  "data": {
    "logs": [
      {
        "id": "audit_123",
        "action": "profile_updated",
        "details": {
          "field": "name",
          "oldValue": "Ocean Restaurant",
          "newValue": "Ocean Restaurant & Grill"
        },
        "createdAt": "2025-10-22T09:00:00.000Z"
      }
    ],
    "pagination": {
      "total": 150,
      "limit": 50,
      "offset": 0,
      "hasMore": true
    }
  },
  "meta": {
    "locale": "en",
    "currency": "SAR",
    "timestamp": "2025-10-22T10:00:00.000Z"
  }
}
```

---

## Onboarding

### Get Onboarding Progress

**GET** `/api/onboarding`

**Response:**
```json
{
  "data": {
    "status": "ACTIVE",
    "progress": {
      "completed": 5,
      "total": 6,
      "percent": 83
    },
    "checklist": [
      {
        "id": "profile",
        "title": "Complete Restaurant Profile",
        "description": "Add your restaurant name, address, and contact information",
        "completed": true,
        "required": true
      },
      {
        "id": "first_order",
        "title": "Process First Order",
        "description": "Complete your first order through the bot",
        "completed": false,
        "required": false
      }
    ],
    "verification": {
      "userVerified": true,
      "botVerified": true,
      "timeline": [
        {
          "step": "Bot Created",
          "status": "completed",
          "timestamp": "2025-09-15T10:00:00.000Z"
        },
        {
          "step": "Verified",
          "status": "completed",
          "timestamp": "2025-09-15T11:00:00.000Z"
        }
      ]
    },
    "currentBot": {
      "whatsappNumber": "+966500000001",
      "status": "ACTIVE",
      "verifiedAt": "2025-09-15T11:00:00.000Z"
    }
  },
  "meta": {
    "locale": "en",
    "currency": "SAR",
    "timestamp": "2025-10-22T10:00:00.000Z"
  }
}
```

### Get Available Phone Numbers

**GET** `/api/onboarding/phone-numbers`

**Query Parameters:**
- `country_code` (optional): Country code (default: `SA`)

**Response:**
```json
{
  "data": {
    "countryCode": "SA",
    "numbers": [
      {
        "phoneNumber": "+966500000001",
        "friendlyName": "Saudi Arabia +966 500-000-001",
        "countryCode": "SA",
        "capabilities": ["SMS", "WhatsApp"],
        "monthlyCost": 100,
        "currency": "SAR",
        "available": true
      }
    ],
    "note": "Phone numbers are subject to availability. Contact support to complete provisioning."
  },
  "meta": {
    "locale": "en",
    "currency": "SAR",
    "timestamp": "2025-10-22T10:00:00.000Z"
  }
}
```

---

## Notifications

### Get Notification Feed

**GET** `/api/notifications`

**Query Parameters:**
- `include_read` (optional): Include read notifications (default: `false`)

**Response:**
```json
{
  "data": {
    "notifications": [
      {
        "id": "notif_123",
        "type": "new_order",
        "severity": "info",
        "title": "New Orders",
        "message": "You have 3 new orders awaiting confirmation",
        "data": {
          "count": 3
        },
        "read": false,
        "createdAt": "2025-10-22T09:55:00.000Z",
        "createdAtRelative": "5 minutes ago"
      },
      {
        "id": "notif_124",
        "type": "quota_warning",
        "severity": "warning",
        "title": "Quota Warning",
        "message": "You've used 85% of your monthly quota",
        "data": {
          "usagePercent": 85,
          "remaining": 150
        },
        "read": false,
        "createdAt": "2025-10-22T09:00:00.000Z",
        "createdAtRelative": "1 hour ago"
      }
    ],
    "unreadCount": 5,
    "totalCount": 12
  },
  "meta": {
    "locale": "en",
    "currency": "SAR",
    "timestamp": "2025-10-22T10:00:00.000Z"
  }
}
```

**Notification Types:**
- `new_order`: New orders received
- `failed_send`: Messages failed to send
- `quota_warning`: Approaching quota limits
- `template_expiring`: Templates about to expire
- `sla_breach`: Conversations exceeding SLA
- `webhook_error`: Webhook errors occurred

---

## Usage & Quota

The existing `/api/usage` endpoint has been enhanced. See [USAGE_API_CLIENT.md](./USAGE_API_CLIENT.md) for complete documentation.

---

## Admin (Internal)

### Get System Metrics

**GET** `/api/admin/metrics`

**Authentication:** Requires `X-API-Key` header

**Response:**
```json
{
  "data": {
    "overview": {
      "totalRestaurants": 50,
      "activeRestaurants": 45,
      "totalBots": 48,
      "activeBots": 43,
      "botVerificationRate": 90
    },
    "activity": {
      "conversationsLast24h": 450,
      "messagesLast24h": 2500,
      "ordersLast24h": 120,
      "avgMessagesPerConversation": 5
    },
    "health": {
      "webhookErrorsLast24h": 15,
      "webhookErrorRate": 0.6,
      "redisHealth": {
        "connected": true,
        "latency": 2
      },
      "queueMetrics": {
        "whatsappSendQueue": {
          "length": 45,
          "healthy": true
        },
        "outboundQueue": {
          "length": 12,
          "healthy": true
        }
      }
    },
    "templateCache": {
      "totalEntries": 1250,
      "uniqueTemplates": 75,
      "cacheHitRate": 87.5
    },
    "onboardingFunnel": {
      "registered": 50,
      "profileCompleted": 48,
      "botSetup": 48,
      "botVerified": 43,
      "firstOrder": 38
    },
    "restaurantsByStatus": [
      {
        "status": "ACTIVE",
        "count": 45
      },
      {
        "status": "PENDING_APPROVAL",
        "count": 5
      }
    ]
  },
  "meta": {
    "locale": "en",
    "currency": "SAR",
    "timestamp": "2025-10-22T10:00:00.000Z"
  }
}
```

### List All Restaurants

**GET** `/api/admin/restaurants`

**Authentication:** Requires `X-API-Key` header

**Query Parameters:**
- `limit` (optional): Max results (default: `20`, max: `100`)
- `offset` (optional): Pagination offset (default: `0`)

**Response:**
```json
{
  "data": {
    "restaurants": [
      {
        "id": "rest_123",
        "name": "Ocean Restaurant",
        "status": "ACTIVE",
        "isActive": true,
        "bot": {
          "status": "ACTIVE",
          "verifiedAt": "2025-09-15T11:00:00.000Z",
          "whatsappNumber": "+966500000001"
        },
        "metrics": {
          "totalConversations": 450,
          "totalOrders": 120,
          "totalMessages": 2500
        },
        "createdAt": "2025-09-01T10:00:00.000Z"
      }
    ],
    "pagination": {
      "total": 50,
      "limit": 20,
      "offset": 0,
      "hasMore": true
    }
  },
  "meta": {
    "locale": "en",
    "currency": "SAR",
    "timestamp": "2025-10-22T10:00:00.000Z"
  }
}
```

---

## Observability

### Health Check

**GET** `/api/health`

**Authentication:** Optional. Public access returns limited info, API key returns detailed metrics.

**Response (Public):**
```json
{
  "data": {
    "status": "healthy",
    "timestamp": "2025-10-22T10:00:00.000Z",
    "services": {
      "database": "ok",
      "redis": "ok"
    }
  },
  "meta": {
    "locale": "en",
    "currency": "SAR",
    "timestamp": "2025-10-22T10:00:00.000Z"
  }
}
```

**Response (Authenticated):**
```json
{
  "data": {
    "status": "healthy",
    "timestamp": "2025-10-22T10:00:00.000Z",
    "services": {
      "database": {
        "healthy": true,
        "latency": 5
      },
      "redis": {
        "healthy": true,
        "latency": 2
      },
      "queues": {
        "whatsappSendQueue": {
          "length": 45,
          "healthy": true
        },
        "outboundQueue": {
          "length": 12,
          "healthy": true
        }
      },
      "webhooks": {
        "totalLast1h": 150,
        "errorsLast1h": 2,
        "errorRate": 1.3,
        "healthy": true
      }
    },
    "uptime": 345678,
    "memory": {
      "used": 245,
      "total": 512,
      "unit": "MB"
    }
  },
  "meta": {
    "locale": "en",
    "currency": "SAR",
    "timestamp": "2025-10-22T10:00:00.000Z"
  }
}
```

### Readiness Check

**GET** `/api/health/ready`

Returns 200 if the service is ready to accept requests, 503 otherwise.

### Liveness Check

**GET** `/api/health/live`

Returns 200 if the service is alive.

---

## Internationalization

All endpoints support localization through the `Accept-Language` header:

```http
Accept-Language: ar
```

Supported locales:
- `en` - English
- `ar` - Arabic

All responses include localized:
- Status labels
- Currency formatting
- Date/time formatting
- Number formatting
- Display strings

---

## Response Format

All dashboard APIs return responses in this format:

```json
{
  "data": { /* response data */ },
  "meta": {
    "locale": "en",
    "currency": "SAR",
    "timestamp": "2025-10-22T10:00:00.000Z"
  }
}
```

Pagination is included where applicable:

```json
{
  "pagination": {
    "total": 150,
    "limit": 20,
    "offset": 0,
    "hasMore": true
  }
}
```

---

## Error Responses

All errors follow this format:

```json
{
  "error": "Error message",
  "details": { /* optional error details */ }
}
```

Common status codes:
- `200` - Success
- `201` - Created
- `400` - Bad Request
- `401` - Unauthorized
- `403` - Forbidden
- `404` - Not Found
- `500` - Internal Server Error
- `503` - Service Unavailable

---

## Rate Limiting

All endpoints respect the bot's rate limits configured in the database:
- `maxMessagesPerMin` - Maximum messages per minute
- `maxMessagesPerDay` - Maximum messages per day

Rate limit information is available via the `/api/bot` endpoint.

---

## WebSocket Support (Future)

The `/api/notifications` endpoint will support WebSocket connections for real-time push notifications in a future update. Current implementation provides polling-based notifications.

---

## Implementation Notes

### Services

1. **i18n Service** (`src/services/i18n.ts`)
   - Provides localization utilities
   - Currency formatting
   - Date/time formatting
   - Localized string lookups

2. **Dashboard Metrics Service** (`src/services/dashboardMetrics.ts`)
   - Aggregates metrics for overview
   - Bot health monitoring
   - Conversation summaries
   - Order feeds

### API Routes

All dashboard routes are organized under `src/server/routes/dashboard/`:
- `tenants.ts` - Overview endpoint
- `bot.ts` - Bot management
- `conversations.ts` - Conversations/chats
- `orders.ts` - Order management
- `ratings.ts` - Ratings & reviews
- `logs.ts` - Logs & audit trail
- `catalog.ts` - Catalog management
- `templates.ts` - Template management
- `settings.ts` - Settings & profile
- `notifications.ts` - Notifications
- `onboarding.ts` - Onboarding
- `admin.ts` - Admin metrics
- `health.ts` - Health checks

### Database Schema

All endpoints use the existing Prisma schema. Key models:
- `Restaurant` - Restaurant profile
- `RestaurantBot` - Bot configuration
- `Conversation` - Customer conversations
- `Message` - Individual messages
- `Order` - Orders and items
- `WebhookLog` - Webhook logs
- `Template` - Message templates
- `ContentTemplateCache` - Template cache
- `MonthlyUsage` - Usage tracking
- `UsageLog` - Audit logs

---

## Testing

Use the following curl commands to test the endpoints:

```bash
# Get overview
curl -H "Authorization: Bearer $DASHBOARD_PAT" \
     -H "X-Restaurant-Id: rest_123" \
     http://localhost:3000/api/tenants/rest_123/overview

# Get bot configuration
curl -H "Authorization: Bearer $DASHBOARD_PAT" \
     -H "X-Restaurant-Id: rest_123" \
     http://localhost:3000/api/bot

# Get conversations
curl -H "Authorization: Bearer $DASHBOARD_PAT" \
     -H "X-Restaurant-Id: rest_123" \
     http://localhost:3000/api/conversations/summary

# Get health (public)
curl http://localhost:3000/api/health

# Get admin metrics
curl -H "X-API-Key: $BOT_API_KEY" \
     http://localhost:3000/api/admin/metrics
```

---

## Next Steps

1. Implement WebSocket support for real-time notifications
2. Add more granular permissions/roles for team members
3. Implement sentiment analysis for conversation transcripts
4. Add more advanced analytics and reporting
5. Implement notification preferences and subscriptions
6. Add batch operations for orders and conversations
7. Implement export to other formats (JSON, Excel)
8. Add more filtering and search capabilities

---

## Support

For questions or issues with the Dashboard API, please refer to:
- [Implementation Summary](./IMPLEMENTATION_SUMMARY.md)
- [Queue & Cache Reference](./QUEUE_AND_CACHE_QUICK_REFERENCE.md)
- [Usage API Client](./USAGE_API_CLIENT.md)


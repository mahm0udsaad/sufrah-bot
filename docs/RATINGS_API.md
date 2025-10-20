# Ratings API Documentation

This document describes the customer ratings feature and how to integrate it into the dashboard.

## Overview

The WhatsApp bot now collects and persists customer ratings after order completion. Customers can rate their orders on a scale of 1-5 stars and optionally provide comments. The ratings data is stored in the PostgreSQL database and accessible via REST API endpoints.

## Database Schema

### Order Table Fields

The `Order` model includes the following rating-related fields:

```prisma
model Order {
  // ... other fields ...
  
  rating          Int?         @map("rating")           // Rating value 1-5
  ratingComment   String?      @map("rating_comment")   // Optional customer comment
  ratedAt         DateTime?    @map("rated_at")         // When customer submitted rating
  ratingAskedAt   DateTime?    @map("rating_asked_at")  // When bot sent rating prompt
  
  // ... other fields ...
}
```

**Field Descriptions:**
- `rating`: Integer between 1-5 (null if not rated)
- `ratingComment`: Optional text comment from customer (null if skipped)
- `ratedAt`: Timestamp when customer completed the rating
- `ratingAskedAt`: Timestamp when the bot sent the rating prompt

## Rating Flow

1. **Order Completion**: When an order is submitted (cash payment) or payment is confirmed (online payment), the bot automatically sends a rating prompt to the customer
2. **Customer Responds**: Customer selects a rating from 1-5 stars using the interactive list picker, or sends a plain text number
3. **Optional Comment**: Bot asks if customer wants to add a comment
4. **Persistence**: Rating and comment are saved to the database with timestamp

## API Endpoints

All endpoints require authentication via the `Authorization` header with the dashboard PAT token and `X-Restaurant-ID` header.

### Authentication Headers

```http
Authorization: Bearer YOUR_DASHBOARD_PAT_TOKEN
X-Restaurant-ID: your-restaurant-id
```

---

### 1. List All Ratings

Get a paginated list of all ratings for your restaurant.

**Endpoint:** `GET /api/db/ratings`

**Query Parameters:**
- `limit` (optional): Number of results per page (default: 50, max: 100)
- `offset` (optional): Pagination offset (default: 0)
- `minRating` (optional): Filter by minimum rating (1-5)
- `maxRating` (optional): Filter by maximum rating (1-5)

**Example Request:**
```bash
curl -X GET "https://your-domain.com/api/db/ratings?limit=20&offset=0&minRating=4" \
  -H "Authorization: Bearer YOUR_PAT_TOKEN" \
  -H "X-Restaurant-ID: clxxxxxxxxxxxxx"
```

**Example Response:**
```json
[
  {
    "id": "cm123abc456",
    "orderReference": "12345",
    "orderNumber": 67890,
    "restaurantId": "clxxxxxxxxxxxxx",
    "conversationId": "cm456def789",
    "customerPhone": "966501234567",
    "customerName": "أحمد محمد",
    "rating": 5,
    "ratingComment": "خدمة ممتازة والطعام لذيذ جداً!",
    "ratedAt": "2025-10-20T14:30:00.000Z",
    "ratingAskedAt": "2025-10-20T14:25:00.000Z",
    "orderType": "Delivery",
    "paymentMethod": "Cash",
    "totalCents": 8500,
    "currency": "SAR",
    "branchId": "branch-123",
    "branchName": "الفرع الرئيسي",
    "orderCreatedAt": "2025-10-20T13:00:00.000Z"
  },
  {
    "id": "cm789ghi012",
    "orderReference": "12346",
    "orderNumber": 67891,
    "restaurantId": "clxxxxxxxxxxxxx",
    "conversationId": "cm345jkl678",
    "customerPhone": "966509876543",
    "customerName": "فاطمة علي",
    "rating": 3,
    "ratingComment": "الطلب تأخر قليلاً",
    "ratedAt": "2025-10-20T15:45:00.000Z",
    "ratingAskedAt": "2025-10-20T15:40:00.000Z",
    "orderType": "Takeaway",
    "paymentMethod": "Online",
    "totalCents": 4500,
    "currency": "SAR",
    "branchId": "branch-456",
    "branchName": "فرع الشمال",
    "orderCreatedAt": "2025-10-20T14:30:00.000Z"
  }
]
```

---

### 2. Get Rating Statistics

Get aggregated rating statistics for your restaurant.

**Endpoint:** `GET /api/db/ratings/stats`

**Query Parameters:** None

**Example Request:**
```bash
curl -X GET "https://your-domain.com/api/db/ratings/stats" \
  -H "Authorization: Bearer YOUR_PAT_TOKEN" \
  -H "X-Restaurant-ID: clxxxxxxxxxxxxx"
```

**Example Response:**
```json
{
  "totalRatings": 150,
  "averageRating": 4.35,
  "distribution": {
    "1": 5,
    "2": 8,
    "3": 22,
    "4": 45,
    "5": 70
  }
}
```

**Response Fields:**
- `totalRatings`: Total number of orders that have been rated
- `averageRating`: Average rating across all rated orders (rounded to 2 decimals)
- `distribution`: Count of ratings for each star level (1-5)

---

### 3. Get Single Rating Details

Get detailed information about a specific rating, including order items.

**Endpoint:** `GET /api/db/ratings/:id`

**Path Parameters:**
- `id`: The order ID (from the `id` field in list response)

**Example Request:**
```bash
curl -X GET "https://your-domain.com/api/db/ratings/cm123abc456" \
  -H "Authorization: Bearer YOUR_PAT_TOKEN" \
  -H "X-Restaurant-ID: clxxxxxxxxxxxxx"
```

**Example Response:**
```json
{
  "id": "cm123abc456",
  "orderReference": "12345",
  "orderNumber": 67890,
  "restaurantId": "clxxxxxxxxxxxxx",
  "conversationId": "cm456def789",
  "customerPhone": "966501234567",
  "customerName": "أحمد محمد",
  "rating": 5,
  "ratingComment": "خدمة ممتازة والطعم لذيذ جداً!",
  "ratedAt": "2025-10-20T14:30:00.000Z",
  "ratingAskedAt": "2025-10-20T14:25:00.000Z",
  "orderType": "Delivery",
  "paymentMethod": "Cash",
  "totalCents": 8500,
  "currency": "SAR",
  "branchId": "branch-123",
  "branchName": "الفرع الرئيسي",
  "orderCreatedAt": "2025-10-20T13:00:00.000Z",
  "items": [
    {
      "id": "cm123abc456-prod-001",
      "name": "برجر لحم",
      "quantity": 2,
      "unitCents": 2500,
      "totalCents": 5000
    },
    {
      "id": "cm123abc456-prod-002",
      "name": "بطاطس مقلية كبيرة",
      "quantity": 1,
      "unitCents": 1500,
      "totalCents": 1500
    }
  ]
}
```

---

## Dashboard Integration Guide

### Recommended Views

#### 1. Ratings Overview Tab

Create a dedicated "Ratings" or "التقييمات" tab in your dashboard with:

**Summary Cards:**
- Total Ratings Count
- Average Rating (with star visualization)
- Positive Ratings (4-5 stars) Percentage
- Negative Ratings (1-3 stars) Count

**Rating Distribution Chart:**
- Bar or pie chart showing distribution across 1-5 stars
- Use the `/api/db/ratings/stats` endpoint

**Recent Ratings List:**
- Table showing recent ratings with:
  - Order Number
  - Customer Name (optional, consider privacy)
  - Rating (star display)
  - Comment excerpt
  - Date/Time
  - Order Type
  - Total Amount
  - View Details button

#### 2. Ratings Detail Modal/Page

When user clicks a rating, show:
- Full customer information (respecting privacy settings)
- Complete order details with items
- Full rating comment
- Order timeline (created, asked for rating, rated)
- Branch information
- Payment method

#### 3. Filtering Options

Allow filtering by:
- Rating value (1-5 stars, range, or exact)
- Date range (ratedAt)
- Order type (Delivery, Takeaway, etc.)
- Branch (if multi-branch)
- With/without comments

#### 4. Export Functionality

Provide CSV/Excel export with columns:
- Order Number
- Customer Phone (masked for privacy)
- Customer Name
- Rating
- Comment
- Order Date
- Rated Date
- Order Type
- Total Amount
- Branch

### Example React/TypeScript Implementation

```typescript
// types.ts
interface Rating {
  id: string;
  orderReference: string | null;
  orderNumber: number | null;
  restaurantId: string;
  conversationId: string;
  customerPhone: string;
  customerName: string | null;
  rating: number;
  ratingComment: string | null;
  ratedAt: string;
  ratingAskedAt: string | null;
  orderType: string | null;
  paymentMethod: string | null;
  totalCents: number;
  currency: string;
  branchId: string | null;
  branchName: string | null;
  orderCreatedAt: string;
}

interface RatingStats {
  totalRatings: number;
  averageRating: number;
  distribution: {
    1: number;
    2: number;
    3: number;
    4: number;
    5: number;
  };
}

// api.ts
const API_BASE = 'https://your-domain.com';
const PAT_TOKEN = 'your-pat-token';
const RESTAURANT_ID = 'your-restaurant-id';

async function fetchRatings(params?: {
  limit?: number;
  offset?: number;
  minRating?: number;
  maxRating?: number;
}): Promise<Rating[]> {
  const queryParams = new URLSearchParams();
  if (params?.limit) queryParams.set('limit', params.limit.toString());
  if (params?.offset) queryParams.set('offset', params.offset.toString());
  if (params?.minRating) queryParams.set('minRating', params.minRating.toString());
  if (params?.maxRating) queryParams.set('maxRating', params.maxRating.toString());

  const response = await fetch(
    `${API_BASE}/api/db/ratings?${queryParams}`,
    {
      headers: {
        'Authorization': `Bearer ${PAT_TOKEN}`,
        'X-Restaurant-ID': RESTAURANT_ID,
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch ratings: ${response.statusText}`);
  }

  return response.json();
}

async function fetchRatingStats(): Promise<RatingStats> {
  const response = await fetch(`${API_BASE}/api/db/ratings/stats`, {
    headers: {
      'Authorization': `Bearer ${PAT_TOKEN}`,
      'X-Restaurant-ID': RESTAURANT_ID,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch rating stats: ${response.statusText}`);
  }

  return response.json();
}

async function fetchRatingDetail(ratingId: string): Promise<Rating> {
  const response = await fetch(
    `${API_BASE}/api/db/ratings/${ratingId}`,
    {
      headers: {
        'Authorization': `Bearer ${PAT_TOKEN}`,
        'X-Restaurant-ID': RESTAURANT_ID,
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch rating detail: ${response.statusText}`);
  }

  return response.json();
}

// RatingsPage.tsx (Example React Component)
import React, { useEffect, useState } from 'react';

export function RatingsPage() {
  const [ratings, setRatings] = useState<Rating[]>([]);
  const [stats, setStats] = useState<RatingStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      try {
        const [ratingsData, statsData] = await Promise.all([
          fetchRatings({ limit: 20 }),
          fetchRatingStats(),
        ]);
        setRatings(ratingsData);
        setStats(statsData);
      } catch (error) {
        console.error('Failed to load ratings:', error);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  if (loading) return <div>Loading...</div>;

  return (
    <div className="ratings-page">
      <h1>Customer Ratings</h1>
      
      {/* Stats Cards */}
      <div className="stats-grid">
        <div className="stat-card">
          <h3>Total Ratings</h3>
          <p className="stat-value">{stats?.totalRatings || 0}</p>
        </div>
        <div className="stat-card">
          <h3>Average Rating</h3>
          <p className="stat-value">
            {'⭐'.repeat(Math.round(stats?.averageRating || 0))}
            {' '}
            {stats?.averageRating.toFixed(2)}
          </p>
        </div>
      </div>

      {/* Ratings Table */}
      <table className="ratings-table">
        <thead>
          <tr>
            <th>Order #</th>
            <th>Customer</th>
            <th>Rating</th>
            <th>Comment</th>
            <th>Date</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {ratings.map((rating) => (
            <tr key={rating.id}>
              <td>{rating.orderNumber || rating.orderReference}</td>
              <td>{rating.customerName || 'Guest'}</td>
              <td>{'⭐'.repeat(rating.rating)}</td>
              <td>{rating.ratingComment?.substring(0, 50) || '-'}</td>
              <td>{new Date(rating.ratedAt).toLocaleDateString()}</td>
              <td>{(rating.totalCents / 100).toFixed(2)} {rating.currency}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

---

## Error Handling

### Common Error Responses

**401 Unauthorized**
```json
{
  "error": "Unauthorized"
}
```
- Check that your Authorization header includes a valid PAT token
- Verify X-Restaurant-ID header is present

**404 Not Found**
```json
{
  "error": "Rating not found"
}
```
- The requested rating ID doesn't exist or doesn't belong to your restaurant

**500 Internal Server Error**
```json
{
  "error": "Failed to fetch ratings"
}
```
- Server-side error, contact support if persistent

---

## Data Privacy Considerations

When displaying customer information:
1. **Customer Phone Numbers**: Consider masking (e.g., `966501234567` → `966501****67`)
2. **Customer Names**: Display only if customer gave consent
3. **Comments**: May contain personal information - handle appropriately
4. **Export**: Ensure compliance with local data protection laws

---

## Performance Tips

1. **Pagination**: Always use `limit` and `offset` for large datasets
2. **Caching**: Cache statistics data for 5-10 minutes to reduce load
3. **Filtering**: Use query parameters to reduce response size
4. **Lazy Loading**: Load rating details only when user clicks on a specific rating

---

## Support

For questions or issues with the Ratings API:
- Check the main bot logs for errors
- Verify database connectivity
- Ensure all migrations have been applied
- Review the bot's rating capture logic in `src/handlers/processMessage.ts`

---

## Changelog

### Version 1.0 (October 2025)
- Initial ratings API implementation
- Support for 1-5 star ratings
- Optional customer comments
- Statistics endpoint
- Filtering by rating value


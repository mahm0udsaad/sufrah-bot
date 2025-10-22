# Usage Dashboard API Client

## Overview
This document provides TypeScript client code and a reference React component for consuming the Usage API.

## API Endpoints

### GET /api/usage
Returns usage statistics for restaurants.

**Authentication:**
- PAT with `X-Restaurant-Id` header (single restaurant)
- API Key header (admin, all restaurants)

**Query Parameters:**
- `limit` (number, default: 20, max: 100) - Results per page
- `offset` (number, default: 0) - Pagination offset

**Response (Admin):**
```json
{
  "data": [
    {
      "restaurantId": "cuid123",
      "restaurantName": "Example Restaurant",
      "conversationsThisMonth": 45,
      "lastConversationAt": "2025-10-20T15:30:00.000Z",
      "allowance": {
        "dailyLimit": 1000,
        "dailyRemaining": 1000,
        "monthlyLimit": 30000,
        "monthlyRemaining": 29955
      },
      "firstActivity": "2025-09-01T08:00:00.000Z",
      "lastActivity": "2025-10-20T15:30:00.000Z",
      "isActive": true
    }
  ],
  "pagination": {
    "total": 150,
    "limit": 20,
    "offset": 0,
    "hasMore": true
  }
}
```

**Response (Single Restaurant with PAT):**
```json
{
  "restaurantId": "cuid123",
  "restaurantName": "Example Restaurant",
  "conversationsThisMonth": 45,
  "lastConversationAt": "2025-10-20T15:30:00.000Z",
  "allowance": {
    "dailyLimit": 1000,
    "dailyRemaining": 1000,
    "monthlyLimit": 30000,
    "monthlyRemaining": 29955
  },
  "firstActivity": "2025-09-01T08:00:00.000Z",
  "lastActivity": "2025-10-20T15:30:00.000Z",
  "isActive": true
}
```

### GET /api/usage/:restaurantId
Returns detailed usage stats for a specific restaurant, including 6-month history.

**Authentication:** API Key only (admin)

**Response:**
```json
{
  "restaurantId": "cuid123",
  "restaurantName": "Example Restaurant",
  "conversationsThisMonth": 45,
  "lastConversationAt": "2025-10-20T15:30:00.000Z",
  "allowance": {
    "dailyLimit": 1000,
    "dailyRemaining": 1000,
    "monthlyLimit": 30000,
    "monthlyRemaining": 29955
  },
  "firstActivity": "2025-09-01T08:00:00.000Z",
  "lastActivity": "2025-10-20T15:30:00.000Z",
  "isActive": true,
  "history": [
    {
      "month": 10,
      "year": 2025,
      "conversationCount": 45,
      "lastConversationAt": "2025-10-20T15:30:00.000Z"
    },
    {
      "month": 9,
      "year": 2025,
      "conversationCount": 123,
      "lastConversationAt": "2025-09-30T23:45:00.000Z"
    }
  ]
}
```

## TypeScript Client

```typescript
// src/client/usageApi.ts

export interface UsageAllowance {
  dailyLimit: number;
  dailyRemaining: number;
  monthlyLimit: number;
  monthlyRemaining: number;
}

export interface RestaurantUsage {
  restaurantId: string;
  restaurantName: string;
  conversationsThisMonth: number;
  lastConversationAt: string | null;
  allowance: UsageAllowance;
  firstActivity: string | null;
  lastActivity: string | null;
  isActive: boolean;
}

export interface MonthlyHistory {
  month: number;
  year: number;
  conversationCount: number;
  lastConversationAt: string | null;
}

export interface RestaurantUsageDetailed extends RestaurantUsage {
  history: MonthlyHistory[];
}

export interface UsageListResponse {
  data: RestaurantUsage[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

export class UsageApiClient {
  constructor(
    private baseUrl: string,
    private authToken?: string,
    private apiKey?: string,
    private restaurantId?: string
  ) {}

  private async request<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`;
    }

    if (this.apiKey) {
      headers['X-API-Key'] = this.apiKey;
    }

    if (this.restaurantId) {
      headers['X-Restaurant-Id'] = this.restaurantId;
    }

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers: {
        ...headers,
        ...options?.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    return response.json();
  }

  /**
   * List all restaurant usage stats (admin) or get single restaurant (PAT)
   */
  async listUsage(params?: { limit?: number; offset?: number }): Promise<UsageListResponse | RestaurantUsage> {
    const query = new URLSearchParams();
    if (params?.limit) query.set('limit', params.limit.toString());
    if (params?.offset) query.set('offset', params.offset.toString());

    const endpoint = `/api/usage${query.toString() ? `?${query}` : ''}`;
    return this.request(endpoint);
  }

  /**
   * Get detailed usage for a specific restaurant (admin only)
   */
  async getRestaurantUsage(restaurantId: string): Promise<RestaurantUsageDetailed> {
    return this.request(`/api/usage/${restaurantId}`);
  }
}

// Usage Examples:

// Admin client (list all restaurants)
const adminClient = new UsageApiClient(
  'https://api.example.com',
  undefined,
  'your-api-key'
);

// Dashboard client (single restaurant)
const dashboardClient = new UsageApiClient(
  'https://api.example.com',
  'your-pat-token',
  undefined,
  'restaurant-cuid-123'
);
```

## React Component Example

```tsx
// components/UsageDashboard.tsx
import React, { useState, useEffect } from 'react';
import { UsageApiClient, RestaurantUsage, UsageListResponse } from '../client/usageApi';

interface UsageDashboardProps {
  client: UsageApiClient;
  isAdmin?: boolean;
}

export const UsageDashboard: React.FC<UsageDashboardProps> = ({ client, isAdmin = false }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<RestaurantUsage[]>([]);
  const [pagination, setPagination] = useState({
    total: 0,
    limit: 20,
    offset: 0,
    hasMore: false,
  });

  const loadData = async (offset: number = 0) => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await client.listUsage({ limit: pagination.limit, offset });
      
      if ('data' in response) {
        // Admin response with pagination
        setData(response.data);
        setPagination(response.pagination);
      } else {
        // Single restaurant response
        setData([response]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load usage data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleNextPage = () => {
    if (pagination.hasMore) {
      loadData(pagination.offset + pagination.limit);
    }
  };

  const handlePrevPage = () => {
    if (pagination.offset > 0) {
      loadData(Math.max(0, pagination.offset - pagination.limit));
    }
  };

  const formatDate = (dateStr: string | null): string => {
    if (!dateStr) return 'N/A';
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatPercentage = (remaining: number, total: number): number => {
    if (total === 0) return 0;
    return Math.round((remaining / total) * 100);
  };

  if (loading && data.length === 0) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
        <p className="font-semibold">Error loading usage data</p>
        <p className="text-sm">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-white shadow rounded-lg overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Restaurant
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Conversations This Month
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Remaining Allowance
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                First Activity
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Last Activity
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {data.map((restaurant) => {
              const monthlyPercent = formatPercentage(
                restaurant.allowance.monthlyRemaining,
                restaurant.allowance.monthlyLimit
              );
              
              return (
                <tr key={restaurant.restaurantId} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-gray-900">
                      {restaurant.restaurantName}
                    </div>
                    {!restaurant.isActive && (
                      <div className="text-xs text-red-500">Inactive</div>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-900">
                      {restaurant.conversationsThisMonth.toLocaleString()}
                    </div>
                    <div className="text-xs text-gray-500">
                      of {restaurant.allowance.monthlyLimit.toLocaleString()}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <div className="w-full bg-gray-200 rounded-full h-2 mr-2">
                        <div
                          className={`h-2 rounded-full ${
                            monthlyPercent > 50
                              ? 'bg-green-500'
                              : monthlyPercent > 20
                              ? 'bg-yellow-500'
                              : 'bg-red-500'
                          }`}
                          style={{ width: `${monthlyPercent}%` }}
                        />
                      </div>
                      <span className="text-sm text-gray-700">
                        {monthlyPercent}%
                      </span>
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      {restaurant.allowance.monthlyRemaining.toLocaleString()} remaining
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {formatDate(restaurant.firstActivity)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {formatDate(restaurant.lastActivity)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {isAdmin && (
        <div className="flex items-center justify-between border-t border-gray-200 bg-white px-4 py-3 sm:px-6 rounded-lg shadow">
          <div className="flex flex-1 justify-between sm:hidden">
            <button
              onClick={handlePrevPage}
              disabled={pagination.offset === 0}
              className="relative inline-flex items-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <button
              onClick={handleNextPage}
              disabled={!pagination.hasMore}
              className="relative ml-3 inline-flex items-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
          <div className="hidden sm:flex sm:flex-1 sm:items-center sm:justify-between">
            <div>
              <p className="text-sm text-gray-700">
                Showing <span className="font-medium">{pagination.offset + 1}</span> to{' '}
                <span className="font-medium">
                  {Math.min(pagination.offset + pagination.limit, pagination.total)}
                </span>{' '}
                of <span className="font-medium">{pagination.total}</span> results
              </p>
            </div>
            <div>
              <nav className="isolate inline-flex -space-x-px rounded-md shadow-sm" aria-label="Pagination">
                <button
                  onClick={handlePrevPage}
                  disabled={pagination.offset === 0}
                  className="relative inline-flex items-center rounded-l-md border border-gray-300 bg-white px-2 py-2 text-sm font-medium text-gray-500 hover:bg-gray-50 focus:z-20 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Previous
                </button>
                <button
                  onClick={handleNextPage}
                  disabled={!pagination.hasMore}
                  className="relative inline-flex items-center rounded-r-md border border-gray-300 bg-white px-2 py-2 text-sm font-medium text-gray-500 hover:bg-gray-50 focus:z-20 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </nav>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
```

## Usage in Dashboard

```tsx
// pages/UsagePage.tsx
import React from 'react';
import { UsageDashboard } from '../components/UsageDashboard';
import { UsageApiClient } from '../client/usageApi';

const UsagePage: React.FC = () => {
  const client = new UsageApiClient(
    process.env.REACT_APP_API_URL || 'http://localhost:3000',
    localStorage.getItem('auth_token') || undefined,
    undefined,
    localStorage.getItem('restaurant_id') || undefined
  );

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-6">Usage Dashboard</h1>
      <UsageDashboard client={client} />
    </div>
  );
};

export default UsagePage;
```


## Frontend Dashboard API Usage Guide

### Overview

This guide explains how the dashboard frontend should call the backend APIs. Pay special attention to authentication headers and the difference between tenant/bot IDs and external merchant IDs.

### Authentication

- **PAT (restaurant-scoped)**
  - Send `Authorization: Bearer <DASHBOARD_PAT>`
  - Send `X-Restaurant-Id: <tenantId>`
  - The `X-Restaurant-Id` must match the `:tenantId` used in the path.

- **Admin key (global)**
  - Send `X-API-Key: <BOT_API_KEY>`
  - Do not include the PAT headers when using the admin key.

### Tenant ID vs Merchant ID

- **Use `tenantId` (aka `RestaurantBot.id`) in all paths that take `:tenantId`.**
- Do NOT use your external merchant ID in the path for tenant endpoints. If you only have a merchant ID, coordinate with the backend to receive a `tenantId` or add a resolver.

### Base URL

- All examples below assume requests to the same origin as the dashboard. If you call a different origin, ensure CORS and credentials are configured appropriately.

### Key Endpoints

| Endpoint | Method | Notes |
|---------|--------|-------|
| `/api/tenants/:tenantId/overview` | GET | Requires PAT headers; optional `currency` query (default `SAR`). |
| `/api/ratings` | GET | Admin or PAT headers required; supports `from`, `to`. |
| `/api/ratings/reviews` | GET | Admin or PAT headers required; supports `page`, `pageSize`, `rating`, `q`. |
| `/api/orders/stats` | GET | Admin or PAT headers required; supports `from`, `to`. |

### Examples (Fetch)

Using PAT (restaurant-scoped):

```ts
const tenantId = 'restbot_123'; // RestaurantBot.id — not merchant id
const headers = {
  'Authorization': `Bearer ${DASHBOARD_PAT}`,
  'X-Restaurant-Id': tenantId,
};

const res = await fetch(`/api/tenants/${tenantId}/overview?currency=SAR`, { headers });
if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
const overview = await res.json();
```

Using admin key:

```ts
const headers = { 'X-API-Key': BOT_API_KEY };

const ratings = await (await fetch(`/api/ratings?from=2025-10-01&to=2025-10-22`, { headers })).json();
const reviews = await (await fetch(`/api/ratings/reviews?page=1&pageSize=20`, { headers })).json();
const orderStats = await (await fetch(`/api/orders/stats?from=2025-10-01&to=2025-10-22`, { headers })).json();
```

### Examples (Axios)

```ts
import axios from 'axios';

const tenantId = 'restbot_123';
const client = axios.create({
  headers: {
    Authorization: `Bearer ${DASHBOARD_PAT}`,
    'X-Restaurant-Id': tenantId,
  },
});

const { data: overview } = await client.get(`/api/tenants/${tenantId}/overview`, { params: { currency: 'SAR' } });
```

### Examples (cURL)

```bash
curl -s \
  -H "Authorization: Bearer $DASHBOARD_PAT" \
  -H "X-Restaurant-Id: $TENANT_ID" \
  "/api/tenants/$TENANT_ID/overview?currency=SAR"
```

Admin key example:

```bash
curl -s -H "X-API-Key: $BOT_API_KEY" "/api/ratings?from=2025-10-01&to=2025-10-22"
```

### Common Pitfalls

- **404 on `/api/tenants/:id/overview`**: You used a merchant ID in the path; use `tenantId` (`RestaurantBot.id`) instead.
- **403 Forbidden**: With PAT auth, `X-Restaurant-Id` does not match the `:tenantId` path segment.
- **401 Unauthorized**: Missing/invalid `Authorization` or `X-API-Key` header.
- **204 OPTIONS but failing GET**: CORS preflight passed; the follow-up GET likely missed required auth headers.

### Checklist

- Use `tenantId` in path and `X-Restaurant-Id` (PAT flow).
- Include either PAT headers or admin key, not both.
- Prefer `currency=SAR` unless overridden by user preference.
- Validate responses and handle non-200 statuses.



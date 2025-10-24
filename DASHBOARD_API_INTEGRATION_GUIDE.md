# Dashboard API Integration Guide

This guide shows dashboard developers how to call the backend APIs consistently. Every endpoint follows the same recipe: authenticate once, send JSON, read the `data` field, and use the optional `meta` block for locale-aware UI.

---

## 1. One-Time Setup
- Set `DASHBOARD_API_URL` in the dashboard app (local default: `http://localhost:3000`).
- Store credentials in env variables, never inside the bundle.
  ```ts
  const DASHBOARD_PAT = process.env.NEXT_PUBLIC_DASHBOARD_PAT;
  const DASHBOARD_API_KEY = process.env.NEXT_PUBLIC_DASHBOARD_API_KEY; // admin tooling only
  const RESTAURANT_BOT_ID = process.env.NEXT_PUBLIC_RESTAURANT_ID;
  ```

## 2. Shared Request Shape
| Header | Purpose |
| --- | --- |
| `Authorization: Bearer <DASHBOARD_PAT>` | Tenant-scoped access. Required for almost every call. |
| `X-Restaurant-Id: <bot id>` | Required with PAT so the server resolves the actual restaurant. |
| `X-API-Key: <BOT_API_KEY>` | Admin-only paths (system-wide metrics, usage, health detail). |
| `Content-Type: application/json` | Default for POST/PATCH bodies. |
| `Accept-Language: en` or `ar` | Controls localized strings in the response. |

All responses are JSON shaped like:
```json
{
  "data": { /* payload */ },
  "meta": {
    "locale": "en",
    "currency": "SAR",
    "timestamp": "2025-01-15T09:21:33.842Z"
  }
}
```
Errors look like:
```json
{ "error": "Unauthorized" }
```

Pagination & filters use the same params everywhere:
- `limit` & `offset` for pagination (defaults vary, max enforced server-side).
- `days`, `status`, `include_history`, etc. are optional filters called out per endpoint.

## 3. Drop-In Fetch Helper
```ts
async function dashboardFetch<T>(path: string, {
  method = 'GET',
  query,
  body,
  locale = 'en',
  useApiKey = false,
}: {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  locale?: 'en' | 'ar';
  useApiKey?: boolean; // true for admin endpoints
} = {}): Promise<T> {
  const url = new URL(path, process.env.DASHBOARD_API_URL);
  Object.entries(query || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  });

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept-Language': locale,
  };

  if (useApiKey) {
    headers['X-API-Key'] = process.env.DASHBOARD_API_KEY!;
  } else {
    headers.Authorization = `Bearer ${process.env.DASHBOARD_PAT}`;
    headers['X-Restaurant-Id'] = process.env.DASHBOARD_RESTAURANT_ID!;
  }

  const res = await fetch(url.toString(), {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const payload = await res.json();
  if (!res.ok) {
    throw new Error(payload.error || res.statusText);
  }

  return (payload.data ?? payload) as T;
}
```
> The helper always returns the `data` node so callers never worry about the wrapper.

## 4. Endpoint Cheat Sheet

### 4.1 Overview & Bot Health
| Method & Path | What it returns | Notes |
| --- | --- | --- |
| `GET /api/tenants/:botId/overview` | High-level KPIs, conversation/order usage, SLAs. | PAT + the same `:botId` value in `X-Restaurant-Id`. `currency` query overrides the default (`SAR`). |
| `GET /api/bot` | Bot status, verification state, rate limits. | `include_history=true` adds hourly message stats. |
| `PATCH /api/bot` | Update bot throttling (`maxMessagesPerMin`, `maxMessagesPerDay`) or toggle `isActive`. | Send JSON body with the fields to change. |

### 4.2 Conversations
| Method & Path | Purpose | Key Query/Body |
| --- | --- | --- |
| `GET /api/conversations/summary` | Paginated list with SLA metadata. | `limit`, `offset`. |
| `GET /api/conversations/:id/transcript` | Full transcript with relative timestamps. | — |
| `GET /api/conversations/:id/export` | Plain-text export (downloads a `.txt`). | — |
| `PATCH /api/conversations/:id` | Switch bot/agent handover or mark read counts. | Body supports `isBotActive`, `status`, `unreadCount`. |

### 4.3 Orders
| Method & Path | Purpose | Key Query/Body |
| --- | --- | --- |
| `GET /api/orders/live` | Live feed with alerts and SLA timers. | `limit`, `offset`, `status`. |
| `GET /api/orders/:id` | Full order detail, localized amounts. | — |
| `PATCH /api/orders/:id` | Update status or metadata. | `status` (one of `CONFIRMED`, `PREPARING`, `OUT_FOR_DELIVERY`, `DELIVERED`, `CANCELLED`), optional `meta`. |
| `GET /api/orders/stats` | Revenue, counts, status breakdown. | `days` (default 30, max 365). |

### 4.4 Ratings & Reviews
| Method & Path | Purpose | Key Query/Body |
| --- | --- | --- |
| `GET /api/ratings` | Rating analytics + NPS. | `days` window (default 30). |
| `GET /api/ratings/reviews` | Paginated review list. | `limit`, `offset`, `min_rating`, `max_rating`, `with_comments`. |

### 4.5 Notifications & Logs
| Method & Path | Purpose | Key Query/Body |
| --- | --- | --- |
| `GET /api/notifications` | Generated alerts (orders, SLA, quota, errors). | `include_read=true` keeps historical alerts. |
| `GET /api/logs` | Webhook log feed with severity. | `limit`, `offset`, `severity`, `event_type`, `start_date`, `end_date`. |
| `GET /api/logs/:id` | Detailed log entry. | — |
| `GET /api/logs/export` | Bulk export between timestamps. | `start_date`, `end_date` (ISO strings). |

### 4.6 Catalog & Templates
| Method & Path | Purpose | Key Query/Body |
| --- | --- | --- |
| `GET /api/catalog/categories` | Sufrah categories + item counts. | — |
| `GET /api/catalog/items` | All catalog items or filtered by category. | `categoryId` (optional) to filter by specific category. |
| `GET /api/catalog/branches` | Merchant branches. | — |
| `GET /api/catalog/sync-status` | Sync health flags. | — |
| `GET /api/templates` | Templates list with cache usage. | `limit`, `offset`, `status`, `category`. |
| `POST /api/templates` | Create draft template. | Body needs `name`, `category`, `body_text`, plus optional header/footer/buttons. |
| `GET /api/templates/:id` | Template detail + cache analytics. | — |
| `PATCH /api/templates/:id` | Update any template field. | send fields to change. |
| `DELETE /api/templates/:id` | Remove a template. | — |
| `GET /api/templates/cache/metrics` | Cache hit/miss stats (admin friendly). | — |

### 4.7 Settings & Onboarding
| Method & Path | Purpose | Key Query/Body |
| --- | --- | --- |
| `GET /api/settings/profile` | Restaurant profile, owner, bot info. | — |
| `PATCH /api/settings/profile` | Update profile fields. | Body accepts `name`, `description`, `address`, `phone`, `logoUrl`. |
| `GET /api/settings/audit-logs` | Usage/audit events. | `limit`, `offset`. |
| `GET /api/onboarding` | Checklist progress & verification timeline. | — |
| `GET /api/onboarding/phone-numbers` | Available WhatsApp numbers (mock). | `country_code` (`SA` default). |

### 4.8 Usage, Admin & Health (API key only)
| Method & Path | Purpose | Notes |
| --- | --- | --- |
| `GET /api/usage` | With API key: list all tenants + quota stats. With PAT: single restaurant usage. | Include `limit`, `offset` when listing all. |
| `GET /api/admin/metrics` | Fleet-wide KPIs, queue status, webhook error rate. | Requires API key. |
| `GET /api/admin/restaurants` | Paginated tenant roster with counts. | `limit`, `offset`. |
| `GET /api/health` | Without key: basic up/down. With key: DB/Redis latency, queue lengths, webhook error rate. | Pass `useApiKey: true` in helper for detailed view. |

## 5. Typical Flows
1. **Dashboard home**: parallel fetch `tenants/:botId/overview`, `orders/live?limit=20`, `notifications`, `ratings?days=7`.
2. **Conversation detail page**: fetch `conversations/:id/transcript`, optionally `orders/:id` for the linked order.
3. **Order management**: update status via `PATCH /api/orders/:id` and re-fetch the live feed.
4. **Template editor**: list templates, pull detail on selection, create/update with POST/PATCH, refresh the list.

## 6. Error Handling & Retries
- `401/403`: prompt the user to refresh credentials (PAT/restaurant id mismatch).
- `404`: the resource is not owned by this restaurant; surface a friendly message.
- `429/500`: show toast + retry with exponential backoff (same helper can be wrapped with `p-retry`).
- All timestamps are ISO strings; derive relative times client-side only if you need custom formatting (defaults already included in payload).

## 7. Testing Checklist
- Use `bun run index.ts --watch` and point the dashboard env to `http://localhost:3000`.
- Set fake PAT/API keys in `.env.local`; the backend only checks for equality, so short tokens are fine for dev.
- Run `bun test` after adding new flows that depend on these endpoints.

Stick to the helper + headers in section 3 and every endpoint above will behave consistently.

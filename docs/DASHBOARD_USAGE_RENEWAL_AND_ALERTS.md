## Purpose

This guide explains how the dashboard should integrate with the Usage APIs for:
- Renewing a restaurant's monthly allowance (+1000 conversations by default)
- Showing near-quota warnings
- Reading usage/allowance data (with effective limits including top-ups)

Session logic (24h conversation windows) is unchanged; only how allowance is computed is extended via monthly adjustments.

## Authentication

- Admin requests: set `X-API-Key: <BOT_API_KEY>`
- Single-restaurant (PAT) requests: set `Authorization: Bearer <DASHBOARD_PAT>` and `X-Restaurant-Id: <restaurantId>`

All responses are JSON. CORS allows `Authorization`, `X-API-Key`, `X-Restaurant-Id`.

### Common Fields

- `allowance.monthlyLimit`: effective monthly limit after top-ups (plan limit + `adjustedBy`)
- `allowance.monthlyRemaining`: remaining allowance for the month
- `adjustedBy`: sum of top-ups this month
- `usagePercent`: used percent of the effective limit (0–100). Omitted for unlimited
- `isNearingQuota`: true if `usagePercent >= 90` (default threshold)

## Endpoints

### POST /api/admin/usage/:restaurantId/renew

Grants a monthly top-up (default +1000). Admin only.

- Headers:
  - `X-API-Key: <BOT_API_KEY>`
  - `Content-Type: application/json`
- Body:
```json
{ "amount": 1000, "reason": "Manual renewal" }
```
- Response 200:
```json
{
  "success": true,
  "data": {
    "used": 45,
    "limit": 1000,
    "effectiveLimit": 2000,
    "adjustedBy": 1000,
    "remaining": 1955,
    "usagePercent": 2.25,
    "isNearingQuota": false
  }
}
```
- Errors: 401 (unauthorized), 404 (restaurant not found)

Example:
```bash
curl -X POST \
  -H "X-API-Key: <ADMIN_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"amount":1000,"reason":"Monthly renewal"}' \
  "https://api.example.com/api/admin/usage/<RESTAURANT_ID>/renew"
```

### GET /api/usage

Returns usage for:
- Admin: paginated list for all active restaurants
- PAT: single restaurant if `Authorization: Bearer <PAT>` and `X-Restaurant-Id` provided

Query params: `limit` (default 20, max 100), `offset` (default 0)

Admin response:
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
        "monthlyLimit": 2000,
        "monthlyRemaining": 1955
      },
      "adjustedBy": 1000,
      "usagePercent": 2.25,
      "isNearingQuota": false,
      "firstActivity": "2025-09-01T08:00:00.000Z",
      "lastActivity": "2025-10-20T15:30:00.000Z",
      "isActive": true
    }
  ],
  "pagination": { "total": 150, "limit": 20, "offset": 0, "hasMore": true }
}
```

PAT (single restaurant) response:
```json
{
  "restaurantId": "cuid123",
  "restaurantName": "Example Restaurant",
  "conversationsThisMonth": 45,
  "lastConversationAt": "2025-10-20T15:30:00.000Z",
  "allowance": {
    "dailyLimit": 1000,
    "dailyRemaining": 1000,
    "monthlyLimit": 2000,
    "monthlyRemaining": 1955
  },
  "adjustedBy": 1000,
  "usagePercent": 2.25,
  "isNearingQuota": false,
  "firstActivity": "2025-09-01T08:00:00.000Z",
  "lastActivity": "2025-10-20T15:30:00.000Z",
  "isActive": true
}
```

### GET /api/usage/:restaurantId

Admin only. Returns detailed stats for a single restaurant including 6‑month history.

Response 200:
```json
{
  "restaurantId": "cuid123",
  "restaurantName": "Example Restaurant",
  "conversationsThisMonth": 45,
  "lastConversationAt": "2025-10-20T15:30:00.000Z",
  "allowance": {
    "dailyLimit": 1000,
    "dailyRemaining": 1000,
    "monthlyLimit": 2000,
    "monthlyRemaining": 1955
  },
  "adjustedBy": 1000,
  "usagePercent": 2.25,
  "isNearingQuota": false,
  "firstActivity": "2025-09-01T08:00:00.000Z",
  "lastActivity": "2025-10-20T15:30:00.000Z",
  "isActive": true,
  "history": [
    { "month": 10, "year": 2025, "conversationCount": 45, "lastConversationAt": "2025-10-20T15:30:00.000Z" },
    { "month": 9, "year": 2025, "conversationCount": 123, "lastConversationAt": "2025-09-30T23:45:00.000Z" }
  ]
}
```

### GET /api/usage/alerts?threshold=0.9&limit=50&offset=0

Admin only. Lists restaurants nearing quota.

Query params:
- `threshold`: 0–1 (default 0.9)
- `limit`: default 50 (max 200)
- `offset`: default 0

Response 200:
```json
{
  "data": [
    {
      "restaurantId": "cuid999",
      "restaurantName": "High Usage",
      "used": 910,
      "limit": 1000,
      "remaining": 90,
      "usagePercent": 91.0,
      "isNearingQuota": true,
      "adjustedBy": 0
    }
  ],
  "pagination": { "total": 150, "limit": 50, "offset": 0, "hasMore": true },
  "threshold": 0.9
}
```

## UI Integration Notes (Mobile‑first)

- Usage table (admin): call `GET /api/usage` with `X-API-Key`.
  - Render progress using `usagePercent` (or compute from `allowance`).
  - Show a warning badge if `isNearingQuota` is true.
  - Provide a “Renew +1000” button per row.
- Renew flow: confirm -> POST renew -> update row with response (`effectiveLimit`, `remaining`, `usagePercent`, `isNearingQuota`, `adjustedBy`).
- Alerts view/badge: use `GET /api/usage/alerts` to list or count near‑quota restaurants.

## TypeScript Examples

List usage (admin):
```ts
const res = await fetch(`${baseUrl}/api/usage?limit=20&offset=0`, {
  headers: { 'X-API-Key': adminKey }
});
const { data, pagination } = await res.json();
```

Renew +1000:
```ts
const res = await fetch(`${baseUrl}/api/admin/usage/${restaurantId}/renew`, {
  method: 'POST',
  headers: { 'X-API-Key': adminKey, 'Content-Type': 'application/json' },
  body: JSON.stringify({ amount: 1000, reason: 'Manual renewal' })
});
const { data } = await res.json();
// use data.effectiveLimit, data.remaining, data.usagePercent, data.isNearingQuota
```

PAT (single restaurant):
```ts
const res = await fetch(`${baseUrl}/api/usage`, {
  headers: {
    'Authorization': `Bearer ${pat}`,
    'X-Restaurant-Id': restaurantId
  }
});
const payload = await res.json();
```

## Errors

- 400: Missing `X-Restaurant-Id` for PAT
- 401: Invalid/missing auth
- 404: Restaurant not found (renew/detail)

## Notes

- Unlimited plans return `limit = -1`; `usagePercent` omitted; `isNearingQuota = false`.
- Multiple renewals accumulate in `adjustedBy` for the month.
- 24h session counting remains unchanged and continues to drive usage.



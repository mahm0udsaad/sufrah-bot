# Fixing Dashboard 401 Errors

This guide walks through resolving the recurring `401 Unauthorized` responses the dashboard receives when calling the bot backend (e.g. `/api/dashboard/usage`, `/api/dashboard/templates`). The root cause is a mismatch between our dashboard auth/session setup and the authentication headers expected by the bot server.

## 1. Recap of the Current Flow
- The dashboard Next.js API routes (`/api/dashboard/*`) proxy requests to the bot service at `${BOT_API_URL}`.
- Every bot **dashboard** endpoint requires two headers:
  - `Authorization: Bearer ${DASHBOARD_PAT}` — the bot server reads it from `process.env.DASHBOARD_PAT` (exposed to the dashboard as `BOT_API_TOKEN`).
  - `X-Restaurant-Id` — identifies the tenant; the bot rejects requests when it is missing or does not match the restaurant that owns the target record.
- The dashboard authenticates users via a cookie named `auth-token`. If the token cannot be verified with the same `JWT_SECRET` used at login, the dashboard responds with `401` before it can proxy to the bot service.

## 2. Symptoms You Observed
- Repeated `GET /api/dashboard/usage 401` and `GET /api/dashboard/templates 401` log entries.
- These happen even though the user is logged in, because the API route either (a) fails to verify the `auth-token` or (b) forwards the bot request without the headers the bot expects.

## 3. Required Configuration
1. Add/update the following env vars in the **dashboard** `.env.local`:
   ```bash
   JWT_SECRET=<<same-value-used-by-auth-service>>
   BOT_API_URL=https://bot.sufrah.sa/api
   BOT_API_TOKEN=<<copy-of-bot-server-DASHBOARD_PAT>>
   ```
2. Confirm the bot server `.env` exposes the same `DASHBOARD_PAT` value (already loaded by the bot code via `process.env.DASHBOARD_PAT`).

## 4. Implementation Steps
1. **Fix JWT verification**
   - Ensure the auth service that issues `auth-token` uses the exact same `JWT_SECRET` as the dashboard API routes.
   - If secrets differ between environments, sync them (or pass the issuing secret into the dashboard container/application).

2. **Always forward tenant headers**
   - In every dashboard proxy handler (e.g. `/api/dashboard/templates`, `/api/dashboard/usage`, `/api/conversations/db`, `/api/dashboard/messages`, etc.):
     - Resolve the user with `getUserFromToken`.
     - Fetch the primary restaurant via `db.getPrimaryRestaurantByUserId(userId)`.
     - Use that ID when forwarding the request:
       ```ts
       const headers: HeadersInit = {
         Authorization: `Bearer ${BOT_API_TOKEN}`,
         "X-Restaurant-Id": restaurant.id,
         "Content-Type": "application/json",
       };
       ```
     - Remove any dependence on the browser supplying `X-Restaurant-Id`; server-to-server calls should derive it from the authenticated session.

3. **Normalize proxy URLs**
   - The bot exposes database-backed routes under `/api/db/*`. Ensure your fetches target the correct paths:
     - Conversations: `${BOT_API_URL}/db/conversations`
     - Messages: `${BOT_API_URL}/db/conversations/${conversationId}/messages`
     - Ratings: `${BOT_API_URL}/db/ratings`
     - Templates (if you expose a dashboard handler): `${BOT_API_URL}/templates/...` (double-check the path you call)

4. **Error handling**
   - When the bot responds with a non-200 status, surface both the status and body in dashboard logs so we can tell whether it was a missing header vs. an upstream failure:
     ```ts
     if (!response.ok) {
       const body = await response.text();
       console.error("Bot API error", response.status, body);
       return NextResponse.json({ error: "Bot API request failed" }, response.status);
     }
     ```

## 5. Verification Checklist
- [ ] Log into the dashboard (ensure `auth-token` cookie is set).
- [ ] `curl --cookie` the dashboard `GET /api/dashboard/usage` route; expect `200` with usage JSON.
- [ ] Load the dashboard UI page; confirm widgets powered by `/api/dashboard/templates` and `/api/dashboard/usage` render correctly.
- [ ] Inspect bot server logs — requests from the dashboard should now show `Authorization` and `X-Restaurant-Id` headers.

Once these steps are complete, the dashboard and bot server will negotiate authentication correctly and the 401 responses will stop.

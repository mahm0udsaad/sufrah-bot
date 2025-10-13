## Project Status Report: Sufrah Dashboard

### Overview

Sufrah Dashboard is a Next.js application for restaurant operators to manage WhatsApp-based conversations, orders, product catalog, and basic analytics. A separate WhatsApp bot service handles customer interactions; this dashboard surfaces operational views and admin actions.

### Technology Stack

- **Framework**: Next.js 14, React 18, TypeScript 5
- **Styling/UI**: Tailwind CSS 4, shadcn/ui, Radix UI, lucide-react
- **Data/ORM**: PostgreSQL + Prisma 6 (schema/migrations under `prisma/`)
- **Auth**: Cookie-based (JWT via `jose`); server routes under `app/api/auth/*`
- **Realtime**: WebSocket for internal events (`contexts/realtime-context.tsx`) and separate Bot WS (`contexts/bot-websocket-context.tsx`)
- **Integrations**: Twilio (SMS/WhatsApp verification), Sufrah external API for catalog (`lib/sufrah.ts`)
- **Charts/UX**: recharts, sonner toasts, next-themes

Environment variables required (non-exhaustive): `DATABASE_URL`, `JWT_SECRET`, `NEXT_PUBLIC_REALTIME_WS_URL` or `REALTIME_WS_URL`, `APITOKEN`, `BASEURL` (Sufrah), `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_SMS_FROM`, `TWILIO_WHATSAPP_FROM`, `BOT_WS_URL`, `BOT_API_URL`, `BOT_API_TOKEN`.

### Implemented Features

- **Authentication**
  - Phone-based sign-in and verification endpoints: `app/api/auth/*`
  - Client hooks and guards: `components/auth-guard.tsx`, `lib/auth.tsx`

- **Orders**
  - Orders listing with search/filter and status updates: `app/orders/page.tsx`
  - API: `app/api/orders/route.ts` (list/create), `app/api/orders/stats/route.ts` (day stats)
  - Realtime order updates via `contexts/realtime-context.tsx` and `/api/realtime/token`

- **Catalog**
  - Category/products/branches from Sufrah API: `app/catalog/page.tsx`, `lib/sufrah.ts`
  - Graceful fallbacks when merchant or token is missing

- **Chats (Bot)**
  - Chat UI scaffold with conversations and message thread: `app/chats/page.tsx`, `components/chat/*`
  - Bot WS + REST client: `contexts/bot-websocket-context.tsx`, `lib/integrations/bot-api.ts`

- **Dashboard Overview**
  - KPIs and visualizations: `components/dashboard-overview.tsx`
  - API for KPIs: `app/api/dashboard/stats/route.ts`

- **Templates**
  - Manage WhatsApp templates UI: `app/templates/page.tsx`
  - API: `app/api/templates/route.ts`, `app/api/templates/[id]/route.ts`

- **Database**
  - Prisma schema and migrations: `prisma/schema.prisma`, `prisma/migrations/*`
  - Seed for local/demo data: `prisma/seed.js`

### Architecture

- **Next.js app router** handles both UI and backend routes under `app/`.
- **Bot service** is external; dashboard connects via WS/HTTP to `BOT_WS_URL`/`BOT_API_URL`.
- **PostgreSQL** is the source of truth for users, restaurants, conversations, messages, orders, templates, and logs.
- **Realtime** internal WS is tokenized by `/api/realtime/token` (JWT); client subscribes to per-restaurant channels.

High-level flow:
1) Customer talks to bot (WhatsApp via Twilio). 2) Bot writes/updates conversations/messages and may create orders. 3) Dashboard shows and updates the same entities; staff can update order status, manage templates, browse catalog.

### Dummy/Placeholder/Null Data Surfaces

- **Dashboard KPIs and charts**: `components/dashboard-overview.tsx` uses mocked usage/template datasets and fixed "Orders Snapshot" counts when API data is unavailable.
- **Usage page**: `app/usage/page.tsx` is currently static (plans, usage chart, numbers are hardcoded).
- **Bot API integration**: `lib/integrations/bot-api.ts` provides cached fallback samples when network fails and uses a placeholder `BOT_API_TOKEN` by default.
- **Catalog page**: If `externalMerchantId` or `APITOKEN` is missing, categories/products/branches resolve to empty arrays.
- **Seed data**: `prisma/seed.js` creates a demo user, restaurant, one conversation, one order, and a template.

### Gaps, Risks, and Inconsistencies

- **Auth cookie inconsistency**
  - Some APIs read `user-phone` (e.g., `app/api/orders/route.ts`), others rely on `auth-token` JWT (e.g., dashboard stats). Unify on one mechanism (prefer JWT) to avoid desync and edge-case auth failures.

- **Conversation status enum mismatch**
  - Prisma uses `ConversationStatus` of `active|closed`, while `lib/db.ts` uses strings `OPEN|CLOSED` and seed sets `OPEN`. This will cause runtime errors or coercion failures. Align DB writes/reads to enum values.

- **Missing endpoints referenced by UI**
  - `components/dashboard-overview.tsx` attempts to fetch `/api/dashboard/usage` and `/api/dashboard/templates` which are not present. Charts fall back to mock data.

- **Realtime config**
  - Internal WS defaults to `ws://localhost:4000` if `REALTIME_WS_URL` is unset; ensure proper envs in all environments.

- **External service configuration**
  - `lib/sufrah.ts` requires `APITOKEN`; throws if missing. `lib/twilio.ts` requires Twilio creds and from numbers; returns friendly error objects if not configured.

- **Testing**
  - No unit/integration/E2E tests are present. Add tests for API routes (`app/api/*`), db helpers (`lib/db.ts`), and UI critical paths.

### What’s Done vs. Missing

- Done
  - Auth scaffolding and routes; Orders list/stats; Catalog integration and UI; Templates UI+API; Core dashboard layout; Realtime token issuance and client wiring; Seed + migrations.

- Missing/Incomplete
  - Dashboard usage/template analytics APIs; Usage page backend; Auth unification; Conversation status enum alignment; Production-grade bot integration (token mgmt, error handling, retries); Comprehensive error and empty states; Tests and CI.

### Recommended Next Steps

1) **Unify authentication** across routes on `auth-token` (JWT) and remove `user-phone` cookie dependency; centralize helpers.
2) **Fix enum mismatch**: switch `lib/db.ts` and seed to `active|closed` and adjust any reads/writes accordingly.
3) **Implement missing APIs**: `/api/dashboard/usage`, `/api/dashboard/templates` and wire real data into `DashboardOverview` and `/usage`.
4) **Harden bot integration**: move BOT endpoints/keys to server routes with proxying, add auth, handle rate limits, and surface errors.
5) **Configuration**: document and validate envs at boot; provide `.env.example`.
6) **Testing & QA**: add unit tests for `lib/db.ts`, API route tests, and basic Playwright flows for auth -> orders.
7) **Observability**: add structured logging around webhook ingestion (`app/api/bot/webhook/route.ts`) and order state changes.

### How to Run Locally

1) `pnpm install`
2) Create `.env` with `DATABASE_URL`, `JWT_SECRET`, and optional integration envs.
3) `pnpm prisma migrate dev` then `pnpm db:seed`
4) `pnpm dev` and open `http://localhost:3000`



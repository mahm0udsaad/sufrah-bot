# Sufrah Bot Dashboard – v0 AI Agent Context & Prompt

## Overview
We are building a new **Next.js 14 dashboard** (App Router, TypeScript, Tailwind) for “Sufrah Bot”. The goal is to scaffold the complete project while keeping room for future integration with two external backends:

1. **Chatbot Dashboard API (Bun server)** – our existing Bun service that handles WhatsApp webhook traffic, bot logic, and will expose conversation control endpoints for the dashboard.
2. **Main Order System API** – a separate backend that authenticates restaurant owners by phone number, provides restaurant profile data, returns payment links/status, and stores final order records.

For now, the dashboard should use **simulated data/functions** with clear TODO comments showing where real integrations will be attached later.

## External API Expectations
- **Bun Chatbot API (future integration)**
  - Endpoints for listing conversations, retrieving messages, sending manual replies, toggling bot control, and subscribing to real-time events (WebSocket).
  - Bun will also pass authenticated phone numbers to the dashboard for owner login.
- **Main Order System API (future integration)**
  - Authenticates restaurant owner by phone number.
  - Returns restaurant profile (name, branches, plan info).
  - Provides payment links, order numbers, and delivery status.

The v0 scaffold must clearly indicate these integration points with placeholder functions.

## Prompt for the v0 AI Agent

```
You are building a Next.js 14 dashboard (App Router, TypeScript, Tailwind) for “Sufrah Bot”. The goal is to scaffold the full project with Neon (PostgreSQL) + Prisma and a Bun webhook backend (already exists) that will later supply real data. Deliver a working simulation with placeholders where live integrations will plug in.

Key Requirements
1. Auth
   - Single Sign-In page at `/signin`.
   - Authentication uses phone number only (simulate with a simple form that sets a session cookie/state).
   - Create an `AuthProvider` and hook (`useAuth`) to guard dashboard routes.
   - Include placeholder function `authenticatePhone(phone: string)` → TODO comment referencing future main API call.

2. Project Structure
   - `/app` structure with `layout.tsx`, `page.tsx` for dashboard, nested routes for chats/templates later.
   - Components directory for UI blocks (`ChatList`, `ChatWindow`, `TemplateList`, `StatsCards`, etc.).
   - `lib/neon.ts` to expose Prisma client connected to Neon (read credentials from `.env`).
   - `lib/simulations.ts` exposing mocked fetchers (`fetchDashboardStats`, `fetchTemplates`, `fetchChats`, `sendManualMessage`, `toggleBotControl`) with TODO comments signaling future Bun API integration.

3. Database & Prisma
   - Models: `User`, `Conversation`, `Message`, `Template`, `RestaurantProfile`.
   - Provide Prisma schema configured for Neon, plus migration instructions (`prisma migrate dev --name init`).
   - Seed script with sample data matching the dashboard copy below.
   - Use Prisma Client in API routes and server components.

4. API Routes (App Router)
   - `/api/auth/signin` (POST) → calls simulated `authenticatePhone`.
   - `/api/conversations` (GET) → returns list via simulation.
   - `/api/conversations/[id]` (GET, POST) → get messages / send manual message, using placeholder `sendManualMessage`.
   - `/api/conversations/[id]/toggle-bot` (POST) → flips `isBotActive`, placeholder `toggleBotControl`.
   - `/api/templates` (GET) → returns templates from simulation.
   - Mark each handler with TODO comments showing where Bun webhook integration will plug in.

5. Realtime Strategy
   - Set up `lib/socket.ts` configuring a client WebSocket (use `socket.io-client` or native ws).
   - Add a `useConversationStream` React hook that connects to `ws://localhost:4000/ws` (placeholder) and updates local state.
   - In comments, note that Bun webhook server will emit events; for now simulate updates with `setInterval`.

6. UI Layout (Dashboard `/`)
   - Sidebar with items: “Dashboard”, “Chats (12)”, “Orders”, “Usage & Plan”, “Templates”, “Settings”.
   - Top header showing “Sufrah Bot” + current restaurant (“Main Restaurant”) + Search bar (“Search conversations…” placeholder).
   - Stats cards as shown:
     - Chats: `12`
     - Orders
     - Usage & Plan
     - Templates
     - Settings
   - Main content area replicating this block exactly (use Tailwind, responsive grid):
     ```
     WhatsApp Templates
     Manage your approved message templates

     [Create Template button]

     Total Templates 5
     Approved 3
     Pending 1
     This Month 446

     [Search templates...]

     All Categories
     Welcome Message (greeting, approved, message text, Used 156 times, 2 hours ago, Copy button)
     Order Confirmation (order, approved, … variables list)
     Delivery Update (delivery, pending, …)
     ```
   - Provide accessible components for these cards with dummy data from simulation.

7. Chat Interface (route `/chats/[conversationId]`)
   - Left panel: conversation list (avatar initials, last message preview, status chip showing “Bot Active” vs “Agent”).
   - Right panel: message history with timestamps, mark agent vs bot vs user visually.
   - Controls: “Pause Bot” / “Resume Bot” toggle button (calls `/api/conversations/[id]/toggle-bot`).
   - Message input box (textarea, Send button) calling `/api/conversations/[id]` POST.
   - When bot paused, show banner “Bot paused—messages sent as agent.”

8. Future Order Integration Placeholders
   - Add `OrderSummary` sidebar component that currently shows static text and TODO comments:
     - Payment link placeholder
     - Will receive delivery status, order number from main API
     - Include function stubs `requestPaymentLink(orderId)` and `fetchOrderStatus(orderId)` in `lib/simulations.ts`.

9. Environment & Setup
   - `.env.example` with:
     ```
     DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/db?sslmode=require"
     NEXTAUTH_SECRET=""
     ```
   - README instructions covering:
     - `npm install`
     - `npx prisma migrate dev --name init`
     - `npm run seed`
     - `npm run dev`
     - Note about needing Bun webhook + Neon credentials later.
     - Explain simulated sockets and where to swap with real Bun events.

10. Tech Stack
   - Next.js 14, TypeScript, Tailwind, Prisma, Neon Postgres, SWR or React Query for data fetching (your choice).
   - Use `shadcn/ui` or simple Tailwind components for consistent styling.
   - Ensure ESLint/Prettier config.

11. Comments & TODOs
   - Clearly comment every simulated function with `// TODO: Replace with real Bun API integration`.
   - Document in code where main API (phone authentication, order status) will integrate.

Output Expectations
- Provide full Next.js project with the structure above.
- Include TypeScript types for Conversations, Messages, Templates, etc.
- Dashboard should render the provided copy exactly and simulate data flows.
- Code should be ready to connect Neon (run migrations), and easy to swap simulated API with live endpoints later.
```

## Notes for Future Integration
- Bun chatbot backend will publish WebSocket events (`ws://.../ws`) and REST endpoints; keep socket client ready.
- Main order API will authenticate using phone numbers and provide order/payment metadata; placeholders must be easy to swap with real fetches.
- Remember to coordinate session handling between Bun and dashboard once integration starts.

This document should be supplied to the v0 AI agent so the generated project aligns with our architecture and future integration plan.

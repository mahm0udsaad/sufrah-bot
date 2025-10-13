## Refactor Guide: Split `index.ts` into Modules (For Automation Agent)

### Objectives
- Extract routing, handlers, and utilities from `index.ts` into cohesive modules without behavior changes.
- Keep the app runnable after each step; prefer small, reviewable edits.
- Avoid reformatting unrelated code. Preserve existing signatures and side effects.

### Constraints
- Do not change business logic or response payloads.
- Preserve current Arabic messages, status flow, and Twilio integration behavior.
- Prevent circular imports; handlers must not import `index.ts`.

### Current State Already Done
- `src/server/http.ts`: `baseHeaders`, `jsonResponse` (wired)
- `src/server/ws.ts`: websocket handlers open/close/message (wired)
- `src/server/routes/api/notify.ts`: handler for `POST /api/whatsapp/send` (present; not fully wired yet)
- `/status` webhook exists inside `index.ts` (to be moved)

### Target Module Structure
- `src/server/http.ts`
  - `baseHeaders`, `jsonResponse` (already in place)

- `src/server/ws.ts`
  - `wsHandlers.open/close/message` (already in place)

- `src/server/routes/api/conversations.ts`
  - `GET /api/conversations`
  - `GET /api/conversations/:id/messages`
  - `POST /api/conversations/:id/send`
  - `POST /api/conversations/:id/toggle-bot`

- `src/server/routes/api/notify.ts`
  - `POST /api/whatsapp/send` (already created; ensure index wiring delegates here)

- `src/server/routes/webhooks.ts`
  - `POST /whatsapp/webhook` (Twilio form payload)
  - `POST /webhook` (Meta JSON webhook)
  - `GET /webhook` (verification)

- `src/server/routes/status.ts`
  - `POST /status` payment state webhook (move from `index.ts`)

- `src/server/routes/admin.ts`
  - `GET /api/admin/restaurants?status=PENDING_APPROVAL`
  - `POST /api/admin/restaurants/:id/(approve|reject)`
  - Use string statuses `'PENDING_APPROVAL'|'ACTIVE'|'REJECTED'` (no enum import coupling)

- `src/handlers/orderStatus.ts`
  - `ORDER_STATUS_SEQUENCE`, `orderStatusTimers`
  - `stopOrderStatusSimulation`
  - `scheduleNextOrderStatus`
  - `advanceOrderStatus`
  - `startOrderStatusSimulation`

- `src/state/bot.ts`
  - Export `getGlobalBotEnabled()`, `setGlobalBotEnabled(v: boolean)`
  - Export `welcomedUsers` accessors: `hasWelcomed(phone)`, `markWelcomed(phone)`

- `src/handlers/processMessage.ts`
  - `processMessage`
  - Helper exports: `sendItemMediaMessage`, `finalizeItemQuantity`, `sendMenuCategories`, `sendBranchSelection`, `resolveRestaurantContext`, `sendWelcomeTemplate`
  - Depend on `TwilioClientManager`, `state/*`, `workflows/*`

### Extraction Order (Safe Steps)
1) Create `src/handlers/orderStatus.ts` and move:
   - `ORDER_STATUS_SEQUENCE`, `orderStatusTimers`
   - `stopOrderStatusSimulation`, `scheduleNextOrderStatus`, `advanceOrderStatus`, `startOrderStatusSimulation`
   - Replace `index.ts` definitions with imports.

2) Move `/status` to `src/server/routes/status.ts`:
   - Export `handleStatus(req: Request, url: URL)` returning `Response|null`.
   - In `index.ts` fetch, insert:
     ```ts
     const { handleStatus } = require('./src/server/routes/status');
     const statusRes = await handleStatus(req, url);
     if (statusRes) return statusRes;
     ```

3) Wire `src/server/routes/api/notify.ts` from `index.ts`:
   - Similar pattern:
     ```ts
     const { handleWhatsAppSend } = require('./src/server/routes/api/notify');
     const sendRes = await handleWhatsAppSend(req, url);
     if (sendRes) return sendRes;
     ```

4) Extract admin routes to `src/server/routes/admin.ts`:
   - `handleAdmin(req, url)` covering GET list and POST approve/reject.
   - Replace enum references with strings.

5) Create `src/state/bot.ts`:
   - Move `globalBotEnabled` and `welcomedUsers` from `index.ts`.
   - Provide getters/setters; update imports in handlers/routes.

6) Extract `processMessage` and helpers to `src/handlers/processMessage.ts`:
   - Move: `processMessage`, `sendItemMediaMessage`, `finalizeItemQuantity`, `sendMenuCategories`, `sendBranchSelection`, `resolveRestaurantContext`, `sendWelcomeTemplate`.
   - Accept dependencies via imports (`TwilioClientManager`, `state/*`, `workflows/*`, `utils/*`).
   - In webhooks routes, import and call `processMessage`.

7) Extract Twilio/Meta webhooks to `src/server/routes/webhooks.ts`:
   - Export `handleTwilioForm(req, url)`, `handleMeta(req, url)`, `handleVerify(req, url)` and call from `index.ts`.

### Interfaces & Re-exports
- Ensure `processMessage` signature remains:
  ```ts
  export async function processMessage(phoneNumber: string, messageBody: string, messageType?: string, extra?: any): Promise<void>
  ```
- Ensure handlers use `TwilioClientManager.getClient(restaurantId)` and never instantiate Twilio directly.
- Use `jsonResponse` for all JSON API routes.

### Circular Imports Prevention
- Routes import handlers and utilities; handlers must not import routes or `index.ts`.
- Shared state lives in `src/state/*`.

### Lint/Checks After Each Step
- Run a quick lint for edited files.
- Hit `GET /health` to confirm server boots.
- Smoke test:
  - `POST /api/conversations/:id/send`
  - `POST /api/whatsapp/send`
  - WebSocket connect `/ws`

### Definition of Done
- `index.ts` reduced to:
  - startup/bootstrapping (cache seed)
  - Bun.serve with minimal router delegating to modules
  - websocket wiring
- All endpoints and flows behave exactly as before.

### Notes & Gotchas
- Keep string statuses for admin endpoints: `'PENDING_APPROVAL'|'ACTIVE'|'REJECTED'`.
- For button-click flows, use `sendNotification(twilioClient, ...)` signature.
- Do not change Arabic text content or order-status timings.



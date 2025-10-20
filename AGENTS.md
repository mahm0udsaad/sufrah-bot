# Repository Guidelines

## Project Structure & Module Organization
The Bun entrypoint `index.ts` orchestrates HTTP/websocket handling and wires in workflow utilities under `src`. Domain logic is segmented by responsibility: `src/server` exposes routes, `src/workflows` manages cache and event broadcasting, `src/state` wraps in-memory and persisted state, and `src/services`, `src/handlers`, and `src/utils` provide reusable primitives. Database assets live in `prisma/` (schema, migrations, seed) and long-running jobs reside in `src/workers`. Partner-facing documentation and diagrams belong in `docs/`. Keep tenant-specific assets in dedicated subdirectories to avoid mixing operational data with shared code.

## Build, Test, and Development Commands
Install dependencies with `bun install` and start the API via `bun run index.ts`. Use `bun run --watch index.ts` during active development, and pair background processing with `bun run src/workers/outboundWorker.ts` (or the watch variant). Apply Prisma updates through `bunx prisma generate`, `bunx prisma migrate dev`, and `bunx prisma db seed` when seeding fixtures. Run `bunx prisma migrate deploy` before shipping schema changes.

## Coding Style & Naming Conventions
Write TypeScript with Bun’s ESNext target and strict mode in mind; avoid implicit `any` and prefer explicit return types on exported functions. Follow the existing two-space indentation and trailing comma style. Use descriptive module names (e.g., `twilioWebhookHandler.ts`) and camelCase for variables/functions, PascalCase for classes/types, and UPPER_SNAKE_CASE for constants. Export a single responsibility per file, favour named exports, and colocate protocol adapters under `src/server/routes`.

## Testing Guidelines
Adopt Bun’s built-in test runner (`bun test`) and colocate unit tests under `src/**/__tests__` or `tests/` for integration flows. Mirror file names (`conversations.test.ts`) to clarify coverage. Mock external services such as Twilio and Redis; rely on the Prisma test database via `DATABASE_URL` overrides. Aim to cover conversation lifecycle, caching workflows, and worker queue interactions before merging. Document intentional gaps in the PR if coverage cannot be achieved.

## Commit & Pull Request Guidelines
Recent history uses single-word messages; improve clarity by composing imperative, scope-prefixed summaries such as `feat(state): track active carts`. Group related changes per commit, run lint/tests beforehand, and reference issue IDs when applicable. Pull requests should outline behaviour changes, include instructions for reproducing manual test results, note required env vars (e.g., `CONTENT_SID_*`, Redis/Twilio secrets), and attach screenshots or logs for admin UI updates. Request review from a second agent before merging impactful data or schema work.

## Security & Configuration Tips
Store secrets in a local `.env` file that feeds both Bun and Prisma; never commit credentials. Regenerate Prisma client whenever the schema changes to avoid runtime drift. Validate inbound webhook signatures where applicable, and ensure Redis/Twilio endpoints are configurable per tenant. When adding new cache keys, seed them via `seedCacheFromKey` at startup to prevent undefined flows.

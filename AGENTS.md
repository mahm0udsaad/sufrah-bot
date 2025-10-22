# Repository Guidelines

## Project Structure & Module Organization
`index.ts` is the Bun entrypoint that wires HTTP and websocket handlers into utilities under `src/`. Route contracts live in `src/server`, workflow orchestration in `src/workflows`, state caches in `src/state`, and reusable helpers across `src/services`, `src/handlers`, and `src/utils`. Persisted schema assets sit inside `prisma/` (schema, migrations, seed). Background jobs execute from `src/workers`, shared docs stay under `docs/`, and tenant-specific assets should be isolated within dedicated subdirectories.

## Build, Test, and Development Commands
- `bun install` — install project dependencies.
- `bun run index.ts` — launch the HTTP/websocket server; add `--watch` during active development.
- `bun run src/workers/outboundWorker.ts` — start outbound queue processing; pair with the watch flag when iterating.
- `bunx prisma generate` — refresh Prisma client after schema edits.
- `bunx prisma migrate dev` / `bunx prisma db seed` — apply local migrations and seed fixtures; deploy schema updates via `bunx prisma migrate deploy`.
- `bun test` — execute the full automated test suite.

## Coding Style & Naming Conventions
Write TypeScript using ESNext features with strict type checking enabled. Use two-space indentation, trailing commas, and explicit return types for exported functions. Prefer named exports, keep files single-purpose, and choose descriptive names (`twilioWebhookHandler.ts`). Follow camelCase for variables/functions, PascalCase for classes and types, and UPPER_SNAKE_CASE for constants.

## Testing Guidelines
Colocate unit tests under `src/**/__tests__` and broader flows in `tests/`, mirroring filenames (`conversations.test.ts`). Use Bun’s built-in runner via `bun test`. Mock Twilio, Redis, and other external services; override Prisma connections with a test `DATABASE_URL`. Target coverage for conversation lifecycles, cache workflows, and worker queue interactions before merging.

## Commit & Pull Request Guidelines
Adopt imperative, scope-prefixed commit subjects such as `feat(state): track active carts`, grouping related changes together. Run `bun test` (and relevant workers) before committing. Pull requests should summarize behaviour changes, note reproduction steps, list required env vars, and attach screenshots or logs for UI adjustments. Request a second-agent review for impactful schema or data changes.

## Security & Configuration Tips
Keep secrets in `.env` files consumed by Bun and Prisma; never commit credentials. Regenerate the Prisma client whenever the schema changes to prevent runtime drift. Validate inbound webhook signatures, ensure Redis/Twilio endpoints are tenant-configurable, and seed new cache keys during startup with `seedCacheFromKey` to avoid undefined flows.

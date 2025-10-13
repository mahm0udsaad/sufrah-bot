# Repository Guidelines

## Project Structure & Module Organization
This Bun-based TypeScript service uses `index.ts` as the entrypoint for HTTP routing and queue setup. Application code lives in `src/`, with key modules: `server/` for Express bindings, `handlers/` for inbound message paths, `services/` for integrations, `workflows/` for conversational control, `workers/` for BullMQ processors, `redis/` for connection helpers, and `state/` to manage tenant context. Shared utilities sit in `helpers.ts` and `src/utils/`. Database schema, migrations, and seeds are in `prisma/`, while architectural notes and prompts live under `docs/`.

## Build, Test, and Development Commands
Install dependencies with `bun install`. Start the API locally via `bun run index.ts`; add `--watch` for live reload. Kick off queue processors with `bun run src/workers/outboundWorker.ts`. Database workflows rely on Prisma: `bunx prisma migrate dev` applies local migrations, `bunx prisma db seed` loads sample data, `bunx prisma generate` refreshes the client, and `bunx prisma studio` opens the visual inspector.

## Coding Style & Naming Conventions
Code is strict TypeScript—stick to 2-space indentation, ES modules, and explicit extensions when importing local files (`moduleResolution: bundler`). Use `camelCase` for functions and variables, `PascalCase` for classes/types, and `SCREAMING_SNAKE_CASE` for constants. Place new workflows, services, and handlers beside their peers to preserve module cohesion. Run `bunx prisma format` before committing schema changes, and load sensitive values through `src/config.ts` instead of hard-coding secrets.

## Testing Guidelines
Automated tests are not yet committed; introduce coverage with Bun’s built-in runner using filenames such as `*.spec.ts` or directories like `src/**/__tests__`. Focus on Twilio webhook handlers, Redis queue publishing, and Prisma persistence—inject dependencies to isolate external services. Until suites exist, perform smoke tests against the Twilio sandbox and confirm outbound jobs drain without retries. Document manual verification steps in pull requests.

## Commit & Pull Request Guidelines
Recent history uses terse messages like “update”; prefer imperative, scoped commits (e.g., `feat: add reservation workflow dispatcher`). Reference issue numbers when available and keep commits logically sized. Pull requests should summarize intent, list new environment variables, link supporting docs in `docs/`, and attach screenshots or curl transcripts for webhook changes. Confirm relevant Bun and Prisma commands ran successfully and note follow-up tasks.

## Configuration & Secrets
Create a `.env` file mirroring keys defined in `src/config.ts` (Twilio credentials, Redis URLs, Prisma `DATABASE_URL`, Sufrah tokens, queue settings). Never commit real credentials. Use separate Redis queues and database URLs per environment, and rotate the default `JWT_SECRET` before deployment.

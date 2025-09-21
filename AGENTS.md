# Repository Guidelines

## Project Structure & Module Organization
The bot boots from `index.ts`, which wires Twilio webhooks, order state, and outbound messaging. Shared code lives in `src/`: `config.ts` reads environment flags, `state/` tracks carts and conversations, `twilio/` wraps messaging and content APIs, `utils/` centralizes text and geocode helpers, and `workflows/` holds menu data, quick replies, caching, and event broadcasting. Types sit in `src/types`. Reference material belongs in `docs/`; legacy utilities that predate the modular split remain in `helpers.ts`.

## Build, Test, and Development Commands
Run `bun install` before your first build or when dependencies change. Use `bun start` (alias for `bun run index.ts`) to launch the HTTP server Twilio targets. For local iteration, `bun run --watch index.ts` reloads when files under `src/` change. Restart the process after editing `.env` so updated secrets are picked up.

## Coding Style & Naming Conventions
Extend the existing TypeScript style: 2-space indentation, trailing commas, single quotes, and explicit return types for exported helpers. Functions and instances use `camelCase`, types and components use `PascalCase`, and constants such as `FOOD_CATEGORIES` remain UPPER_SNAKE_CASE. Keep modules feature-scoped—augment `state/orders.ts` or `workflows/quickReplies.ts` instead of introducing parallel helpers. Run `bun format` or your editor’s TypeScript formatter before committing to keep diffs readable.

## Testing Guidelines
Automated tests are not yet present; prioritize adding Bun-powered unit tests under `src/__tests__/` as modules stabilize. Name files `*.test.ts`, mirror the source path, and cover flows like empty cart handling, invalid menu selections, and webhook retries. Until then, describe manual validation (e.g., Twilio Sandbox transcript, outgoing message logs) in pull requests to document coverage.

## Commit & Pull Request Guidelines
History shows short, lower-case commit titles; prefer clear, imperative summaries such as `Add branch lookup caching`. Keep commits focused, document breaking changes, and reference related issues. PRs should include a concise purpose, notable code-level changes, testing evidence, and any configuration updates reviewers need. Attach screenshots or transcripts when UI or conversation copy changes.

## Configuration & Secrets
Create a root-level `.env` with the required keys: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`, `VERIFY_TOKEN`, `PAYMENT_LINK`, `SUPPORT_CONTACT`, and optional `NOMINATIM_USER_AGENT` or `CONTENT_SID_*` entries used by the caching layer. Never commit real credentials; rely on deployment secret stores and document required additions in PRs so others can mirror their environment.

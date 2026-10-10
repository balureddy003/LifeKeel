# @lifekeel/api

The LifeKeel backend — Fastify, trimmed down from kairos-ai's full
multi-vertical `apps/api` to just what `apps/web` calls plus the marketing
surfaces (blog, case studies, growth events). See `ARCHITECTURE.md` for how
this maps to the four-layer LifeKeel vision, and root `SECURITY.md` for
exactly what was removed from the original copy and why.

## Layout

`src/server.ts` is the bootstrap entry point — env/engine/ML-subsystem
construction, cron scheduling, route registration, in one file (a known
"god object," flagged as a modularity improvement worth doing — see
`ARCHITECTURE.md`/`CLAUDE.md`). Everything it wires together:

- `src/routes/` — the registered route modules (auth, family group/
  financial-profile/connectors/inbox, documents, billing, insights, assets,
  legacy, readiness, metrics, blog, growth, operator, ...). Every other route
  file kairos-ai shipped was deleted, not just unregistered. `routes/internal-cron.ts`
  is the Cloud Scheduler entry point (see "Scheduled jobs" below).
- `src/ocr/` — document extraction (insurance policies, pension statements →
  structured fields): a cloud vision model by default, or local Tesseract plus
  a small self-hosted model when `LOCAL_JUDGE_BASE_URL` is set.
- `src/email/` — IMAP + Gmail OAuth connector, email classification.
- `src/billing/` — Stripe integration (Keel Plus).
- `src/goals/`, `src/outcomes/`, `src/trading/portfolio-data.ts` — mostly
  inert leftovers, kept alive only because `routes/settings.ts` (itself kept
  only for its `getTenantLlmConfig` export, used by the workflow queue) has
  a transitive dependency chain reaching them. Not active LifeKeel features.

## Commands

```bash
pnpm dev            # http://localhost:3001; builds workspace packages first, sources ../../.env
pnpm dev:watch      # same, restarts on file changes
pnpm debug          # watch mode with the Node inspector on port 9229 (VS Code: "Debug API")
pnpm build          # tsc
pnpm start          # run the built server (dist/server.js)
pnpm migrate        # run database migrations (they also run at boot)
pnpm test           # vitest. Most tests need no services. The real-database tests
                    # (ml-tenant-isolation, email-scan-fanout) need MONGODB_URL and
                    # REDIS_URL; with CI=true a missing service FAILS them instead of skipping
pnpm typecheck
```

Run the root `pnpm typecheck` / `pnpm test` for real verification: inside one package they can show false
"cannot find module '@lifekeel/...'" errors until sibling packages are built.

Root `.env.example` documents required/optional environment variables. Values in `.env` win over variables
exported in your shell. `docker-compose.yml` here defines MongoDB, Redis and an `api` service; for local
development start only the databases:
`docker compose -f apps/api/docker-compose.yml up -d mongodb redis`.

## Health and first user

`GET /health/live` (process is up) and `GET /health/ready` (200 only when MongoDB is reachable; 503 otherwise).
Create a user at `POST /auth/signup` (or the web app's /signup). `GET /auth/demo-token` gives a throwaway
admin demo session in development; it is disabled when `NODE_ENV=production` unless `ALLOW_DEMO_TOKENS` is set.

## Scheduled jobs

Jobs (email scan, sweeps, reminders, digests) run in this process under node-cron by default
(`CRON_MODE` unset or `internal`). For Cloud Run with scale-to-zero set `CRON_MODE=external` and
`CRON_TICK_SECRET`, and have one Cloud Scheduler job call `POST /internal/cron/tick` each minute
(`infra/gcp/README.md`). Never run both modes at once; in `internal` mode the tick answers 409.

## Evals and local models

`node dist/eval/local-model-eval.js` (needs `LOCAL_JUDGE_BASE_URL`) is the safety gate for a self-hosted
model; the detector golden datasets run as part of `pnpm test`. See `docs/local-testing.md`.

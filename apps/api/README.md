# @agentoak/api

The Agent Oak backend — Fastify, trimmed down from kairos-ai's full
multi-vertical `apps/api` to just what `apps/web` calls plus the marketing
surfaces (blog, case studies, growth events). See `ARCHITECTURE.md` for how
this maps to the four-layer Agent Oak vision, and root `SECURITY.md` for
exactly what was removed from the original copy and why.

## Layout

`src/server.ts` is the bootstrap entry point — env/engine/ML-subsystem
construction, cron scheduling, route registration, in one file (a known
"god object," flagged as a modularity improvement worth doing — see
`ARCHITECTURE.md`/`CLAUDE.md`). Everything it wires together:

- `src/routes/` — 15 registered route modules (auth, family group/
  financial-profile/connectors/inbox, documents, billing, insights,
  connector-credentials, metrics, settings, blog, case-studies,
  growth-events). Every other route file kairos-ai shipped was deleted, not
  just unregistered.
- `src/ocr/` — GPT-4o vision document extraction (insurance policies,
  pension statements → structured fields).
- `src/email/` — IMAP + Gmail OAuth connector, email classification.
- `src/billing/` — Stripe integration (Oak Plus).
- `src/goals/`, `src/outcomes/`, `src/trading/portfolio-data.ts` — mostly
  inert leftovers, kept alive only because `routes/settings.ts` (itself kept
  only for its `getTenantLlmConfig` export, used by the workflow queue) has
  a transitive dependency chain reaching them. Not active Agent Oak features.

## Commands

```bash
pnpm dev            # http://localhost:3001, sources ../../.env
pnpm build           # tsc
pnpm test            # vitest — needs MONGODB_URL/REDIS_URL for
                      # ml-tenant-isolation.test.ts; everything else runs
                      # without external services
pnpm typecheck
```

Root `.env.example` documents required/optional environment variables.
`docker-compose.yml` here starts a local Mongo + Redis for `pnpm dev`.

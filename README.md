# LifeKeel

**The autonomous digital twin for your family.**

Keel is a multi-agent family financial-readiness and crisis-protection
ecosystem: a family orchestrator (Keel HQ) plus a digital twin per member,
a Digital Estate Vault, and an automated ingestion engine that learns from
the documents you upload. It understands your family's life, protection
and preferences, anticipates what you may need, and acts on your behalf
when it matters most.

*When life doesn't go to plan, LifeKeel knows what to do next.*

Full product vision, current architecture, and phased roadmap:
[ARCHITECTURE.md](ARCHITECTURE.md). Repo conventions, gotchas, and the
PRD→production process: [CLAUDE.md](CLAUDE.md). What's been trimmed from
the original codebase and known deferred issues: [SECURITY.md](SECURITY.md).

## Repo layout

```
apps/web      Next.js frontend — @lifekeel/web
apps/api      Fastify backend  — @lifekeel/api
packages/*    Shared libraries (engine, platform, connector pipeline, ...)
```

## Quick start

Needs Node >= 22.12 and pnpm 8.15.5 (`corepack enable && corepack prepare pnpm@8.15.5 --activate`).

```bash
pnpm install

# 1. A database. MongoDB is required; Redis is optional locally.
docker compose -f apps/api/docker-compose.yml up -d mongodb redis

# 2. Config. The API refuses to start without a JWT_SECRET of at least 32 characters
#    (.env.example has a valid placeholder) and a reachable MongoDB.
cp .env.example .env                       # apps/api
cp apps/web/.env.example apps/web/.env     # apps/web

# 3. Run both apps (two terminals)
pnpm --filter @lifekeel/api dev    # http://localhost:3001  (builds the workspace packages first)
pnpm --filter @lifekeel/web dev    # http://localhost:3002
```

Check it works: `curl localhost:3001/health/ready` returns 200 (503 means the API cannot reach MongoDB).

**Your first user:** open http://localhost:3002/signup, or
`curl -X POST localhost:3001/auth/signup -H 'content-type: application/json' -d '{"email":"you@example.com","password":"a-long-password-123","name":"You"}'`.
Outbound email (verification, notifications) and AI features need provider keys in `.env`; without them the
rest of the app still runs. `GET /auth/demo-token` returns a throwaway demo session in development only
(it is disabled in production unless `ALLOW_DEMO_TOKENS` is set).

Notes:
- Values in `.env` **win over** variables exported in your shell (the dev scripts source it), so edit `.env`
  to change `MONGODB_URL` and similar.
- `apps/api/docker-compose.yml` also defines an `api` service that builds the production image; the command
  above starts only the databases, which is what you want alongside `pnpm dev`.

Whole workspace checks (what CI runs):

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

How to run every CI check locally (integration tests, boot smoke test, image builds, model evals, macOS
notes): [docs/local-testing.md](docs/local-testing.md).

## Local debugging

Make sure MongoDB and any Redis instance configured in the root `.env` are
already running. To start both apps in watch mode with Node inspectors:

```bash
pnpm debug
```

The API runs at `http://localhost:3001` with its inspector on port 9229. The
Next.js app runs at `http://localhost:3002`; its inspectors start at port 9230,
and child processes may use the next available port. The same scripts can be
run separately with
`pnpm --filter @lifekeel/api debug` and
`pnpm --filter @lifekeel/web debug`.

In VS Code, select **Debug Web + API** to launch both servers and open a Chrome
debugger for the web app. Use **Debug API**, **Debug Web Server**, or
**Debug Web Browser** when only one execution context is needed. API and
server-side Next.js breakpoints attach to their server launch targets; client
component breakpoints attach to the browser target.

## Deploying

Deploys are manual GitHub Actions (`workflow_dispatch`): **Deploy** (web, Firebase Hosting), **Deploy API** and
**Deploy Local Judge** (Cloud Run). The lowest-cost GCP setup and how it scales: [infra/gcp/README.md](infra/gcp/README.md).
Mapping `lifekeel.co.uk` and `lifekeel.si` (Hostinger DNS to Firebase), with a checker: [docs/domains.md](docs/domains.md).
CI/CD minutes on the free tier: [docs/ci-cd-cost.md](docs/ci-cd-cost.md).

## Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| API exits with `FATAL: Invalid environment configuration` | A required value is missing or invalid, most often `JWT_SECRET` shorter than 32 characters. The log line names the field. |
| `/health/ready` returns 503 | The API is up but cannot reach MongoDB. Start it (`docker compose ... up -d mongodb`) and check `MONGODB_URL` in `.env`. |
| Signup or login returns 500 | Check the API log. `An existing index has the same name as the requested index` means the local database has indexes left by an older version: drop it (`MONGODB_DB` in `.env`) and restart. |
| `Cannot find module '@lifekeel/...'` | Workspace packages are not built or links are stale (for example after the rename from `@agentoak/*`). Run `pnpm install`, then the root `pnpm build` (or start via `pnpm --filter @lifekeel/api dev`, which builds them). |
| Web page renders unstyled | You ran `pnpm build`/`pnpm typecheck` while `next dev` was running. Stop the dev server, delete `apps/web/.next`, start again (see CLAUDE.md). |
| Port 3001/3002 already in use | Another dev server is running. Stop it, or change `PORT` in `.env` / pass another port to Next. |
| `next build` cannot fetch Google Fonts | Sandboxed or proxied network: Turbo hides proxy variables from child tasks. Run `pnpm exec turbo run <task> --env-mode=loose`. |

## Status

Greenfield — pre-launch, no production users yet. Locally, `apps/web` talks to your own `apps/api`
(`NEXT_PUBLIC_API_URL=http://localhost:3001`). The deployed web app may still point at a shared external
backend. See `ARCHITECTURE.md`'s "where the vision meets reality today" table for what's built versus planned.

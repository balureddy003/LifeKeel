# Agent Oak

**The autonomous digital twin for your family.**

Oak is a multi-agent family financial-readiness and crisis-protection
ecosystem: a family orchestrator (Oak HQ) plus a digital twin per member,
a Digital Estate Vault, and an automated ingestion engine that learns from
the documents you upload. It understands your family's life, protection
and preferences, anticipates what you may need, and acts on your behalf
when it matters most.

*When life doesn't go to plan, Oak knows what to do next.*

Full product vision, current architecture, and phased roadmap:
[ARCHITECTURE.md](ARCHITECTURE.md). Repo conventions, gotchas, and the
PRD→production process: [CLAUDE.md](CLAUDE.md). What's been trimmed from
the original codebase and known deferred issues: [SECURITY.md](SECURITY.md).

## Repo layout

```
apps/web      Next.js frontend — @agentoak/web
apps/api      Fastify backend  — @agentoak/api
packages/*    Shared libraries (engine, platform, connector pipeline, ...)
```

## Quick start

```bash
pnpm install
cp .env.example .env               # apps/api — needs JWT_SECRET, MONGODB_URL
cp apps/web/.env.example apps/web/.env   # apps/web — NEXT_PUBLIC_API_URL

pnpm --filter @agentoak/api dev    # http://localhost:3001
pnpm --filter @agentoak/web dev    # http://localhost:3002
```

Or from repo root, across the whole workspace:

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

`apps/api/docker-compose.yml` starts a local MongoDB + Redis if you don't
have them running already.

## Status

Greenfield — pre-launch, no production users yet. `apps/web` currently
points at a shared external backend (`NEXT_PUBLIC_API_URL`) rather than this
repo's own `apps/api`, which isn't deployed yet. See `ARCHITECTURE.md`'s
"where the vision meets reality today" table for exactly what's built versus
planned.

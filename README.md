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
`pnpm --filter @agentoak/api debug` and
`pnpm --filter @agentoak/web debug`.

In VS Code, select **Debug Web + API** to launch both servers and open a Chrome
debugger for the web app. Use **Debug API**, **Debug Web Server**, or
**Debug Web Browser** when only one execution context is needed. API and
server-side Next.js breakpoints attach to their server launch targets; client
component breakpoints attach to the browser target.

## Status

Greenfield — pre-launch, no production users yet. `apps/web` currently
points at a shared external backend (`NEXT_PUBLIC_API_URL`) rather than this
repo's own `apps/api`, which isn't deployed yet. See `ARCHITECTURE.md`'s
"where the vision meets reality today" table for exactly what's built versus
planned.

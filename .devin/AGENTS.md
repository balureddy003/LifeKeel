# LifeKeel — Devin agent notes

This is a companion to [CLAUDE.md](../CLAUDE.md). It focuses on the mechanical
facts an AI agent needs to move safely and quickly in the monorepo.

## Workspace shape

- `apps/web` — Next.js 15 App Router, static-exported for Firebase Hosting.
- `apps/api` — Fastify backend, entry points `src/server.ts` and `src/migrate.ts`.
- `apps/mobile` — Capacitor shell, **not built by root scripts** (no `build`/`test`/`typecheck` scripts).
- `packages/*` — shared libraries consumed by `apps/api`.
- Runtime resource directories at repo root: `detectors/`, `connectors/`,
  `verticals/`, `detector-evals/`, `playbooks/`, `category-table.yaml`,
  `runbooks.yaml`. These are load-bearing and read via `path.join(ROOT, ...)`;
  do not treat them as unused config.

## Commands to verify before declaring success

Always run from the repo root so Turbo can build workspace dependencies in
order:

```bash
pnpm install
pnpm check     # typecheck + lint + test + build
pnpm clean     # remove all dist/ and .next/ outputs
pnpm format    # format with Prettier (currently not enforced in CI)
```

Individual tasks:

```bash
pnpm typecheck   # includes tsc builds + Next build
pnpm lint
pnpm test
pnpm build
```

Use filters for local iteration only when you already know the workspace is
built:

```bash
pnpm --filter @lifekeel/api dev     # http://localhost:3001
pnpm --filter @lifekeel/web dev     # http://localhost:3002
pnpm debug                          # both in watch + inspector mode
```

## Critical gotchas

1. **Do not run `pnpm typecheck` or `pnpm build` while `next dev` is running.**
   `turbo run typecheck` invokes `next build`, which overwrites `.next/`
   underneath the dev server. Recovery: stop dev, delete `apps/web/.next`,
   restart `pnpm --filter @lifekeel/web dev`.
2. **Always verify via root `pnpm test`/`pnpm typecheck`.** Per-package runs
   can fail with false "cannot find module @lifekeel/x" errors because Turbo
   has not built the sibling `dist/` outputs yet.
3. **`turbo.json` `test` and `typecheck` depend on `build` + `^build`.** Packages
   that self-import (e.g. `@lifekeel/platform` tests import `@lifekeel/platform`)
   need their own `dist/` built first.
4. **Mongo/Redis integration tests need the services locally.**
   `apps/api/src/__tests__/ml-tenant-isolation.test.ts` has no skip guard and
   fails without MongoDB; `email-scan-fanout.integration.test.ts` skips itself
   unless MongoDB/Redis are running. CI provisions them via
   `.github/workflows/ci.yml`.
5. **Shared ESLint config.** `@lifekeel/eslint-config` provides `base` and
   `node` presets. `apps/web` keeps its own Next.js config to avoid React
   parser conflicts. Backend packages (`apps/api`, `packages/*`) use the `node`
   preset. Warnings are expected; errors must be fixed before committing.
6. **`apps/mobile` is intentionally outside the build/test graph.** Do not add
   it to root scripts or expect Turbo to run tasks there.

## Cleaned-up dead weight (do not re-introduce)

The following were removed in recent cleanup passes:

- `apps/api/src/goals/*`, `apps/api/src/outcomes/*`, and related jobs.
- `packages/engine/src/trading/*` and backtest scripts.
- `packages/workflows/src/engine/*`.
- `packages/outcome-kernel`, `packages/conformance`, `packages/legacy-compat`.
- Non-family connectors/verticals YAMLs.

If you find yourself re-adding these surfaces, confirm with the human first —
they were intentionally cut from LifeKeel scope.

## Conventions

- Prefer deleting dead code over commenting it out.
- Keep `package.json` `description` accurate; do not add per-package READMEs
  that duplicate it.
- Run `pnpm format` before opening a PR if you touched many files; otherwise
  `lint-staged` will format staged files automatically on commit.
- When adding a new package, extend `@lifekeel/eslint-config/node` and add a
  `lint` script so it participates in `pnpm lint`.
- New family signals require: (1) schema change in
  `apps/api/src/routes/family-financial-profile.ts`, (2) a detector YAML in
  `detectors/family/`, (3) a web form field in `apps/web`.
- Product/regulated boundaries are in [CLAUDE.md](../CLAUDE.md); read it
  before touching trust tiers, advice copy, or autonomous actions.

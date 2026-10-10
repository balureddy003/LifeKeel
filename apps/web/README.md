# @lifekeel/web

The LifeKeel frontend — Next.js App Router, static-exported (`pnpm build:export`)
and served from Firebase Hosting (see `firebase.json`/`.firebaserc`). No
server runtime in production; all state comes from `apps/api` over HTTP
(`NEXT_PUBLIC_API_URL`). Locally that is `http://localhost:3001`, your own `apps/api`
(`apps/web/.env.example`); the deployed app may still point at a shared backend (see `ARCHITECTURE.md`).

## Layout

- `src/app/` — routes (App Router). `welcome`/`login`/`signup` (onboarding),
  `family`/`family-setup` (roster), `financial-profile` (Family Twin data
  entry), `documents`/`upload` (OCR intake), `inbox`/`events` (Family
  Intelligence output), `assistant` (currently hardcoded responses — see
  `ARCHITECTURE.md`), `settings`/`upgrade` (billing).
- `src/lib/api.ts` — the entire HTTP contract with `apps/api`, one function
  per endpoint. If you're adding a backend route, add its client function
  here.
- `src/lib/auth-context.tsx` — session state (token in `localStorage`,
  documented as a known, deliberately deferred issue in `SECURITY.md`).
- `src/lib/observability.ts` — error/perf reporting, no-op until
  `NEXT_PUBLIC_SENTRY_DSN` is set.
- `public/sw.js` — the PWA service worker (offline shell caching + push
  notification handling).

## Commands

```bash
pnpm dev            # http://localhost:3002
pnpm debug          # same, with the Node inspector on port 9230 (VS Code: "Debug Web Server")
pnpm build:export   # production build (Firebase static export)
pnpm test           # vitest
pnpm test:e2e       # Playwright end-to-end tests
pnpm typecheck / lint
```

Do not run the root `pnpm build` or `pnpm typecheck` while `pnpm dev` is running: they overwrite
`apps/web/.next` and the dev server serves broken pages (stop it, delete `apps/web/.next`, restart).
Start the API first (`pnpm --filter @lifekeel/api dev`); browser calls go to `NEXT_PUBLIC_API_URL`.

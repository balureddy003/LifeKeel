# @lifekeel/web

The LifeKeel frontend — Next.js App Router, static-exported (`pnpm build:export`)
and served from Firebase Hosting (see `firebase.json`/`.firebaserc`). No
server runtime in production; all state comes from `apps/api` over HTTP
(`NEXT_PUBLIC_API_URL`, currently the shared kairos-ai backend — see
`ARCHITECTURE.md`).

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
pnpm build:export   # production build (Firebase static export)
pnpm test           # vitest
pnpm typecheck / lint
```

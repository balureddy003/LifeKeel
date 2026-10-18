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

### End-to-end tests (device matrix)

```bash
pnpm exec playwright install chromium webkit   # once
pnpm test:e2e                                  # starts the local API + web, runs every project
pnpm test:e2e --project=iphone                 # one device
E2E_WEB_BASE=https://app.lifekeel.si E2E_API_BASE=https://api.lifekeel.si pnpm test:e2e
```

Projects: `chromium-desktop` (all specs), plus `webkit-desktop`, `iphone`,
`android` and `ipad` (the device-agnostic specs listed as `DEVICE_SPECS` in
`playwright.config.ts`: anonymous check, logout purge, responsive layout).
Needs MongoDB/Redis for the API — see `docs/local-testing.md`. Not run in CI.

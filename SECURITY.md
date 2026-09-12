# Security

This is a private repository. If you find a security issue, open a GitHub issue
or contact the repo owner directly rather than filing publicly.

## Repo layout

- `apps/web` — the Trellis Next.js frontend (static-exported to Firebase Hosting).
- `apps/api` — kairos-ai's `apps/api` Fastify backend, copied wholesale on
  2026-09-12 (to keep parity with the source repo and minimize risk), then
  trimmed on the same day to what Trellis actually calls plus the marketing
  surfaces (blog, case studies, growth events) that support self-serve
  growth. See "Trimmed from the full copy" below for exactly what was
  removed. Currently NOT deployed — `apps/web` still points at the shared
  kairos-ai backend (see `apps/web/.env.example`) until this one is
  provisioned (own MongoDB, own GCP secrets — see root `.env.example` and
  `.github/workflows/deploy-api.yml`) and cut over.
- `detectors/`, `connectors/`, `definitions/`, `verticals/`, `detector-evals/`,
  `category-table.yaml`, `scripts/fetch-yfinance.py` — runtime resource files
  `apps/api` reads via `path.join(ROOT, ...)`. Required for the API to boot
  with real detector/connector/vertical data; copied wholesale alongside it.
  These still contain non-family verticals' YAML (trading, social, etc.) —
  harmless (nothing routes to them without the dropped detector/vertical
  routes) but not pruned in this pass.

## Trimmed from the full copy (2026-09-12)

The full copy included kairos-ai's entire multi-vertical SaaS surface —
trading, property, social, SCIM/enterprise identity, federated learning,
marketplace, teams, goals/workflows — none of it reachable from Trellis.
Trimmed down `apps/api/src/server.ts` from 67 registered route modules to
13 (auth, connector-credentials, family group/financial-profile/connectors/
inbox, documents, billing, insights, blog, case-studies, growth-events),
plus the Prometheus `/metrics` endpoint (generic ops tooling, kept
regardless of vertical). Also removed:

- ~15 scheduled cron jobs that were trading/goals/social/federated-specific
  (auto-trade confirmation, momentum rebalance, shadow backtest, KPI
  compute, goal integrity/summarisation/migration, social analytics
  polling, federated learning rounds, adaptive-threshold recompute for
  invoice/payment/portfolio signals). Kept: billing cron, calibration
  drift/fitting, daily digest, retention worker, insight SLA/escalation,
  FeatureHashScorer offline eval, connector sync/health/token-refresh,
  email-scan — all generic or directly relevant to Trellis's kept features.
- The `@kairos/skills` package entirely (was only referenced in a doc
  comment after its one consumer route was removed).
- ~18 test files whose target route/job was deleted; kept 10 covering
  still-live code (auth-users, auth-social, connector-credentials, billing,
  documents, family-connectors, family-financial-profile, family-inbox,
  growth-events, blog, case-studies, plus generic engine/ML-isolation and
  email-connector coverage).

Left alone deliberately: `trading/trade-confirmation.ts`,
`trading/portfolio-data.ts`, `trading/broker-execution.ts`,
`trading/pie-sync.ts`, and the `createPendingTradeFn` callback wired into
`WorkflowEngine`'s construction in `server.ts` — all inert without a
workflow engine actually running workflows (no workflow routes exist to
create one), but removing them cleanly would mean restructuring
`WorkflowEngine`'s constructor call, which wasn't worth the risk for dead
code that can never execute. A future pass could remove these along with
the rest of `src/trading/`, `src/goals/`, `src/outcomes/` if a deeper
prune is wanted.

## Known, deliberately deferred issues

- **Auth token in `localStorage`.** `apps/web/src/lib/auth-context.tsx` and
  `apps/web/src/lib/api.ts` store the bearer token in `localStorage`
  (`kairos_token`), which is readable by any script running on the page (XSS).
  The correct fix is for `apps/api` to set an `httpOnly`, `Secure`, `SameSite`
  cookie instead of returning a bearer token. Now that `apps/api` lives in
  this repo, this is fixable here — just not done yet.
- **CSP `connect-src` placeholder.** `apps/web/firebase.json`'s
  Content-Security-Policy allows `connect-src 'self' https://*.run.app` to
  match the current shared Cloud Run API. Update this to `apps/api`'s actual
  Cloud Run origin once it's deployed and cut over, and narrow it — a
  wildcard subdomain match is broader than necessary once there's a fixed
  URL to pin to.
- **No Session Replay.** Deliberately not enabled in
  `apps/web/src/lib/observability.ts` — this app displays household
  financial data on screen, and Replay would capture it. Don't add it
  without a specific masking/redaction plan.
- **Mixed license terms across `packages/*`.** Copied as-is from kairos-ai:
  MIT (`engine`, `platform`), Apache-2.0 (`specifications`, `runtime`,
  `legacy-compat`, `mongodb-adapter`, `conformance`, `outcome-kernel`), and
  BUSL-1.1 (`pipeline`, `workflows`). Fine for a private repo; worth
  resolving before ever making this repo public.
- **Pre-existing `apps/api` test failures, verified against kairos-ai itself
  on 2026-09-12** — not introduced by this copy. Marked `it.skip` with a
  dated comment at each site rather than left silently red (the test files
  covering deleted routes/verticals — `scim.test.ts`, `portfolio.test.ts`,
  etc. — were deleted outright as part of the trim above, not skipped):
  - `ml-tenant-isolation.test.ts` needs a real MongoDB — fixed in CI via the
    `services:` block in `.github/workflows/ci.yml`, but will still fail
    running `pnpm test` locally without a local Mongo.
  - 5 are genuine bugs already present in kairos-ai right now
    (date-boundary logic in `trade-confirmation.test.ts`, a stale fixture
    assertion in `documents-tiering.test.ts`). Worth fixing upstream in
    kairos-ai — out of scope for this copy.

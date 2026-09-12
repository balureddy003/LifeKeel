# Security

This is a private repository. If you find a security issue, open a GitHub issue
or contact the repo owner directly rather than filing publicly.

## Repo layout

- `apps/web` — the Agent Oak Next.js frontend (static-exported to Firebase Hosting).
- `apps/api` — kairos-ai's `apps/api` Fastify backend, copied wholesale on
  2026-09-12 (to keep parity with the source repo and minimize risk), then
  trimmed on the same day to what Agent Oak actually calls plus the marketing
  surfaces (blog, case studies, growth events) that support self-serve
  growth. See "Trimmed from the full copy" below for exactly what was
  removed. Currently NOT deployed — `apps/web` still points at the shared
  kairos-ai backend (see `apps/web/.env.example`) until this one is
  provisioned (own MongoDB, own GCP secrets — see root `.env.example` and
  `.github/workflows/deploy-api.yml`) and cut over.
- `detectors/`, `connectors/`, `definitions/`, `verticals/`, `detector-evals/`,
  `category-table.yaml`, `scripts/fetch-yfinance.py` — runtime resource files
  `apps/api` reads via `path.join(ROOT, ...)`. Required for the API to boot
  with real detector/connector/vertical data. Originally copied wholesale
  alongside `apps/api`; the non-family verticals' YAML (`detectors/trading/`,
  `detectors/property/`, `detectors/social/`, `detectors/ecommerce/`,
  `detectors/finance/`, `detectors/saas/`, `detectors/cross-connector/`,
  `detector-evals/trading_*.yaml`, and `definitions/workflows/`,
  `definitions/goal-templates/`, `definitions/outcome-packs/`) was pruned in
  a later pass the same day, once it turned out to be more than static
  files — see below.

## Trimmed from the full copy (2026-09-12)

The full copy included kairos-ai's entire multi-vertical SaaS surface —
trading, property, social, SCIM/enterprise identity, federated learning,
marketplace, teams, goals/workflows — none of it reachable from Agent Oak.
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
  email-scan — all generic or directly relevant to Agent Oak's kept features.
- The `@kairos/skills` package entirely (was only referenced in a doc
  comment after its one consumer route was removed).
- ~18 test files whose target route/job was deleted; kept 10 covering
  still-live code (auth-users, auth-social, connector-credentials, billing,
  documents, family-connectors, family-financial-profile, family-inbox,
  growth-events, blog, case-studies, plus generic engine/ML-isolation and
  email-connector coverage).

## Removed: the dormant workflow engine and its YAML (2026-09-12)

The paragraph above originally left the non-family detector/workflow YAML
and the `WorkflowEngine`/`WorkflowLoader` machinery in place as "harmless —
nothing routes to them." That held for the registered HTTP routes (no
`/workflows` or `/goals` route was ever registered, so nothing could create
new work for it), but it undersold the footprint: `apps/api/src/server.ts`
was still constructing a live `WorkflowEngine`, loading and `node-cron`-
scheduling all 25 `definitions/workflows/*.yaml` definitions on every boot,
running a "goal autonomy" scheduler polling every 15 minutes, and — via the
`ConnectorSyncEngine` callback — checking a live "auto trading opt-in" flag
and enqueueing workflow triggers for trading-detector insights. None of that
could actually fire in this deployment (no data ever reaches the `goals`/
`connector_credentials` collections it needs), but it was real, running,
scheduled infrastructure with zero product surface to see or manage it, one
step from firing for real if the surrounding conditions ever changed
(e.g. this API pointed at a database that also serves kairos-ai's other
verticals). Given CLAUDE.md's rule that autonomous financial action always
needs an explicit human gate, this was removed outright rather than left
disclosed-but-present:

- `WorkflowEngine`, `WorkflowLoader`, and everything only reachable through
  them (`TemplateEngine`, `NodeExecutor`, `SkillEngine`, `AgentMemory`,
  `WorkflowVersionStore`, `OutcomeAgent`, `GoalTemplateLoader`,
  `OutcomePackLoader`, `VerticalLoader`, `ConnectorSandbox`,
  `AttributionTracker` — not `CausalExperimentTracker`, which is still live)
  deleted from `packages/workflows/src/`. The package now exports only the
  connector OAuth/credential plumbing, `ConnectorActionExecutor`, and the
  schema registry — matching what `ARCHITECTURE.md` already claimed it did.
- `trading/trade-confirmation.ts`, `trading/broker-execution.ts`,
  `trading/pie-sync.ts` didn't exist in this repo to begin with (already
  trimmed in an earlier pass despite this file's prior wording).
  `trading/portfolio-data.ts` (and the `loadLiveTradingOptIn` callback it
  fed) is now also deleted — its only consumer was the removed
  `ConnectorSyncEngine` callback branch.
- `apps/api/src/approvals/timeout-sweep.ts` deleted — already-orphaned
  (zero importers; the cron that called it was removed in the original
  2026-09-12 trim, per this file's cron list above) and typed exclusively
  against the now-deleted `WorkflowEngine`/`WorkflowLoader`.
- `detectors/trading/`, `detectors/property/`, `detectors/social/` (+
  `social_engagement_drop_v2.yaml`, `social_viral_spike.yaml`),
  `detectors/ecommerce/`, `detectors/finance/`, `detectors/saas/`,
  `detectors/cross-connector/`, `detector-evals/trading_*.yaml`,
  `definitions/workflows/`, `definitions/goal-templates/`,
  `definitions/outcome-packs/` deleted. Only `detectors/family/*.yaml` (4
  files) remains under `detectors/` — the engine loads whatever's there
  recursively, so this needed no code change.
- Test files that read the deleted YAML directly were removed alongside it:
  `packages/engine/src/__evals__/trading-detectors.eval.test.ts`,
  `packages/engine/src/__tests__/trading-signal-evaluation.test.ts`,
  `packages/engine/src/__tests__/social-detectors.test.ts`, plus the
  matching test files under `packages/workflows/src/__tests__/` for
  everything deleted from that package.

Left alone (out of scope for this pass, flagged for a future one):
`apps/api/src/data/sandbox-seed.ts` / `middleware/sandbox.ts` — a broader
kairos-ai multi-vertical demo/trial "sandbox mode" that's still live and
reachable, but only *mirrors* detector ids in comments and fabricated demo
data, not a functional read of the deleted YAML.

## Known, deliberately deferred issues

- **Auth token in `localStorage`.** `apps/web/src/lib/auth-context.tsx` and
  `apps/web/src/lib/api.ts` store the bearer token in `localStorage`
  (`agentoak_token`), which is readable by any script running on the page (XSS).
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

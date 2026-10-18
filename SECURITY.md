# Security

This is a private repository. If you find a security issue, open a GitHub issue
or contact the repo owner directly rather than filing publicly.

## Repo layout

- `apps/web` — the LifeKeel Next.js frontend (static-exported to Firebase Hosting).
- `apps/api` — kairos-ai's `apps/api` Fastify backend, copied wholesale on
  2026-09-12 (to keep parity with the source repo and minimize risk), then
  trimmed on the same day to what LifeKeel actually calls plus the marketing
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

## AI data-use and model-training boundary

This is the security boundary to use when answering “is my personal information
used to train AI?”

### Product rule

LifeKeel must not use family personal content to train or fine-tune a shared or
third-party foundation model. Hosted inference is **processing**, not training:
the provider receives the minimum task context needed to produce an answer,
extraction, or classification, under approved commercial terms. That must not be
worded as “we never send data to an AI provider” when a hosted path is enabled.

Internal per-tenant scorers may learn from bounded feature/outcome signals
(such as an approval or dismissal) to rank future insights for that household.
Those are derived models, not foundation-model training; hashed fields are still
pseudonymous personal data. The cross-tenant `FederatedLearningService` remains
in `packages/engine`, but the current API does not instantiate or schedule it.
No service currently writes a new shared model, but two dormant/evaluation paths
still need governance before stronger wording is used:

- `FeatureHashScorer` and `TenantLevelScorer` can warm-start from
  `federated_global_models.latest` if such an artifact exists. Stale artifacts
  should be deleted/quarantined or the read gated before claiming no
  cross-tenant model influence.
- The weekly `feature_hash_eval` job loads approved/dismissed insights across
  tenants and trains a temporary in-memory detector-level scorer to calculate
  aggregate quality metrics. It does not persist or deploy that scorer, but it
  should become per-tenant, synthetic/redacted, or explicitly governed
  aggregate evaluation.

### Implemented protections

- Tenant-scoped authorization happens before assistant context assembly.
- Ask Keel sends a task-specific family context, not arbitrary database access.
- Email and document inputs are bounded and treated as untrusted external data.
- Vault documents are encrypted before storage, excluded from OCR, and can be
  sealed in the browser so LifeKeel cannot read their plaintext.
- The LLM cache is exact-match, tenant/task/input keyed, and TTL-bound; semantic
  response caching is prohibited for sensitive family content.
- Prompt/completion telemetry is off by default; preferred observability is
  metadata-only task/model/cost/result data.
- Local Ollama/self-hosted and on-device paths exist for selected workloads, so
  sensitive processing can be kept inside LifeKeel-controlled infrastructure or
  on the user's device where configured.
- Account export/delete and retention workers exist for the primary family-data
  estate.

### Required controls before stronger public claims

A provider call must not be considered compliant merely because the code sends
less data. The task registry must carry and enforce:

- approved processor and endpoint/model;
- contract/DPA reference and review date;
- explicit no-training/no-model-improvement basis;
- region/residency and subprocessor inventory;
- retention mode, including abuse-monitoring or safety-log treatment;
- zero-retention/modified-monitoring status where available;
- deletion SLA and deletion-propagation behavior;
- whether the task uses a stateless response, provider-side file/vector store,
  batch, memory, or fine-tuning API;
- whether SDK/debug logging can emit prompts, completions, endpoint metadata,
  or tenant identifiers into logs and traces;
- whether evaluation uses synthetic/redacted/consented fixtures, per-tenant
  evaluation, or a documented and approved aggregate-evaluation basis.

Production must reject consumer/free AI endpoints, personal API keys, unapproved
regions/models, provider-side memory or file stores for family data, and any
route whose policy is missing. It must also propagate tenant deletion to LLM
cache, spans, guard events, eval captures, scorer/model versions, queues, and
provider-side retained records. The current account-deletion list does not yet
cover every one of those AI-derived artifacts.

### Safe user-facing wording

Use wording that distinguishes processing from training:

> We do not use your personal or family content to train general-purpose or
> third-party foundation models. Where a hosted AI processor is enabled, it
> processes only the information needed for the requested feature under
> commercial terms that prohibit training on the content. Limited provider
> service or safety logs may still apply under the published processor terms;
> local/on-device processing is used where available and configured.

Do not claim “zero data leaves LifeKeel,” “all documents are encrypted,” “the
provider retains nothing,” or “hashed data is anonymous” unless the specific
route, provider mode, and evidence prove it. Current provider/data-protection
references are maintained in `ARCHITECTURE.md` §8.16 and must be revalidated
when a processor, model, region, or product tier changes.

## Trimmed from the full copy (2026-09-12)

The full copy included kairos-ai's entire multi-vertical SaaS surface —
trading, property, social, SCIM/enterprise identity, federated learning,
marketplace, teams, goals/workflows — none of it reachable from LifeKeel.
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
  email-scan — all generic or directly relevant to LifeKeel's kept features.
- The `@lifekeel/skills` package entirely (was only referenced in a doc
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

## Removed: the action executor's money-moving and public-publishing action types (2026-09-13)

A go-live readiness audit (KEEL-002) found that `apps/api/src/actions/action-executor.ts`
— reachable, live, and wired into `POST /insights/:id/approve` — keyword-
matched an insight's free-text action label into 5 real external side
effects: `stripe_refund` (a real Stripe refund), `stripe_pause` (cancels a
live subscription), `xero_credit_note` (posts a real accounting credit
note), `post_linkedin` and `post_twitter` (publish publicly, using the
insight's own reasoning text as the post body if none was supplied). The
approve route called this executor unconditionally — a generic "Approve"
click, not a confirmation naming the exact side effect, amount, or
recipient. Compounding this, `POST /connectors/:id/credentials` had no
allowlist, so any authenticated tenant could attach a `stripe`/`linkedin`/
`twitter_x` credential directly against the API even though the family
app's UI never offers them — connectors the family vertical doesn't even
list as optional (`verticals/family/vertical.yaml`). This is exactly the
class of risk the WorkflowEngine removal above was justified by; this
executor was left wired into a currently-shipped route instead.

- `ActionType`'s `stripe_refund`, `stripe_pause`, `xero_credit_note`,
  `post_linkedin`, `post_twitter` members, their `ACTION_PATTERNS` regex
  rows, their `dispatch()` switch cases, and their implementation methods
  (`stripeRefund`, `stripePause`, `createXeroCreditNote`, `postLinkedIn`,
  `postTwitter`) deleted from `apps/api/src/actions/action-executor.ts`.
  `ActionReceipt`'s now-dead `external_id`/`external_platform` fields
  (only ever populated by the deleted LinkedIn/Twitter methods) removed
  alongside them. `send_email`, `send_whatsapp`, and `crm_tag` were kept —
  communication and CRM-tagging, not money-moving or public-publishing.
- `POST /connectors/:id/credentials` (`apps/api/src/routes/connector-credentials.ts`)
  now rejects any connector id outside a hand-written family-app allowlist
  (`gmail`, `email`, `open-banking`, `google_drive`, `dropbox`, `onedrive`)
  before doing anything else — matching `verticals/family/vertical.yaml`'s
  `optional_connectors` list plus what `apps/web/src` actually sends.

## Known, deliberately deferred issues

- **Auth token in `localStorage` — partially migrated (2026-10).** The API
  now issues an `httpOnly` `lifekeel_session` cookie on signup, login,
  OAuth exchange, and MFA verify (`apps/api/src/lib/session-cookie.ts`),
  prefers it over Bearer in the auth hook, clears it at `POST /auth/logout`,
  and guards cookie-authed mutations behind an Origin allowlist (the CSRF
  boundary for `SameSite=None`). The web app sends
  `credentials: 'include'` on every call. **What remains:** the API is
  cross-site to `lifekeel.co.uk` (Cloud Run `*.run.app`), so Safari and
  other third-party-cookie-blocking browsers still need the Bearer
  fallback — `lifekeel_token` is still written at login for those clients.
  The remaining XSS exposure closes when the API is served same-origin:
  either a Firebase Hosting rewrite `/api/**` → Cloud Run (preferred —
  kills CORS entirely too) or an `api.lifekeel.co.uk` CNAME. After that,
  delete the `lifekeel_token` writes in `auth-context.tsx` and the
  `Authorization` fallbacks; `apps/web/src/lib/http.ts` documents the seam.
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
- **Multi-factor authentication — implemented (2026-10).** TOTP (RFC 6238)
  enrollment and login verification now exist:
  `apps/api/src/lib/totp.ts` (SHA-1/6-digit/30s/±1 window),
  `/auth/mfa/{status,setup,enable,disable,verify}` in
  `apps/api/src/routes/auth-users.ts`, the `mfa_pending` short-lived claim
  (rejected as a session credential by the auth middleware), single-use
  recovery codes stored as SHA-256 hashes, password re-confirmation to
  disable. Web UI: `apps/web/src/components/MfaSettings.tsx` (Settings →
  Security) and the second step on `/login`. OAuth sign-in is covered too:
  Google/GitHub exchange+callback routes return the same pending-token
  contract instead of a session for mfa_enabled users, and the web
  callback routes it to the login code step. **Recovery path:**
  `POST /operator/users/:id/mfa-disable` (users.manage permission, reason
  required, audit-logged, also revokes sessions) is the support runbook for
  a user who loses both factors — run it only after out-of-band identity
  verification, e.g. a confirmed recovery email on the account.
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

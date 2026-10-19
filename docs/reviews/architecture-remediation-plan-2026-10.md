# Architecture remediation plan — gap register → execution

As of 2026-10-19 · reviewed by Devin (external verification pass against code)

## How to read this

This plan sequences every gap in `ARCHITECTURE.md` §16 plus the
code-verified findings from the 2026-10-19 review (drift items the
register does not list). Sizing follows the existing
`remediation-plan.md` convention: **XS** hours, **S** days, **M** ~a
week, **L** multi-week, **XL** quarter-scale or gated on a
non-engineering decision (legal, partner, DPIA).

**Sequencing logic, not just priority order:**

1. **Stage 0 first** — the architecture has drifted from the code in at
   least 6 places (see §Drift). A week of conformance machinery stops new
   drift accumulating while the real work proceeds. It is the cheapest
   item here and protects the value of every other item.
2. **P0 = "a claim the product already makes is currently false."**
   Order within P0 favors items where the fix is small relative to the
   claim at risk (erasure list, publish policy, queue mode) before the
   structural ones (AI gateway, children's data).
3. **Nothing in Stage B/C should start while its Stage A dependency is
   open** — e.g. do not build the spend ledger (B8) on an unwired cost
   path (A1); do not schedule the restore drill (A6) before the erasure
   decision (A5).

PRD numbering continues the `docs/prd/` sequence; each Stage A/B item
should open as an `intent.md` before implementation per CLAUDE.md.

---

## Stage 0 — conformance machinery (do first, ~1 week total)

The register is accurate but nothing keeps it accurate. These items make
"Implemented" claims self-checking and convert the gap register from
prose into tests.

| # | Item | What it does | Size |
|---|---|---|---|
| 0.1 | **Architecture-claims fitness tests** (`apps/api/src/__tests__/architecture-claims.test.ts`) | Assert: `withSpan`/`getTracer` have >0 production call sites; `DELETABLE_COLLECTIONS` covers every collection written with `tenant_id` (drive from a collection-name inventory or a lint over `db.collection(` calls); `ActionReceipt` persists `approved_by`; `NEVER_AUTONOMOUS` set and `autoPublishEligible` cannot both permit the same action class. Fails CI when a claim rots. | S |
| 0.2 | **CSP/feature contract check** (web vitest) | Parse `firebase.json` CSP; assert `connect-src`/`script-src` permit every feature that ships enabled-by-default (WebLLM needs `huggingface.co` + `wasm-unsafe-eval`; push needs its endpoint). Pair with 0.1. | S |
| 0.3 | **Quarterly register-verification ritual** | Add a checklist to `docs/sdlc/` or CONTRIBUTING: each release, re-run the spot-check script (grep patterns for each §16 exit criterion). Owner: named, not "the team". | XS |
| 0.4 | **Correct stale register rows now** | Update §16: key-versioning row (versioning exists — remaining work is per-tenant DEKs, rotation runbook, hardening the legacy fallback); erasure row (scope is wider than AI-derived). | XS |

## Stage A — P0: make existing claims true

Grouped by theme. Each item lists the verified code evidence it fixes.

### A1. Mandatory AI task gateway — the centerpiece P0 (L)

**Evidence:** budget guard, cost ledger, breaker, and guards all exist
but only inside `callStructured`'s optional `governance` param
(`packages/platform/src/structured-llm.ts:92-118`); the router never
calls `LlmCircuitBreaker`; `callAzure`/`callOllama` never invoke
`onUsage`; routing is model-name prefixes + prompt keywords
(`llm.ts:127-149, 203-255`); local-model path (`local-decision.ts`)
has no guards at all; output guard drops `tenant_id` (`'unknown'`).

**Work:**
1. Introduce the `AiTaskPolicy` registry from §8.4 — in-repo YAML first,
   loaded at boot, fail-closed for unknown `task_id` in production.
   Seed with the 12 tasks already listed in §8.4. (M)
2. Make `createLlmRouter`/`callStructured`/`createLocalDecisionFn`
   require a resolved policy object — no policy, no call. Migrate each
   existing call site to a named task (inventory first: assistant,
   email classify, OCR extract, judge, narration, support, marketing).
   (L)
3. Wire enforcement inside the router, not per-caller: token ceilings,
   atomic budget reservation + reconciliation, deadline, one retry
   layer, breaker per provider/model/task class, symmetric
   input/output guards on cloud AND local paths, `onUsage` →
   `CostLedger` for every provider including Azure/Ollama. (L)
4. Fix the output-guard tenant bug and remove provider debug
   `console.log` calls in `llm.ts`. (XS, do immediately)
5. Kill-switch + env policy: production rejects unregistered
   providers/endpoints/models; no consumer-tier endpoints. (S)

**Exit:** integration test proves caps/reservation/breaker/deadline/
guard/usage-ledger fire for every production model task — the
register's own exit criterion.

### A2. Signed-link approval strengthening (M)

**Evidence:** `POST /a/:token` unauthenticated, runs full
`approveInsightDecision` incl. real SendGrid/Twilio/CRM dispatch;
confirmation page shows hypothesis text but **no exact-effect
preview**; HMAC TTL 7d; `DELIVERY_SIGNING_SECRET` falls back to
`'change-me'` (`delivery-router.ts:116-117`, `insights.ts:1101-1143`).

**Work:**
1. `GET /a/:token` renders the same classified effect preview as
   authenticated `action-preview` — exact channel, recipient, effect.
   (S)
2. `POST` becomes a two-step: link click → authenticated continuation
   (existing session or magic-link step-up) before dispatch. Low-risk
   dismiss/snooze may keep bearer semantics if threat-modeled. (M)
3. Persist `approved_by` + `approved_via` on each `ActionReceipt`
   (currently only on the insight doc) — this is also the 0.1 fitness
   test's assertion. (S)
4. Remove the `'change-me'` default; fail boot in prod without
   `DELIVERY_SIGNING_SECRET`. (XS)

### A3. Unify the publishing policy (S)

**Evidence:** `NEVER_AUTONOMOUS` code-rejects publishing rules while
`autoPublishEligible` (trust_level ≥ 5) auto-publishes with
`approved_by: 'auto-trust'` (`marketing-posts.ts:145-150, 1102-1116`).

**Work:** one decision, then enforce it in one place: either (a)
auto-publish joins the `NEVER_AUTONOMOUS` invariant and the trust
ladder stops at "queue for one-click approve", or (b) it becomes a
formally approved Tier-3 path with per-channel consent, exact preview,
revocation, and its own incident story — and `NEVER_AUTONOMOUS` is
amended to name the exception. Either way the 0.1 test asserts the two
systems can't disagree. Generated drafts stay review-only regardless.

### A4. Erasure completeness (M) + A5. backup↔erasure decision (S, decision; M, implement)

**Evidence:** `DELETABLE_COLLECTIONS` (26) misses ~30+ tenant-tagged
collections including family-authored `family_assets`,
`family_cashflow_entries`, `legacy_*`, `family_scenarios`,
`member_nudges`, `external_accounts`, and all AI artifacts
(`llm_cache`, `llm_spans`, `llm_guard_events`, `llm_usage`,
scorer/calibration state) (`account.ts:43-69`).

**Work:**
1. Build the data-class catalogue (also feeds B1): every collection →
   owner, tenant key, sensitivity, retention, backup tier,
   delete-vs-retain decision. (S)
2. Extend deletion + the 0.1 test so a new tenant-tagged collection
   fails CI unless catalogued. (S)
3. Decide crypto-shredding (per-tenant DEKs — see B4) vs
   post-restore tombstone replay. For vault + connector credentials,
   DEKs kill two gaps with one mechanism. (S decision)
4. Erasure receipt honestly states backup-retention windows until
   shreddable. (XS — also PRD-146 requirement)

### A6. Backup/restore baseline + first restore drill (M)

**Evidence:** zero backup/restore/PITR/DR anything — no scripts, no
docs, no runbook.

**Work:** define per-data-class RPO/RTO in the catalogue; enable
Mongo PITR (Atlas) or scheduled encrypted exports for authority data
only (derived state excluded per §15.8); write `runbooks.yaml` restore
runbook; execute one real restore into a scratch env including the
erasure-replay check from A5; record evidence. This converts the P0
claim "family/vault continuity" from words to test.

### A7. Federated warm-start gate + eval redesign (S)

**Evidence:** `FeatureHashScorer.tryWarmStart` /
`TenantLevelScorer.tryWarmStart` read `federated_global_models.latest`
unconditionally (`feature-hash-scorer.ts:236-304`,
`tenant-level-scorer.ts:232-504`); `feature_hash_eval` pools
approved/dismissed insights across all tenants
(`feature-hash-eval.ts:67-99, 191-193`).

**Work:** delete/quarantine any existing `federated_global_models`
artifacts and gate the warm-start read behind an explicit governed
setting (default off); rewrite `feature_hash_eval` per-tenant (or on
synthetic fixtures); drop the stale trading-vertical fields it still
reads. This is a CLAUDE.md rule-3 violation in live code — small fix,
high principle value.

### A8. Durable-required queue + migration gate (S+M)

**Evidence:** Redis-down → silent inline mode with no durable DLQ
(`QueueManager.ts:96-148`); migrations non-fatal at boot
(`server.ts:1933-1938`); `MIGRATION_VERSION=unmanaged`; deploy has no
migration step.

**Work:**
1. Env policy `QUEUE_MODE=required` for prod: Redis unavailable →
   durable jobs refuse honestly (read paths still degrade). (S)
2. Lease/visibility-timeout on the processing list so stranded-job
   recovery can't reclaim live work — **then** re-cost "managed queue
   vs lease-aware Redis": if the fix approaches BullMQ territory, take
   BullMQ now rather than rebuilding it (critical review D2). (M)
3. `runMigrations()` failure fails boot in prod; add a deploy
   pre-step (job or boot-gate) that asserts ledger head ≥ expected
   version before traffic shift; report real version in
   `/health/ready`. (S)

### A9. Children's-data posture (L, gated on counsel)

**Evidence:** none of parental-consent model, profiling position,
marketing age-exclusion, youth AI task policy, or age-out transition
exists; youth twins already get readiness scoring and member nudges.

**Work:** minors' DPIA (external counsel input); consent model naming
who consents for a youth member; profiling position per youth feature;
marketing eligibility hard age-gate (not just `consent.marketing`);
youth `AiTaskPolicy` variant (narrower context, stronger guards, no
retention) before any youth-facing assistant; age-out workflow feeding
B2's member lifecycle. Sequenced early because it constrains B1/B2
data modelling.

### A10. Drift fixes (mostly XS–S; bundle into one PR wave)

| Fix | Size |
|---|---|
| OTel: either add the three SDK deps + wire `withSpan` on route/queue/model paths, or downgrade §12's claim to "telemetry seam, not yet exporting" | S |
| WebLLM: add `huggingface.co` + `wasm-unsafe-eval`/`worker-src` to CSP *or* feature-flag it off until verified; the 0.2 test prevents recurrence | S |
| deploy-local-judge: eval gate **before** traffic (deploy `--no-traffic` → eval → shift); same pattern as deploy-api canary | S |
| `localhost` out of production CSRF allowlist (env-gated dev only) | XS |
| `/auth/login` route-level rate limit | XS |
| `getKey` legacy fallback → fail closed on unknown version; `decryptIfNeeded` ambiguity documented or removed | XS |
| Remove `console.log` leftovers in `llm.ts`; stale `apps/web/Dockerfile` | XS |
| CSP/`allowNavigation`: drop `*.run.app` once same-origin `/api` rewrite is sole path (verify `same_origin_api` holds) | XS |
| Delete `deploy-out/` SA keys from disk after confirming they're in Secret Manager | XS |

---

## Stage B — P1: safety, regulatory, operational posture

| # | Item | Why / notes | Size | Depends on |
|---|---|---|---|---|
| B1 | **DPIA + RoPA + lawful-basis register** for the live product; data catalogue carries lawful basis per class | Art. 35 triggers (monitoring, novel tech, children's data) already apply | M (counsel) | A4 catalogue, A9 |
| B2 | **Member lifecycle domain** — youth→adult, departure, death, household split | First-order gap for a decades-long continuity product; drives consent/visibility/twin transitions | L | A9 |
| B3 | **Incidental special-category policy** — upload classification or enforced acceptable-use posture | Users already upload health-adjacent docs; Art. 9 applies to data held | M | B1 |
| B4 | **Per-tenant envelope encryption** (KEK/DEK) for vault + connector credentials; rotation runbook; restore test | Blunt blast radius + enables A5 crypto-shredding; versioning scaffold exists | M | A4/A5 decision |
| B5 | **Connector credential custody** doc + Open Banking consent lifecycle (90-day re-confirmation, revocation propagation) | Design constraint *before* AISP go-live, not onboarding paperwork | S doc + M impl | — |
| B6 | **Disclosure/confidentiality classification** parallel to trust tiers; enforced server-side | A Tier-0 insight shown to the wrong member is still a breach | M | B2 |
| B7 | **Deployment split:** separate API / worker / scheduler Cloud Run services, same image, different entrypoints | Blast-radius argument (bad API deploy kills the safety nets) is cheap to fix now — don't wait for the "measured trigger" (D1) | M | A8 |
| B8 | **Unified external-spend ledger + unit economics** — cost per active family per month, `plan_cost_budget` enforced at the gateway | Meaningless until A1's usage wiring lands | M | A1 |
| B9 | **SLOs + error budgets** — journey SLIs, burn alerts, the 10 dashboards in §15.9; secondary transactional email provider | SendGrid is on the proactive-protection critical path | M | B7 |
| B10 | **Operator hardening** — step-up/recent-auth for destructive+bulk, four-eyes for highest blast radius, expiring break-glass, unified operator/product audit with before/after hash | Compromised-operator is a listed threat; single-actor erase/credit/campaign exists today | M | — |
| B11 | **Campaign bulk workflow** — per-recipient durable jobs, `pending→sent/failed`, pause/resume | 2,000-recipient synchronous loop; claim written as `sent` pre-dispatch | M | A8 |
| B12 | **Social provider gateway** — shared deadline/retry/breaker/idempotency; explicit publisher-account in preview+audit | Direct `fetch` per adapter; implicit env↔tenant credential fallback | M | — |
| B13 | **Adversarial/red-team CI** — synthetic task goldens + injection suite (promptfoo/garak class); eval-run lineage unifying prompt + detector runs | §8.10's missing-eval list; tenant-id metric-label cleanup alongside | M | A1 |
| B14 | **Model/artifact supply chain** — digest-pinned local artifacts, model cards, AI-BOM | All current "pins" are mutable tags (`llama3.1`, `Xenova/bge-small-en-v1.5`) | S | A1 |
| B15 | **Migration ledger maturity** — expand/migrate/contract discipline, index-as-code verification that fails readiness, real version in `/health/ready` | Complements A8's gate | M | A8 |

## Stage C — P2: scale, cost, growth-driven

| # | Item | Size | Trigger |
|---|---|---|---|
| C1 | Tenant/member timezone model for quiet hours, digests, heartbeat, renewals | M | First non-UK expansion or first "why did it email me at 3am" |
| C2 | Currency policy: explicit single-currency scope *or* FX authority; `country-config.ts` scaffolding is real but `£` is hardcoded in ~20 sites | S (scope decision) / L (multi-ccy) | First non-GBP market |
| C3 | Per-tenant fairness/admission: quotas, fair queues, concurrency+cost limits | M | First noisy-neighbor incident |
| C4 | Load/soak/failure suite as release artifact; capacity model | M | Before first paid-scale claim |
| C5 | GridFS → object storage for vault/doc blobs at stated volume threshold; WORM export for 7-yr audit | M | Storage-cost threshold |
| C6 | Change-driven detector invalidation (dirty-tenant sweeps); payload-by-reference queue contract; off-peak batch windows | S each | Sweep cost becomes visible |
| C7 | Multi-region recovery decision (warm/cold), only if RTO can't be met by restore | L | After A6 drill produces real RTO numbers |
| C8 | Vendor exit/portability table; CODEOWNERS per register row; observability volume policy (sampling, label-cardinality budget) | XS–S each | Now — cheap |
| C9 | User-visible operator-access transparency (family can see who viewed their data) | M | Trust-product differentiator; pairs with B10 audit unification |
| C10 | Estimated-vs-billed token reconciliation alert | S | After A1 usage wiring |
| C11 | Cold-start budget measurement; min-instances or deferred init if it breaches interactive SLO | S | With B9 baselines |
| C12 | Mobile: CI lane for capacitor config lint + store-release runbook | S | Before first store submission |

---

## Deliberately not planned (per the three rules + §18)

- Payment initiation, money movement, product switching/arranging.
- Autonomous claims/legal/medical actions; autonomous vault release.
- Broad vault RAG, semantic response cache, generic agent frameworks.
- Cross-tenant federated learning rounds (dormant by design; governed
  opt-in required before any re-activation).
- Separate microservices, MCP/A2A, vector DB, GPU serving — all
  trigger-gated per §8.14/§17, none triggered yet.

## What this plan deliberately does NOT do

- It does not split the monolith early — Stage B7 is a *deployment*
  split (one image, three entrypoints), not a codebase split.
- It does not add a hosted AI gateway/proxy, durable-workflow engine
  (Temporal), or annotation platform — all correctly deferred in
  §8.14 until their triggers exist.
- It does not turn the trust-tier or advice rules into "best effort" —
  every item above tightens, never relaxes, the three CLAUDE.md rules.

# PRD-226: Low-cost, high-scale architecture for the brief platform

> **Status: split.** Only the items the Stage 1 cut (PRD-222) depends on are
> buildable now; the rest are parked until brief volume or document volume
> justifies them — see the status table under "What 'done' looks like".
> Nothing here is a reason to delay PRD-222, and nothing here is a reason to
> build it either: the brief succeeds or fails on the product metrics in
> PRD-222, not on these savings.

## Problem

For LifeKeel to offer a free first brief to many households without marginal
cost rising with the number of stored PDFs or idle tenants, six structural waste
sources in the current backend must be closed now:

1. **Vault and document bytes in MongoDB GridFS:** `documents.files` and
   `documents.chunks` keep file bytes inside hot database storage, which is an
   order of magnitude more expensive per GB than object storage and bloats
   working sets and backups.
2. **Full-profile + detector sweep on interactive paths:** computing household
   state currently loads the entire profile and evaluates up to 9 YAML detectors
   instead of running the brief as a narrow, cached hot path.
3. **Fixed-cadence tenant sweeps:** daily cron sweeps
   (`stale-profile-evaluation.ts`, `scenario-watchlist.ts`) scan across tenants
   even when inputs have not changed.
4. **Uncapped interactive free-tier AI/OCR spend:** `checkPlanSpendBudget` in
   `apps/api/src/spend-ledger.ts` (line 186) currently exempts
   `budget_class: 'interactive'` tasks from the monthly plan cap, allowing free
   users to generate unbounded hosted LLM or OCR cost before paying.
5. **Unbounded Redis queue payloads:** `QueueManager.publish` accepts arbitrary
   objects without enforcing an ID-only, max-byte contract, risking document
   bytes or text blobs entering Redis and dead-letter queues.
6. **Unmeasured cold start vs. scale-to-zero:** Cloud Run scale-to-zero keeps
   idle cost near zero, but needs an explicit cold-start and brief p95 gate so
   `min-instances` is only raised if real traffic breaches the target.

## Who it's for

Every household using the brief (fast, deterministic responses) and the platform
operator (near-zero idle cost and predictable unit economics at high brief
volume).

## What "done" looks like

| # | Change | Status |
|---|---|---|
| 1 | GridFS → object storage | **PARKED** — cost optimisation for document volume, not a brief requirement; the brief hot path never reads document bytes |
| 2 | Brief hot path (cache + template) | **BUILDABLE** — required by PRD-222 |
| 3 | Change-driven invalidation | **BUILDABLE** — required so shared briefs stay true |
| 4 | Hard free-tier spend cap | **BUILDABLE** — free briefs must not generate unbounded AI/OCR cost |
| 5 | Queue payload-by-reference (4 KB) | **PARKED** — scale hygiene, not Stage 1 |
| 6 | Scale-to-zero + cold-start/p95 gate | **PARKED** — measure when brief traffic exists |

1. **Move vault and document bytes out of MongoDB GridFS into object storage
   (GCS / R2):**
   - All document and vault uploads write ciphertext/clean bytes to object
     storage via `apps/api/src/documents/storage.ts`; MongoDB `documents` rows
     retain only metadata, `sha256` hash, `size`, `mime_type`, and the object
     storage pointer (`storage: { bucket, key }`).
   - Ship `scripts/ops/migrate-gridfs-to-object-store.ts` to migrate existing
     GridFS files to object storage, verify SHA-256 and byte length, update
     `storage.key`, and delete migrated GridFS chunks.
   - Disallow new GridFS writes outside local dev/test once cut over; the brief
     hot path never calls `readDocumentBytes`.
2. **Make the brief the hot path (template-first, model-optional):**
   - Creating or reading a brief (`household_briefs`) is a fixed, code-driven
     sequence (no open agent loop): project only the fields its problem pack
     needs → run `calculate.ts` once → build the deterministic
     `template_sentence` → store the result with `solver_version`,
     `data_version`, and `stale: false`.
   - The brief route never calls a model. `GET /b/:token` serves the stored
     brief result directly (one indexed Mongo read + first-open `opened_at`
     stamp). No full profile read, no detector sweep, no model call.
   - **Two governed AI tasks only for the brief platform:**
     - `brief.narrate` (`authority: language_only`, hosted or local, short
       output): optional, separate, budgeted call that rephrases
       `template_sentence`. Guarded by a **server-side numeral-presence output
       guard** in `packages/platform/src/llm-guards.ts` (every numeral in the
       output must appear in the solver payload, or the guard rejects it and
       falls back to `template_sentence`). Cached by
       `solver_version + data_version` so a hit returns the stored sentence
       without a model call.
     - `document.extract_fields` (`authority: candidate_for_review`):
       **BLOCKED — do not build until an approved processor exists.** The GCP
       Ollama service (`lifekeel-local-judge`) was decommissioned 2026-10-24
       for cost, and policy documents cannot go to an unreviewed hosted
       processor — "local preferred" is not an available answer while no local
       serving path is deployed. When a processor is approved (re-deployed
       local serving or a reviewed hosted processor on `approved_hosted_provider`
       terms), the task returns candidate policy fields (`provider`,
       `coverage_amount`, `deferred_period`, `renewal_date`, `premium`,
       `policy_number`) into `extraction_candidates`, and a person must
       confirm and apply them before they affect a brief. Not required for
       Stage 1 — the brief is zero-model.
3. **Switch from fixed sweeps to change-driven invalidation:**
   - Writes to `family_financial_profile`, linked `external_accounts`, or
     `family_cashflow_entries` increment the tenant's `data_version` and mark
     only affected `household_briefs` (and derivation-closure artefacts from
     Intent 67) `stale: true`, recomputing only what was invalidated.
   - Retire full-table tenant loops in `stale-profile-evaluation` and
     `scenario-watchlist` in favour of dirty-flag / dated-boundary queries.
4. **Cap free-tier spend hard (zero model calls for the first brief):**
   - Update `checkPlanSpendBudget` in `apps/api/src/spend-ledger.ts` so
     `plan === 'free'` is hard-capped across **all** budget classes
     (`interactive` and `batch`), including document extraction and hosted LLM
     calls.
   - Assert in CI that completing and sharing the first brief invokes zero model
     or OCR calls.
5. **Queue jobs carry IDs, not content (`MAX_QUEUE_PAYLOAD_BYTES = 4096`):**
   - `QueueManager.publish` in `apps/api/src/queue/QueueManager.ts` validates
     that serialized job payloads do not exceed 4 KB and rejects forbidden
     content keys (`Buffer`, `raw_text`, `file_bytes`, `content_bytes`).
6. **Keep scale-to-zero; gate `min-instances` on measured brief p95:**
   - Keep Cloud Run `min-instances: 0` on the API service.
   - Defer non-essential boot work off the request critical path and export
     `brief_hot_path_duration_ms` and `cold_start_duration_ms` histograms. Add a
     minimum instance only if measured brief p95 breaches the SLO target.
7. **What to keep and what not to do:**
   - **Keep:** the modular monolith (`apps/api`), tenant-scoped Mongo
     collections + isolation tests, the deterministic solver as the sole source
     of numbers, and static web on Firebase Hosting.
   - **Do not:** introduce a second database, a separate message bus, or a
     microservices split to "prepare for scale."

## Constraints

- **Trust tier:** 0. Storage, caching, invalidation, spend caps, and queue
  bounds have no autonomous external side effects.
- **Regulated-advice check:** N/A (infrastructure and deterministic caching).
- **Data/privacy:** moving blobs to private object storage preserves per-tenant
  DEK envelope encryption (`crypto/envelope.ts`), erasure (`erasure.ts`), and
  zero provider AI/training access (`CLAUDE.md` Rule 3).

## Out of scope

Adding a second database (Postgres/DynamoDB), adopting Kafka/PubSub, splitting
`apps/api` into microservices, or putting OCR/LLM calls on the free brief path.

## Builds on

`apps/api/src/documents/storage.ts`, `apps/api/src/spend-ledger.ts`,
`apps/api/src/queue/QueueManager.ts`, Intent 65, Intent 67, Intents 74–77.

## Success metrics

0 bytes stored in MongoDB `documents.chunks` after migration; 0 model calls on
the first brief flow; 100% of free-tier model/OCR calls blocked once the tenant
hits `DEFAULT_PLAN_BUDGET_USD.free`; 100% of Redis queue publishes <= 4 KB;
unchanged tenants skipped by background sweeps.

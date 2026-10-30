# The Brief Platform Pivot & Low-Cost High-Scale Architecture (October 2026)

Date: 28 October 2026.
Translates into Intents `70`–`77` (`docs/intents/`) and PRDs `222`–`226` (`docs/prd/`).

> **Review amendment (same day, pre-merge):** Stages 2–4 and the GridFS cutover
> are **gated/parked** — only the Stage 1 cut (intents 70, 75, 76) is buildable.
> Two design fixes landed in spec: `opened_at` is split into `link_fetched_at`
> (telemetry only — link unfurlers/scanners set it) and `confirmed_opened_at`
> (explicit "view the numbers" action — the product promise), and the share
> page's caching posture is `private, no-store` on the result endpoint with a
> token `expires_at` and defined revocation behaviour (410 revoked / 404
> expired). Pricing is one decision: `lifekeel_record_annual` at £59.99/yr,
> not a re-skin of the OCR Plus SKU; existing Plus subscribers keep OCR.
> `document.extract_fields` is **BLOCKED** until an approved processor exists
> (GCP Ollama decommissioned 2026-10-24).

> **Direction amendment (2026-10-30): frictionless, high value.** The platform's
> test is how little a household must do before it sees a number it can use.
> Consequences, detailed in [Intent 83](../intents/83-friction-budget-and-zero-connection-first-value.md)
> and [PRD-230](../prd/230-friction-budget-and-zero-connection-first-value.md):
> - First value never needs a connection. Stage 3 feeds improve the same number;
>   they are not a step before it.
> - The brief link is the front door for every channel: households, advisers and
>   employers send a link that opens a real result with no sign-up.
> - The second adult reads first and joins after. One reminder, copied by the
>   creator; LifeKeel sends none.
> - Stage gates are measured in time to first number and second-adult
>   confirmation, not "finished setup".
> - Channels stay inside the advice line: factual numbers only, no product or
>   provider named, no payment per placement or switch.

---

## 1. Market diagnosis: why the brief is the opening

The market is crowded with storage and advice, and empty of a **shared, computed
brief for a real household problem**. That is the opening for a platform.

### What exists

- **Document and legacy vaults (the crowded layer):** SafeKeep, Biscuit Tin,
  Capsafa (free, launched September 2026, Executor Pack always free),
  SuccessionKeeper (£4/month or £39/year, check-in system), Lyfeguard (free +
  Pro £4.99 with open-finance connections), Safe4, and others. They store files
  or a map of where things are, name a contact, and charge roughly £3–£7 a month
  or stay free. None of them lead with *"how many months if one income stops,
  and has the other adult opened it?"*
- **Protection distribution:** The FCA's Pure Protection Market Study final
  report (21 September 2026) found that 58% of adults hold no life,
  critical-illness, or income-protection product, and 59% of that group have
  never considered it. Competition works for people who already hold cover. The
  gap is awareness and prompts, not a shortage of products. The FCA is not
  adding broad new rules; it is pushing industry-led awareness and a possible
  TechSprint in Q3 2027.
- **Employer and benefits platforms:** Alltoogether places cover and gives
  employees a portal. Bippit sells coaching, mortgage advice, and will-writing
  to employers. Perkbox, Reward Gateway, and others sell discounts and admin.
  They are paid by the employer or on placement. They do not show a household
  runway the second adult has seen, and they cannot refuse to sell without
  breaking their model.
- **Data feeds that will arrive later:** Moneyhub is already powering household
  open-banking views (Know Your Dosh tracks £200m+). The public MoneyHelper
  pensions dashboard is expected in the 2027/28 financial year; private
  dashboards follow only after that.

### The gap that is still open

A household can store a PDF, name a contact, or be sold a policy. It cannot, in
one evening, answer a specific upcoming problem with a number both adults have
seen, and leave without a product recommendation.

That is the space LifeKeel can take. Everything else is already occupied.

---

## 2. How to pivot to a platform (Stages 1–4)

### Stage 1 — The brief (now) → [PRD-222](../prd/222-stage-1-the-household-brief.md)

- **Three problems only:**
  1. One of us might stop earning.
  2. Someone is about to earn less.
  3. The other adult does not know.
- **One engine:** a few inputs, one deterministic solver result, send link,
  `opened-at`.
- **First brief free.** No chart, no sample family, no Plus sold as document
  reading.
- **Success:** a real couple finishes one brief in an evening and both see the
  same months.

### Stage 2 — Problem packs (after the first briefs are finished) → [PRD-223](../prd/223-stage-2-problem-packs.md)

Add packs that use the same engine and the cleaner policy fields:
- Job change (employer cover ends with the job)
- Mortgage fix ending
- Renewal price change (last premium vs. this premium)
- Childcare or school bill starting
- Quiet month or tax bill
- Parent needing support

Each pack changes the months or a named gap. None is a new app. The household
pays for the second brief or for keeping the record (around £59 a year).

### Stage 3 — Feeds into the same number → [PRD-224](../prd/224-stage-3-feeds-private-accounts-employer-seats.md)

- Read-only balances and, when legally usable, pension pots update the months.
- One adult can hide an account (`visibility: 'private'`).
- A found pot changes the retirement component; it does not start a
  consolidation journey.
- **Employer seat:** a flat fee so staff can run a brief. The employer never
  sees the figures and there is no fee per policy.

### Stage 4 — Others can read, not own → [PRD-225](../prd/225-stage-4-household-read-api-and-fact-find.md)

- A small read API under a household grant: `runway`, `renewal_dates`,
  `opened_at`, `document_locations`. No raw files unless the member exports
  them.
- A fact-find export the family chooses to send to an adviser they already have.
- Disconnecting a partner deletes their access, not the graph.

### What the platform is not

- It is not a vault competing with Capsafa or SafeKeep on storage price.
- It is not a benefits broker or a will-writer.
- It is not a comparison site or a model that supplies its own figures.
- It is not a private pensions dashboard before the rules allow it.

The platform is the household graph that keeps a growing set of briefs true over
time, and that other tools can read only when the family allows it.

---

## 3. What to change now (low cost, high scale for the brief) → [PRD-226](../prd/226-brief-scale-and-cost-architecture.md)

| Change | Why it matters for the brief platform | Effort | Codebase mapping |
|---|---|---|---|
| **Move vault and document bytes out of MongoDB GridFS into object storage (GCS/R2). Keep only metadata, hash, and a pointer in Mongo.** | Hot database storage is an order of magnitude more expensive per GB. At scale this is the largest avoidable cost. The brief does not need the file bytes on the hot path. | Medium | `apps/api/src/documents/storage.ts` already has the dual-read seam (`DOCUMENTS_SCHEMA_VERSION = 2`); cut over all uploads + vault writes to object storage, migrate existing `documents.files`/`chunks`, and ban new GridFS writes outside dev/test (Intent 74). |
| **Make the brief the hot path. A problem pack loads only the fields it needs, calls the solver once, stores the result with a data version, and returns a share link.** | Most requests become a short read + one pure computation. No full profile, no detector sweep, no LLM. | Low | Project narrow fields from `family_financial_profile`, call `calculate.ts` once, store `{ result, solver_version, data_version, stale: false }` on `household_briefs`, serve `/b/:token` from stored result (Intent 75). |
| **Switch from fixed sweeps to change-driven invalidation. On a write, mark the affected brief stale and recompute only that.** | As households grow, sweeping every tenant wastes compute and Mongo reads. The brief only needs to be fresh when its inputs change. | Medium | On profile/account/cashflow write, bump `data_version` and mark affected `household_briefs` `stale: true`; replace full-tenant scans in `stale-profile-evaluation.ts` and `scenario-watchlist.ts` (Intent 75). |
| **Cap free-tier spend hard. Document extraction and any hosted model call sit behind a per-tenant budget. The first brief must succeed with zero model calls.** | Free users can otherwise generate unbounded AI or OCR cost before they pay. | Low | Fix `checkPlanSpendBudget` in `apps/api/src/spend-ledger.ts` (line 186) so `plan === 'free'` hard-stops both `interactive` and `batch` tasks once the monthly cap is hit; test that the first brief makes 0 model calls (Intent 76). |
| **Queue jobs carry IDs, not content. Enforce a max payload size.** | Prevents Redis and dead-letter queues from growing with document bytes. | Low | Enforce `MAX_QUEUE_PAYLOAD_BYTES = 4096` and reject raw content keys in `apps/api/src/queue/QueueManager.ts` (Intent 77). |
| **Keep scale-to-zero. Measure cold start. Add a minimum instance only if the brief p95 actually breaches the target.** | Idle cost stays near zero while volume is low. | Low | Keep `min-instances: 0` on Cloud Run API; track `brief_hot_path_duration_ms` and `cold_start_duration_ms` histograms (Intent 77). |

### What to keep

- **Modular monolith.** Extract a worker or a separate service only when
  interactive latency or release cadence forces it. The brief path and the
  background jobs can share the process for now.
- **Tenant-scoped Mongo collections and the existing isolation tests.** The
  platform later adds a read API; it does not add a second data store.
- **Deterministic solver as the only source of numbers.** The brief result is
  cached with the `solver_version` and the `data_version`. A numeral on the
  shared page must match that payload.
- **Static web on Firebase Hosting.** The share link is a public, cacheable page
  that calls the API only for the result.

### What not to do

Do not introduce a second database, a message bus, or a microservices split to
"prepare for scale." The current Cloud Run + Mongo + Redis shape handles the
brief volume until the object-storage and invalidation changes are done. Do not
put document bytes or model calls on the path that produces the first free
brief.

---

## 4. Governed single-call LLM pattern for the brief platform (no agent loop)

The repo already has a governed single-call LLM layer in `packages/platform`
(`task-gateway.ts`, `llm-guards.ts`, budgets, circuit breakers,
`structured-llm.ts`, local models in `ai-bom.yaml`) and **no open agent loop**.
Keep that foundation and use only tightly bounded, code-driven sequences where
the solver remains the sole authority:

| Pattern | Fit | Implementation in this codebase |
|---|---|---|
| **Governed single call** (already present) | Primary path | Every model use goes through `governedLlm` / `governedVision` / `governedDecide` with a task registered in `definitions/ai-tasks.yaml`. Unknown tasks fail closed (`packages/platform/src/task-gateway.ts`). |
| **Template-first, model-optional** | First free brief | The brief route renders a fixed `template_sentence` from the solver payload and **never calls a model**. An optional, separate `brief.narrate` call only rephrases that template; if it fails or budget is exhausted, the template is shown. |
| **Numeral-presence guard** | All user-visible text | Server-side output guard on `brief.narrate` in `packages/platform/src/llm-guards.ts` (extending the client-side check in `onDeviceLlm.ts` and `numeral-presence.test.ts`): verify every numeral in the narration appears in the solver payload, or reject and fall back to the fixed template. |
| **Structured extraction with human confirm** | Document reading | Use `structured-llm.ts` + `extraction/pipeline.ts` under `document.extract_fields` (`authority: candidate_for_review`) to return candidate fields (`provider`, `coverage_amount`, `deferred_period`, `renewal_date`, `premium`, `policy_number`) stored in `extraction_candidates`. A person must confirm them before they affect a brief. |
| **Local-first for family content** | Email and policy classification | Prefer the digest-pinned local models in `ai-bom.yaml` (`qwen2.5:7b`, `GLiNER2.5-Decide`, `bge-small-en-v1.5`) for family-data classification/extraction; hosted models only for tasks whose policy allows `approved_hosted_provider`. |
| **Bounded multi-step (not an agent)** | Stage 2 problem packs | Fixed code sequence: `load fields → run solver → (optional) narrate → store result with solver_version + data_version`. No tool-calling loop, no model deciding the next step. |
| **Cache by data version** | Cost and consistency | Cache the narrated sentence keyed by `solver_version + data_version` on the brief record so a hit returns the stored sentence without a model call. |

**Patterns to avoid:**
- Open agent loops that let the model choose tools or decide what to compute.
- Multi-agent setups (planner, critic, executor) on the brief path.
- Letting the model supply or adjust any number, even as a "suggestion."
- Long-lived conversational agents that accumulate context across sessions.
- Hosted models for family-content classification when the local encoder or judge already exists.


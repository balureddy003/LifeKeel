# Intent 97: Complete the engine stack (parsing, rules, selective risk, store, queue, tax, tabular helper, observability)

**Status:** proposed, 2026-11-15. Builds on intents 93 to 96. Written after the owner asked "are these not addressed" about the framework table in the research blueprint. Each slice below is one concern and one PR.

## Where things stand (verified against `main`, 2026-11-15)

| Layer | State |
|---|---|
| Parsing (Docling) | Not built. Extraction uses the existing `document.extract.v1` task through the AI task gateway. |
| Schema and mechanical rules | Built in plain TypeScript: `resilience/extraction-checks.ts`, run before bank-statement suggestions. Not Zod. |
| Selective risk | Not built. Every extracted field is reviewed by a person. No accuracy history is recorded. |
| Store | Built on the existing MongoDB: `engine_facts` (two dates, append-only), per-estimate versions (`resilience/dependencies.ts`), `business_graph`. Shock rates are a data file (`event-rates.ts`), not stored versions. |
| Queue | Not used. The repo has a Redis queue (`apps/api/src/queue/QueueManager.ts`), but extraction and simulation run inside the request. |
| Simulation | Built. Deterministic monthly cash-flow in `resilience/`. |
| Tax and benefits (PolicyEngine) | Not built. AGPL, no signed licence, parked as B7. |
| Tabular helpers | Not built. |
| Observability | Not built for the engine. OpenTelemetry exists in `packages/platform`. |

## Problem
The core is done and verified, but five things in the blueprint are missing or only half there: layout-aware parsing is not local and not checked, nothing records how often extraction is right (so no field can ever be auto-accepted safely), slow work blocks requests, nothing measures the engine, and two optional helpers (tax and benefits, anomaly flags) have no route in. The owner needs one plan that says what to build, in what order, what each slice must prove, and what stays blocked and why.

## Done looks like
Per slice below. Overall: a household's statement is parsed locally, checked mechanically, reviewed by a person, and every confirmation or correction is counted (content-free). With enough history, a field class that has proven reliable on a held-out verifier set may skip review, never before. Slow extraction runs off-request. Every slice passes the verifier first, and `bash scripts/engine-verify.sh` stays green.

## Constraints (all slices)
- **Trust tier:** 0. Read-only plus append-only facts and counters. No action, no money moved. Approval gate: the existing both-adult confirmation stays for anything shown as the household's figures.
- **Regulated-advice check:** no slice names or steers to a product. Tax and benefits output states what a rule gives for the household's own figures, with the licensed-professional line.
- **Data and privacy:** CLAUDE.md rule 3. Metrics carry counts and field names, never values, names or document text. Parsing and any model run locally or through the approved gateway processors. No family content to a consumer endpoint.
- **Process:** verifier first (tests red, then smallest code to green), one concern per PR, branch from `origin/main`, owner merges, owner deploys.

---

## Slice 1. Engine metrics (build first)
**Problem.** There is no count of how often extraction is confirmed unchanged, corrected, or fails its mechanical checks. Without it the selective-risk gate (slice 4) has nothing to learn from, and the owner cannot see if extraction is getting better.

**Done looks like**
- Counters, content-free, per field class and document category: `extraction_suggested`, `extraction_check_failed` (with which check), `extraction_confirmed_unchanged`, `extraction_corrected`, `statement_rejected`.
- Confirmation metrics: figures confirmed by one adult, by every adult, time from first view to both-adult confirmation (bucketed).
- Emitted through the existing OpenTelemetry setup in `packages/platform`, and one append-only collection `engine_metrics_events` (tenant key, field class, outcome, date) so history survives for slice 4.
- A test proves no event can contain a figure, name or document text (the event type has no free-text field).

**Verifier.** Unit tests on the event builder and on a scan that fails if any metric label is free text. Route tests that confirming and correcting each write exactly one event.

**Out of scope.** Dashboards, alerts, any per-person tracking.

**Open for owner.** Retention for `engine_metrics_events` (proposed 24 months, then aggregate and delete rows).

## Slice 2. Extraction off the request path
**Problem.** Statement and document extraction run inside the HTTP request. A slow model call blocks the request and a failure loses the work.

**Done looks like**
- Extraction becomes a job on the existing Redis `QueueManager`: enqueue on upload, status readable by the page, result written as candidates exactly as today (review and `apply` unchanged).
- Idempotent per document, bounded retries, a dead-letter state the page can show ("could not read this, enter the figures by hand").
- If Redis is unavailable the upload still succeeds and extraction is retried later; nothing is lost silently.
- No change to who can see candidates, nor to the rule that nothing is applied without person review.

**Verifier.** Tests: job runs once per document, retry then dead-letter, enqueue failure does not fail the upload, tenant scoping on the job payload, payload contains a document id and tenant id only (never content).

**Dependencies.** None on slice 1, but build after it so job outcomes are counted from day one.

**Out of scope.** Re-simulation jobs (the solver is milliseconds; revisit only if measured slow, which is also why the result cache stays unbuilt).

## Slice 3. Parsing with Docling (local worker)
**Problem.** Layout-aware text and table extraction should run locally, so a statement's content never needs a hosted model just to be read.

**Done looks like**
- A Python worker (Docling, MIT) in `services/` following the existing python-services pattern, called by the extraction job from slice 2. Input: a stored document id. Output: structured text and tables, held only for the job.
- The model step (field extraction) reads Docling's output instead of raw bytes where it is available, falling back to today's path.
- The worker is not reachable from outside the service network, writes nothing to disk beyond a temp file deleted after the job, and logs no content.
- A fixed set of 10 to 20 synthetic statements (made-up numbers and names, committed under `fixtures/`) with expected totals. The check: parsing plus field extraction plus the mechanical checks reproduce the expected six statement fields on at least the proportion the owner sets (proposed 90 percent), else the slice does not ship as the default.

**Verifier.** Python unit tests for the worker, an integration test with the fixtures, and a TypeScript test that the fallback still works when the worker is down.

**Dependencies.** Slice 2. The owner decides where the worker runs and its cost.

**Out of scope.** OCR for photos of paper (separate decision), any model fine-tuning on documents (rule 3).

## Slice 4. Selective-risk gate (accept a field only when its class has earned it)
**Problem.** Reviewing every field makes the product slow for fields that are almost always right. Skipping review is only safe with measured accuracy on data the model was not tuned on.

**Done looks like**
- A pure TypeScript module `resilience/selective-risk.ts`: given counts per field class (confirmed unchanged versus corrected, from slice 1) and a verifier set, return `review` or `accept`. A class is `accept` only when its upper confidence bound on the error rate is under the owner's α, with a minimum sample size, and the mechanical checks passed for that document.
- Default α and minimum sample size are provisional and conservative (proposed: error rate bound under 1 percent, at least 300 verified samples). The module returns `review` for everything until the owner sets both and a verifier set exists.
- Money-in and money-out (the figures behind the estimate) are never auto-accepted in the first release regardless of the numbers. Only low-consequence classes may qualify first, chosen by the owner.
- The both-adult confirmation of figures is unchanged: auto-accept skips the per-field review of an extracted value, not the household's confirmation of the estimate.

**Verifier.** Property tests: more data never makes a class less safe, a single recent correction can flip a class back to `review`, an unknown class is `review`, the bound is monotone in sample size. A mutation run: raising α or lowering the minimum makes a named test fail.

**Dependencies.** Slice 1 must have collected real history. Blocked until then. This is the item the owner cannot unblock by deciding; it needs households using the product.

**Out of scope.** Learning across households (that is the gated plumbing in intent 96, a different thing, and not used here). Any model-based confidence score.

## Slice 5. Schema checks on Zod (small, optional)
**Problem.** The fixed field schema and mechanical checks are hand-written TypeScript. Zod (MIT, already a dependency) would give one declared schema per document category shared by the checks, the review screen and the tests.

**Done looks like.** `extraction/schema.ts` and `extraction-checks.ts` express each category's fields and rules as one Zod schema, with the same behaviour. All existing extraction tests pass unchanged, which is the proof it is a pure refactor.

**Verifier.** The existing `extraction-checks`, `schema-grounding` and `statement-mapping` tests, unmodified, plus a test that every category in `document-categories` has a schema.

**Dependencies.** None. Lowest priority; skip if it does not simplify the code.

## Slice 6. Shock distributions as versioned data
**Problem.** Event rates are a data file with sources. The blueprint wants them as versioned, queryable records so a change to a rate is a new version and can be traced to the figures that used it.

**Done looks like.** Rates stay population-level and every row still cites source, table and date, or is absent (intent 93 decision). Each rate set gets a version hash included in the estimate output ("rates version"), so an estimate can say which rates it used. Updating rates is a reviewed PR to the data file; no runtime editing.

**Verifier.** Test that the version changes when any row changes, that the estimate reports it, and that a row without a source fails the data-file test.

**Out of scope.** Fetching rates automatically, household-specific rates, any figure that cannot be verified from its source (the ledger marks those as gaps).

## Slice 7. Tax and benefits through PolicyEngine UK (blocked)
**Problem.** Estimates leave out tax and benefits, which matters for the runway after income stops.

**Blocked on.** A signed licence. PolicyEngine UK is AGPL. Running it as a separate service called over HTTP is the proposed way to contain the licence, but containment is a legal question, not a technical one, and the owner parked it (B7).

**When unblocked, done looks like.** A separate service, called over HTTP from the API, never linked into the API process. The estimate gains an optional "after tax and benefits" line with the household's own figures only, labelled an estimate, with what it assumes. The existing estimate is unchanged when the service is down. No benefit is named as something to claim, only what a rule would give for the entered figures, with the licensed-professional line.

**Verifier.** Contract test against a recorded service response, a test that the API works with the service off, and an advice-rule scan on the new copy.

**Owner action.** Licence decision from counsel.

## Slice 8. Tabular anomaly helper: CatBoost (owner decision 2026-11-15)
**Decision.** Use CatBoost (Apache-2.0, a standard open licence with no copyleft; the owner chose it over TabICLv2). Run it locally in a Python worker. TabICLv2 is dropped from this intent.

**Problem.** Statement totals that look unusual are worth a second look before a person confirms them.

**What CatBoost can and cannot do here.** CatBoost is a supervised model. It has no built-in anomaly detector, so it would be used as a forecaster: predict what a household's monthly money-in or money-out should be from its earlier months and calendar features, then flag a month whose actual total is far outside the prediction. That has two honest limits:
- A single household has few months of statements. A model trained on 3 to 12 rows of one household is weak. A pooled model trained across households would be cross-tenant learning, which CLAUDE.md rule 3 only allows with the opt-in consent in intent 96, so it is not assumed here.
- A plain deterministic rule (median and median absolute deviation over the household's own months) may do as well. So the build order is: deterministic rule first as the baseline, then CatBoost only if it measurably beats the baseline on the fixtures.

**Done looks like**
- An anomaly flag only. It never fills, changes or proposes a figure. The output type has no value field that could be applied.
- A Python worker (`services/`, same pattern as the existing python services), local, no network egress, no content logged, temp files deleted after the job.
- Off by default, behind a flag, not part of the core calculation.
- Trained only on data that rule 3 allows: the household's own statements, or synthetic fixtures. Never pooled family content without the intent 96 opt-in.
- Shown as "this total is unusual compared with your other months, check it", with the licensed-professional line only where money advice could be read in.

**Verifier**
- A test that the flag type has no applicable value, and that disabling the helper changes no estimate.
- A fixture evaluation (synthetic multi-month statements with planted errors): detection rate and false-flag rate for the deterministic baseline and for CatBoost, side by side. CatBoost ships only if it beats the baseline by a margin the owner sets (proposed: at least 10 points better recall at the same false-flag rate), otherwise the baseline ships and CatBoost is dropped.
- A licence check recorded in `NOTICE` for CatBoost and its dependencies at the pinned version.

**Dependencies.** Slice 3 (parsing) and real or synthetic multi-month statements. No code is written for this slice until the fixtures exist, so the evaluation cannot be skipped.

**Out of scope.** Filling missing values with a model (the blueprint keeps that out of the core calculation), per-person tracking, any hosted tabular API.

## Slice 9. Observability dashboards and alerts (after slices 1 to 4)
Aggregate the slice 1 events into the operator view the owner already has. No per-household drill-down of content. Alerts on rising check-failure rate. Done only when a human can answer "is extraction getting better" from one screen.

---

## Order and what unblocks what
1. Slice 1 (metrics). Unblocks 4 and 9. Nothing blocks it.
2. Slice 2 (queue). Unblocks 3.
3. Slice 3 (Docling). Needs the owner's hosting and cost decision.
4. Slice 6 (rates version). Independent, small.
5. Slice 5 (Zod). Independent, optional.
6. Slice 4 (selective risk). Blocked on real history from slice 1.
7. Slice 7 blocked on a licence decision. Slice 8 (CatBoost chosen) blocked on slice 3 and on fixtures to evaluate against.
8. Slice 9. After 1 to 4.

## Decisions needed from the owner
- Retention for metrics events (proposed 24 months).
- Where the Docling worker runs and its monthly cost ceiling (ties to B8).
- The accuracy target on the synthetic statements (proposed 90 percent) before Docling becomes the default.
- α, minimum sample and the first low-consequence classes for the selective-risk gate.
- PolicyEngine licence position. (Tabular library decided: CatBoost, 2026-11-15. The baseline margin for it to ship is still the owner's to set.)

## Not in this intent
MCP, business graph and cross-tenant sharing are covered by intent 96 and built. Product-steering stays unbuilt (rule 2). The account split, lodger view and external link wait on a safeguarding review. The result cache stays unbuilt until the solver is measured slow.

**Becomes** — docs/prd/NNN-engine-stack-completion.md once the owner accepts the order.

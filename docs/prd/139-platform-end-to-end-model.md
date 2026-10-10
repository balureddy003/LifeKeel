# PRD-139: Platform end-to-end model — what "world-class" requires, re-sequenced after review

Status: **design / roadmap for review. Nothing here is built.** Supersedes the phasing in
[PRD-138](138-evidence-driven-twin-design.md); 138 remains the detailed design for the ledger,
freshness and recompute.
Trust tier: Tier 0 throughout. No new Act surface.

## How this was produced

Four independent adversarial reviews were run as AI role-reviews (data/event-sourcing architect,
AI-systems and security architect, privacy and UK regulatory-perimeter reviewer, SRE/FinOps
architect), each told to verify claims against the code. They are structured critique to be
checked, **not a substitute for qualified human review**: the privacy/regulatory items below are
flags for counsel, not legal advice, and the cost figures include recalled list prices that must be
checked against a real bill. Claims marked *verified* were re-checked against the code by the
author; the rest are reviewer findings.

## Phase 0 build status (this branch)

Built, and verified locally with the full root pipeline (typecheck, lint, 1,330 API tests, build) plus the
boot smoke test against the real built server:

| Item | State |
|---|---|
| Scheduled jobs on a scaled-to-zero instance | **Built.** `CRON_MODE=external` + one Cloud Scheduler job calling `POST /internal/cron/tick`; secret-gated, catch-up capped at 15 min, duplicate-delivery safe, heartbeat metric `lifekeel_cron_last_tick_timestamp_seconds`. Default stays in-process (no behaviour change until switched). Not yet run on GCP. |
| Erasure coverage | **Built.** 18 tenant collections added to account deletion; a CI guard fails when a new tenant-scoped collection is in neither the deletion list nor `ERASURE_RETAINED`. Data export deliberately **not** extended: it is tenant-wide for any member today, so it needs per-member access control first (open item). |
| Metric cardinality | **Built.** `tenant_id` dropped from 10 metrics' labels. |
| Judge default model / scale-to-zero default | **Built** in `deploy-local-judge.yml` (3b, `min_instances=0`). Not deployed. |
| CI/CD on free limits | **Built.** See `docs/ci-cd-cost.md`. Savings not yet measured. |
| Lean GCP footprint | **Written, not run.** `infra/gcp/setup-lean.sh` (syntax-checked only) and `infra/gcp/README.md`. |

Not done yet from Phase 0: confirm Mongo is a replica set; measure model cold start and Cloud Run
queueing/429 behaviour; the email-enqueue herd fix (jitter/bucketing) and the stale-sweep index; the
Ask Keel cloud-fallback and member-route authorization decisions; the DPIA; running the deploy
workflows end to end. Deploying needs a person: this environment has no GCP credentials, and
`CLAUDE.md` keeps deploys a deliberate manual step.

## 1. The end-to-end model

```
 CAPTURE (edge)            UNDERSTAND (typed, local)       STATE (source of truth)
 ─────────────             ───────────────────────         ───────────────────────
 document upload ─┐        OCR + constrained decoding       ┌──────────────────────────┐
 email attachment ─┼─►     → EvidenceItem → Proposal ──────► │ write funnel             │
 manual entry     ─┤        (untrusted text never          │ applyProfileChange()     │
 "still correct"  ─┘         reaches a tool-using agent)    │  ├─ twin_changes (ledger,│
                                    │                       │  │   encrypted values)   │
                          human approval gate ─────────────►│  ├─ current documents    │
                                                            │  └─ twin_field_state     │
                                                            └────────────┬─────────────┘
                                                                         │ change(seq)
                          ┌──────────────────────────────────────────────┤
                          ▼                                              ▼
              REASON (rules first)                            RECOMPUTE (queue, idempotent)
              YAML detectors over data.* signals              path→signal map (CI-tested)
              guards: move-guard, output guard                evaluate @ latest seq,
              typed small-model decisions                     stamp evaluated_seq
                          │                                    + scheduled sweep for time-based
                          ▼                                      facts (renewals, freshness)
              INSIGHTS / READINESS / SCENARIOS ──► feed, inbox, notifications (Tier 0)
                          │
                          ▼
              AGENT LAYER (first-party, internal tools; no MCP yet)
              orchestrator + per-member agents = scope + allowed tools + tier + guards
              principal comes from the server token, never from model arguments
              tools return typed values only (no raw evidence text); budgets per request/day
                          │
                          ▼  (later, opt-in, read-only, after security gates)
              MCP server: current projection + freshness label, member-scoped,
              short-lived revocable tokens, every call audited and guarded
```

Cross-cutting: tenant isolation (`getTenantCollection`), audit log, metrics/SLOs, erasure and
export coverage, cost counters.

## 2. Pattern catalogue — what each pattern is for and where it lands

| Pattern | Role here | Status |
|---|---|---|
| Rules before models | Detectors/guards decide what they can; models see the rest | exists |
| Cascade with human review queue | Failure ≠ verdict; ambiguous → human | exists |
| Constrained decoding + schema validation | Typed model outputs | exists |
| Shadow mode / eval gates | Promote only on measured agreement | exists |
| Queue fan-out, idempotent handlers, per-tenant lock | Scale and retries | exists (email scan) |
| Write funnel (single writer) | Make the ledger complete | **missing — 5+ writers today (verified)** |
| Append-only ledger + projection | History, replay, audit | designed (138) |
| Stable element ids for arrays | Make field paths durable | designed, required |
| Crypto-shredding (per-tenant data key) | Erasure from an append-only log | **new, from privacy review** |
| Freshness/TTL on facts | Honest confidence about stale facts | designed (138), deferred behind ledger |
| Sequence-stamped recompute (`seq`/`evaluated_seq`) | No storms, no missed updates | **new, from SRE review** |
| Scheduled sweep for time-driven facts | Renewals/decay change with no event | exists partly (see §4) |
| Principal-derived tool scopes | Prevent confused-deputy leakage | **new, agent layer** |
| Untrusted-data separation | Injection defence | partly exists (OCR/email prompts) |
| Adversarial/tool-use evals in CI | Keep agents safe over time | **new** |
| Per-agent budgets, circuit breakers | Cost runaway | **new** |

## 3. What the reviews changed (disposition)

**Accepted — design corrected**
- The twin has multiple writers (`documents.ts` writes the profile directly at ~397/481, the inbox
  and review routes also write; *verified* for documents.ts). The "one write helper" is therefore the
  main Phase 1 workstream, with a CI rule banning direct writes.
- `family_financial_profile` has an optimistic `version` check that other writers bypass, so the
  existing concurrency guard is weaker than it looks (reviewer finding; to verify during Phase 1).
- Array paths like `policies[3]` are unstable; ledger paths use element ids; deletes are explicit events.
- `seq` must come from an atomic counter, not `max+1`.
- The daily sweep does **not** expire time-based facts (it keys on `updated_at`); 138 said it did.
- The annual review (`reviewed_at`, `review_snapshot`) already exists; "confirm still correct"
  extends it instead of duplicating it.
- Backfill must not use `updated_at` as "last confirmed" (autosaves touch it); use `reviewed_at`,
  else mark `unknown_age`, and backfill must be silent (no recompute storm).
- Erasure/export lists are already incomplete (*verified*: `family_assets`, `readiness_events`,
  `member_nudges` are not in `DELETABLE_COLLECTIONS`; also my own `judge_shadow_results`, which holds
  ids and decisions and expires in 30 days). New tenant collections need a CI test that they appear in both lists.
- Ledger `before`/`after` values are encrypted; free text (context notes, asset notes) is never
  ledgered, only hashed events; production must fail closed if decryption falls back.
- Reads of the ledger are audited (new audit actions); logs carry paths, never values.
- Freshness/"confirm" copy is template-only (no model-generated prompt text), ranks by staleness not
  by impact, and never implies inadequacy or steers an action.
- PRD-138 does **not** lower cost. It improves correctness and trust. Savings claims are removed.

**Accepted — new work not in 138**
- Cron reliability (§4, item 1).
- Internal tool layer before any MCP.

**Deferred / cut from Phase 1**
- Bitemporal `valid_from`, per-field `confidence`, `effective_confidence`, detector freshness
  opt-in, weekly confirm batch, user-facing history screen, physical-assets depth, home-hub bridge.

**Where reviewers differ, and the call**
- *Visible history:* data review says operator-only first; privacy review says own-data adults-only
  is good for transparency but only after per-subject access exists. **Call:** operator-only first;
  user-visible own-data history after the per-subject DSAR work.
- *Retention:* both point to a bounded window (24 months rolling) with compaction to a snapshot, not
  "life of account". **Call:** adopt; confirm with counsel.
- *MCP:* security review says defer and build internal tools first; privacy review says if ever,
  read-only, current projection only, no history, no write tools including "confirm". **Call:** both.

## 4. Existing platform risks surfaced by the reviews (fix regardless of PRD-138)

1. **Scheduled jobs may not run in production.** *Verified:* the API deploys with
   `--min-instances=0` and default CPU throttling (`deploy-api.yml:66`) while `server.ts` runs 24
   in-process `node-cron` job registrations (some env-gated). A scaled-to-zero or throttled instance does not fire timers. The
   email scan, stale sweep, reminders and escalation SLA are exposed. Fix options: Cloud Scheduler
   (or Cloud Run Jobs) calling authenticated endpoints, or `min-instances=1` with
   `--no-cpu-throttling`. Add a cron-heartbeat alert either way.
2. **Thundering herd and unbounded backlog** in the 15-minute email enqueue (all tenants per tick,
   sequential, single instance ~3.8 emails/min). Jitter/bucket tenants, cap per tick, add backpressure.
3. **Stale-profile sweep is a collection scan** (`$expr` over two fields) with no sort; use a
   sequence/dirty flag with a sparse index and fan out via the queue.
4. **Metric cardinality:** `tenant_id` labels grow with families.
5. **Judge default model** in the deploy workflow is 7b although 3b measured better on OCR and is
   roughly 1.5–2× faster; verify Cloud Run's queueing/429 behaviour and default to 3b.
6. **Ask Keel fallback:** unless `LOCAL_TEXT_ENABLED=true` it uses the unguarded cloud router
   (*verified*; documented opt-in). Decide whether that default is acceptable for family data.
7. **Authorization on member routes:** any authenticated family member can read any member's twin
   (*verified*, documented as household-wide by design). Confirm that is the intended product
   decision, then enforce child redaction by role, not by a `mode=youth` query flag (reviewer finding).
8. **Prompt hygiene:** Ask Keel's prompt does not mark user-authored context (`context_note`, life-event
   text, filenames) as untrusted data, unlike the OCR and email prompts; the number-grounding check
   accepts any figure present anywhere in the prompt, including injected text.
9. **No DPIA, backups/PITR plan, runbooks, SLOs, alert rules, or load tests;** deploy workflows have
   never run end to end.

## 5. Cost model (variable parts partly measured; prices and volumes assumed)

| Item | Basis | Status | $/month |
|---|---|---|---|
| Judge service, 4 vCPU/8 GiB, `min=1`, no throttling | ~$0.32/hr | **price recalled, not checked** | ~200–260 |
| Same with `min=0` and batch windows | busy hours only | assumed | scales with busy hours |
| API, `min=0` (but see risk 1); `min=1` no throttling | | assumed | 0 → ~50 |
| MongoDB + Redis + egress/logs | small tier | assumed | ~25–110 |
| **Fixed floor** | | | **~250–400** |
| Variable per family | ~40 emails reach the model, ~2 docs, ~10 insights a month | latencies measured, volumes assumed | **~$0.05–0.30** |

Per family ≈ floor ÷ families + variable: roughly $3–4 at 100 families, $0.40–0.70 at 1,000.
Idle compute dominates, so the lever is batching with scale-to-zero and defaulting to the 3b model,
not the ledger (<$0.01 per family). **Unmeasured:** cold start, real 429/queue behaviour, mail
volume per family, Mongo working set.

## 6. Re-sequenced roadmap

- **Phase 0 — fix what exists (no new product surface).** Cron reliability + heartbeat alert; erasure
  and export coverage + CI test; metric cardinality; judge default and queue behaviour; Ask Keel
  fallback and member-route decisions; run the deploy workflows end to end; the three SRE tests
  (cold-start/429, herd/backlog, sweep/ledger scale). Start the DPIA and counsel questions.
- **Phase 1 — write funnel and ledger.** `applyProfileChange()` with all writers migrated and a CI
  ban on direct writes; array element ids (schema upcast); atomic `seq`; encrypted ledger; explicit
  delete events; read-audit actions; erasure/export wiring; counters (detector runs per tenant per
  day, ledger size). Atomicity decided first (replica-set transactions, or an in-document outbox).
- **Phase 2 — freshness projection**, operator-only, no user prompts yet; extend the annual review for
  confirmations; honest backfill.
- **Phase 3 — sequence-stamped, change-triggered recompute** in shadow beside the full pass; the
  path→signal map proved by a perturbation test; time-driven facts in a bucketed scheduled job.
- **Phase 4 — internal agent/tool layer**: principal-derived scopes, typed values only, per-request
  tool-call caps and daily token budgets, every tool result through the guards (with a CI test over
  the tool registry), adversarial evals at 100% pass (injection in documents/emails, cross-member and
  child principals, vault probes).
- **Phase 5 — MCP**, opt-in, read-only, current projection plus freshness label, short-lived
  revocable per-member tokens, static hash-pinned tool descriptions, loopback/tenant-network default,
  per-client consent naming where data goes, no history, no write tools.

## 7. Evidence required before calling any of this "world-class"

Invariants as tests (replay equals projection; no approved change lost; no unapproved extraction
changes state; every tool result guarded; erasure removes every tenant collection); shadow runs on
de-identified real histories; measured cost per family before/after; freshness shown to predict
wrongness on real data; load and chaos results; an independent human security and privacy review.
Until those exist this is a sound design, not a proven platform.

## 8. Open decisions (need an owner)

1. Cron strategy: Cloud Scheduler/Jobs vs `min=1` no-throttling (cost vs simplicity).
2. Is production MongoDB a replica set? Decides transaction vs outbox.
3. Retention window and crypto-shredding scope; DPIA owner.
4. Is household-wide read visibility of member twins intended, and for which roles?
5. Is the cloud fallback for Ask Keel acceptable, or should the default flip to local-only/safe-fallback?
6. Will MCP ever be offered to third-party clients, given the self-hosted-only decision?

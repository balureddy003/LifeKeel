# PRD-138: Evidence-driven twin — history, freshness, and change-triggered recompute (design)

Status: **design for review. Nothing here is built.**
Trust tier: **Tier 0** (read models, ledger, notifications). No new Act surface.

## Problem

The Family Twin is a set of current-value documents. `family_financial_profile`
is one document per tenant (unique `tenant_id` index, `migrate.ts`), and
`family_assets` entries are patched in place (PRD-135: "declared values drift").
That gives three gaps that matter more than any missing domain:

1. **No history.** An edit overwrites the old value. We cannot answer "what did
   we believe in March, who changed it, and from which document", cannot replay
   a detector run, and cannot show a trustworthy "what changed" (PRD-136) —
   `readiness_events` is a *narration* feed: fire-and-forget, deduped per day,
   allowed to drop. It is derived, not a source of truth.
2. **No notion of staleness.** A pension balance entered 18 months ago is
   treated exactly like one entered yesterday, so detectors and Ask Keel
   state out-of-date numbers with full confidence. For physical-world facts
   (a car, a flat, a policy renewal date) this is the main failure mode: the
   world moves and the twin does not know.
3. **Recompute is coarse.** Profile submit re-evaluates broadly
   (`family-financial-profile.ts` calls `engine.evaluate()` in ~10 places) and a
   daily sweep (`jobs/stale-profile-evaluation.ts`) catches the rest. Cost
   grows with families, not with activity.

Research context (papers surveyed 2026-10; abstracts only for most, none about
a family-scale twin): digital-twin synchronisation work favours event-triggered
or pull-on-discrepancy updates over polling, and treats twin state as an
*estimate* of a partly observable physical state. Smart-home LLM work grounds
the model in current device/room state and rejects unsafe requests early. We
borrow the ideas, not the systems. Sources are listed at the end.

## Who it's for

Every adult member (children see the same redacted slice as the youth twin).
Also the operator: replayable history is what makes shadow/eval of detectors
and the judge meaningful on real data.

## Goals

- Every change to twin state is an **append-only, attributed, replayable** event.
- Every twin **field carries freshness** (last confirmed, source, confidence)
  and consumers (detectors, Ask Keel, readiness score) can see and use it.
- A change **re-runs only the detectors that depend on it**.
- Physical-world facts enter through **evidence** (document, email, manual
  confirmation), always proposed and human-approved — never auto-applied.
- Lower cost per family than today: model calls only on new evidence or when a
  field needs re-confirming.

## Non-goals

- No sensor/IoT streaming, no graph database, no hosted third-party models.
  (Optional read-only home-hub bridge is deferred; see Phasing.)
- No new regulated behaviour. Freshness prompts say "this may be out of date,
  please confirm" — never "buy/switch/this is the right product"
  (CLAUDE.md second rule).
- Not a replacement for `readiness_events`: that stays the narration layer,
  and is rebuilt *from* the ledger below.
- Health and special-category data stay deferred (PRD-135).

## Design

### 1. Evidence → proposal → approved change

```
 capture                 extract (local, typed)         human gate        state
 ───────                 ─────────────────────          ──────────        ─────
 document upload  ─┐
 email attachment ─┼─►  EvidenceItem ─► Proposal ──► approve/edit/reject ─► TwinChange
 manual entry     ─┤    (source, hash,   (field,       (existing UX:        (append-only)
 confirm-still-ok ─┘     received_at)     new value,    PRD-109 bridge)         │
                                          confidence)                           ▼
                                                                         current state
                                                                         (projection)
```

- Extraction reuses `ocr/*` and the local constrained-decoding path; its output
  is a **Proposal**, as today (`ocr/profile-mapping.ts`). Extraction never
  writes state.
- "Confirm still correct" is a first-class evidence source with no extraction
  cost: one tap re-stamps freshness without changing the value.

### 2. Data model (all tenant-scoped via `getTenantCollection`)

`twin_changes` — the ledger. Append-only; no updates, no deletes except TTL
under the retention rule below.

| field | notes |
|---|---|
| `id`, `tenant_id`, `seq` | `seq` monotonic per tenant (for ordered replay) |
| `subject` | `{ kind: 'profile'|'asset'|'policy'|'member'|'fund', id }` |
| `path` | field path, e.g. `policies[3].renewal_date`, `assets.<id>.value_minor` |
| `before`, `after` | values (money in minor units, as everywhere) |
| `valid_from` | when this became true in the world (may predate recording) |
| `recorded_at` | when we learned it |
| `source` | `{ type: 'document'|'email'|'manual'|'confirm'|'import', ref, evidence_hash }` |
| `proposed_by` | `'user'` or `{ model, version }` for extracted proposals |
| `approved_by`, `approved_at` | required for non-manual sources |
| `confidence` | 0–1, from extraction or `1` for manual/confirm |

Two time axes (`valid_from` vs `recorded_at`) so a late-discovered fact does not
rewrite history.

`twin_field_state` — a **projection** of the ledger (rebuildable). One row per
`(tenant, subject, path)`:

```
last_confirmed_at, last_changed_at, source_type, confidence, ttl_days, stale (bool)
```

The current documents (`family_financial_profile`, `family_assets`) stay the
read path for now. They are written in the *same operation* as the ledger append
(see Consistency), so no consumer needs to change on day one.

### 3. Freshness (cheap state estimation)

Each field class has a `ttl_days` and a decay, defined in one table, not in code
paths:

| class | example fields | ttl |
|---|---|---|
| contractual date | policy renewal, term end | until the date, then `expired` |
| slow-moving balance | pension, savings, fund value | 90 d |
| declared asset value | property, vehicle, valuables | 180 d |
| identity/structure | roster, DOB, policy existence | no decay; re-confirm on events |

`effective_confidence = confidence × freshness(t)` where freshness decays
linearly from 1 at `last_confirmed_at` to a floor (0.5) at `ttl_days`, then
holds at the floor and sets `stale = true`. This is deliberately a rule of thumb,
not a Bayesian filter; the constants are placeholders to be tuned against real
data (see Open questions).

Consumers:
- **Detectors**: the evaluation context gains `data.freshness.<signal>`, the
  lowest effective confidence among that signal's declared input paths (link A
  in §4); a rule may require freshness or downgrade its confidence. Existing detectors are
  unchanged until they opt in, so behaviour does not shift silently.
- **Ask Keel**: context assembly appends "as of <date>" to figures and omits
  or flags stale ones. The existing ungrounded-figure guard is unchanged.
- **Readiness score**: reports `data_confidence` next to the score instead of
  silently treating stale inputs as current.
- **Prompts to the family**: a weekly batch lists the few stalest, highest-impact
  fields ("Is your car valuation still about £X? Confirm / Update") through the
  existing heartbeat (PRD-136). Capped, to avoid nagging.

### 4. Change-triggered recompute

Detectors do not read raw profile paths. They read derived `data.*` signals
(for example `data.debt_to_income_ratio` in `debt-health.yaml`) that
`family-financial-profile.ts` computes from the profile, and the YAML declares
no inputs list. So the dependency map has two links, and the second one does
not exist yet:

```
twin_change(path) ─► signalsFor(path) ─► detectorsFor(signal) ─► enqueue evaluate(tenant, detector, scope)
                     (A: TS map)         (B: parsed from YAML)
```

- **B (signal → detector)** is generated: parse `data.<key>` references out of
  each rule's `condition`, `impact_*` and `reasoning_template`. A CI test fails
  if a detector references a key no signal builder produces.
- **A (profile path → signal)** must be declared next to the code that computes
  each signal (the signal builders already live in one file). Make the
  builder register its own input paths, so the map cannot drift from the
  computation. A signal with no declared paths falls back to "re-run all
  detectors that use it on any change to that subject" — safe, just less
  precise.

- The queue/fan-out pattern already exists (`jobs/email-scan.ts`: ids only,
  dedupe window, per-tenant lock, handler never throws). Reuse it.
- Coalesce within a short window so a form submit that changes ten fields
  enqueues each affected detector once.
- The daily sweep stays as a safety net (it also expires time-based facts,
  e.g. a renewal date passing), but becomes cheap because most tenants have no
  stale or changed fields.
- Per-member scope: a change carries `subject.member_id`, so only that
  member's twin and insights are recomputed.

### 5. Reasoning path (unchanged in spirit)

Rules first (YAML detectors) → constrained small local models for typed
extraction/classification/judging → grounded Q&A that cites the fields it
used (now with dates) → deterministic scenarios. All guards (`move-guard`,
`withOutputGuard`) remain in front of every shortcut. Nothing here lets a cache
or a classifier skip the guard.

### 6. Consistency and failure model

- Ledger append and current-state write happen in one MongoDB transaction
  (replica set) or, where transactions are unavailable, as ledger-first then a
  projection write that a repair job reconciles by `seq`. A failed projection
  never loses the change; a failed ledger append aborts the write.
- Feed/narration writes stay fire-and-forget and are *derived* from ledger
  events; losing one loses a sentence, not a fact.
- Replay: any tenant's state at time T is reconstructable from the ledger.
  This is what lets shadow-mode and evals run on de-identified real history.

### 7. API sketch (additive; no breaking changes)

- `GET /family/changes?subject=&path=&since=` — adult-only, paginated ledger view.
- `GET /family/freshness` — stalest/high-impact fields for the prompt batch.
- `POST /family/freshness/confirm` — `{ subject, path }` re-stamps freshness (ledger `confirm` event).
- Existing write routes keep their shapes; they additionally emit ledger events.
- Child-mode redaction applies to all of the above (same rule as `Money`).

## Cost and scale

- **Storage**: one small row per change; a family produces tens to low hundreds
  per year. Index `(tenant_id, seq)` and `(tenant_id, subject.id, path)`.
  Retention is a policy decision (see Privacy); TTL index available.
- **Compute**: model calls happen only on new evidence (extraction) — already
  the case — and the weekly prompt batch is a deterministic query, no model.
  Detector runs drop from "per profile submit, broadly" to "per affected
  detector". Savings are expected but **not measured**; Phase 1 includes the
  counter that measures them (detector runs per tenant per day before/after).
- **Scale**: all new work is stateless workers over a queue plus indexed Mongo
  reads; scale-to-zero friendly. No new infrastructure.

## Privacy, trust, and the two repo rules

- **Trust tiers**: the ledger and freshness are Tier 0. Approval is required for
  every non-manual change, matching the existing extraction rule. Auto-confirm
  never changes a value.
- **Regulated advice**: freshness copy and prompts describe what is on file and
  how old it is. They never recommend a product, provider or action beyond
  "confirm or update". Prompt text goes through `scanText` in tests like other
  copy.
- **Data minimisation**: ledger stores values and hashes, not document bodies;
  evidence stays in the existing encrypted document store. `before`/`after` for
  vault-adjacent fields store references only. Retention: proposal is to keep
  the ledger for the life of the account and delete it with the account;
  decide before building (Open questions).
- **Audit**: reads of the ledger by anyone but the member/organizer go through
  the existing audit log.

## Testing and evaluation

- Property test: replaying the ledger reproduces the projection exactly, for
  random change sequences, including out-of-order `valid_from`.
- Dependency map tests: every `data.*` key a detector references is produced by
  a signal builder; every builder's declared input paths exist in the profile
  schema. A new detector or signal that breaks either fails CI.
- Detector opt-in tests: stale input lowers confidence; fresh input does not.
- Integration (real Mongo/Redis, as `email-scan-fanout.integration`): a change
  enqueues exactly the dependent detectors once; a double submit coalesces.
- Shadow: run new recompute alongside the old broad recompute for a period and
  compare resulting insights (the `withShadow` pattern already exists).

## Phasing

1. **Ledger + projection + freshness read model** (no behaviour change): append
   on existing writes, backfill an initial `import` event per current field,
   expose `/family/changes` and `/family/freshness`. Add the measurement counter.
2. **Freshness in consumers**: Ask Keel "as of" dates, `data_confidence` on the
   readiness score, detector opt-in, weekly confirm batch.
3. **Dependency-based recompute** behind a flag, shadowed against the old path,
   then promoted.
4. **Physical-assets depth** (extends PRD-135): document evidence for property,
   vehicle, and valuables with typed extraction and freshness classes.
5. *(Optional, demand-driven)* read-only bridge to a household hub the family
   already owns. Not planned unless users ask.

## Risks

- **Nagging.** Too many "confirm" prompts hurt activation. Mitigation: cap per
  week, only high-impact fields, user can snooze (reuse feed mutes).
- **Backfill honesty.** Existing values have unknown true age. Mitigation:
  backfill with `last_confirmed_at = profile updated_at` and mark `source=import`,
  so they start partly stale instead of falsely fresh.
- **Projection drift.** Mitigated by rebuild job and the replay property test.
- **Double bookkeeping.** Two writers (document + ledger) can disagree.
  Mitigated by one write helper that owns both; routes may not write either
  directly after Phase 1.

## Open questions

1. Retention and deletion: life of account, or a fixed window? (GDPR erasure
   must also cover ledger `before`/`after` values.)
2. Are the placeholder TTLs and the 0.5 floor sensible? Needs a few real
   families' data, de-identified, before promoting beyond shadow.
3. Do we expose the ledger to users as a visible "history" screen, or keep it
   operator/replay only at first? (Visible history aids trust but widens the
   privacy surface.)
4. Transactions: is production MongoDB a replica set (needed for the
   single-transaction path), or do we ship the ledger-first fallback only?

## Sources

- Event-triggered / pull-on-discrepancy synchronisation: <https://arxiv.org/pdf/2606.28384>,
  <https://www.sciencedirect.com/science/article/pii/S0167739X25003619>
- State estimation and partial observability: <https://doi.org/10.3390/automation7030077>,
  <https://www.tandfonline.com/doi/full/10.1080/24725854.2023.2253869>
- Grounding and early rejection in smart-home agents: <https://arxiv.org/pdf/2311.00772>,
  <https://arxiv.org/pdf/2603.16207>, <https://arxiv.org/pdf/2604.08033>
- On-device models for home assistants: <https://arxiv.org/pdf/2502.12923>
- Twin state in a knowledge graph with agent-driven updates: <https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12365160/>

Most sources were read as abstracts/snippets only, and none concerns a family
twin; treat them as motivation, not validation.

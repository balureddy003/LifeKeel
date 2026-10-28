# PRD-222: Stage 1 — The household brief (three problems, one solver, send, opened-at)

> **Status: buildable.** This is the only PRD in the 222–226 set cleared for
> implementation. PRD-223 is gated on this PRD's kill/proceed metrics; PRDs
> 224–225 and the GridFS cutover (PRD-226 change 1) are parked. Infra work
> allowed alongside: PRD-226 changes 2 and 4 only.

## Problem

The market is crowded with storage vaults (SafeKeep, Biscuit Tin, Capsafa,
SuccessionKeeper, Lyfeguard, Safe4) and advice/distribution platforms
(Alltoogether, Bippit, Perkbox, Policygenius, Origin), and empty of a **shared,
computed brief for a real household problem**. The FCA's Pure Protection Market
Study final report (21 September 2026) confirmed that 58% of adults hold no
life, critical-illness, or income-protection product, and 59% of that group have
never considered it — the gap is awareness and household prompts, not a shortage
of products to sell.

Meanwhile, LifeKeel's public landing page (`HomeExperience.tsx`, `SampleDay.tsx`,
`PlusSpotlight.tsx`, `Pricing.tsx`) still leads with *"Your family's chart, kept
current"*, a made-up sample family (`SAMPLE_FAMILY`), and Keel Plus sold as AI
document reading (`"Skip the retyping"`), while the signed-in home page drops
new users into a multi-step wizard and composite score dashboard. A real couple
cannot sit down in one evening, answer one specific upcoming problem with a
number both adults have seen, and leave without a product recommendation.

## Who it's for

A couple (or two-adult household) facing one of three immediate questions in a
single evening, where both adults need to see the same computed months and know
the other adult has opened it.

## What "done" looks like

1. **Three problems only (Stage 1 scope):**
   - `income_stops` — *"One of us might stop earning"* (select earner; enter
     take-home income, monthly household essentials, liquid savings, and any
     recorded income-protection or life cover on file).
   - `earning_less` — *"Someone is about to earn less"* (enter current income,
     new lower income, months until the change takes effect, monthly essentials,
     and liquid savings).
   - `handover_gap` — *"The other adult does not know"* (compute household
     runway months plus the essential handover items from `emergency-sheet.ts`:
     who to call, where key papers are, accounts and policies on file).
2. **One engine, brief hot path (`POST /family/briefs`, `GET /family/briefs/:id`):**
   - Loads only the fields required by that problem (no full-profile load, no
     9-detector sweep, **zero LLM calls**).
   - Calls the deterministic solver (`apps/api/src/scenarios/calculate.ts`,
     extended to include recorded `income_protection_monthly_minor` and its
     `deferred_period` on `income_stops`) once, and renders a deterministic
     template sentence directly from the solver payload.
   - **The brief route never calls a model.** It persists a `household_briefs`
     row containing:
     `{ id, tenant_id, problem_type, inputs, result, template_sentence, narrated_sentence: null, solver_version, data_version, stale: false, share_token_hash, sent_at, opened_at, created_by, created_at }`.
   - **Optional governed narration (`brief.narrate`):** if a rephrased narration
     is requested on a separate optional path, it runs as a single governed call
     (`authority: language_only`), passes a **server-side numeral-presence
     output guard** (every numeral in the LLM output must exist in `result`;
     otherwise it is rejected and falls back to `template_sentence`), and caches
     `narrated_sentence` keyed by `solver_version + data_version`. The same
     Intent 65 numeral-presence test covers the **template generator itself** —
     every numeral `template_sentence` renders must come from `result`, with no
     hard-coded figures.
3. **Send + confirmed-open (`GET /b/:token` + `POST /b/:token/confirm`):**
   - Sharing a brief returns a revocable, unguessable share link scoped to a
     named roster member (raw 24-byte hex token in the URL, SHA-256 hash stored
     on `household_briefs.share_token_hash` alongside `share.for_member_id`,
     mirroring `family-join.ts`'s `inviteTokenHash`). Token carries
     `expires_at` (default 30 days, re-issuable).
   - **Two timestamps, two different meanings:**
     - `link_fetched_at` — stamped on the first GET of the result endpoint.
       Link unfurlers (WhatsApp, iMessage) and mail scanners will set this, so
       it is **telemetry only** and explicitly does NOT mean the other adult
       has seen the figure. Never displayed as "opened".
     - `confirmed_opened_at` — stamped by `POST /b/:token/confirm` only after an
       explicit client action on the share page ("I'm {member name} — view the
       numbers"). The product promise ("has the other adult seen it?") uses
       this timestamp. A confirm from the creator's session is recorded but
       excluded from the success metric.
   - **Caching and revocation:** the `/b/[token]` page shell is a static,
     cacheable Firebase page; the result endpoint is
     `Cache-Control: private, no-store` — "public, cacheable" never applies to
     the financial payload. Revoked (`POST /family/briefs/:id/revoke`) → `410
     Gone`; expired token → `404` + an expired-link page offering to ask the
     sender for a fresh link.
   - Both adults see the exact same runway months, and the creator sees
     `"Opened by {member name} on [timestamp]"` sourced from
     `confirmed_opened_at` — with honest framing ("opened the brief", never
     "understood it").
4. **First brief free — one brief per household, not three:**
   - Every household gets exactly **one free brief total** (compute, save,
     share link, and confirmed-open receipt), whichever of the three problems
     they pick — the three problems are alternatives for the first brief, not
     three free briefs. Zero model calls and zero document uploads.
   - Creating any second brief is the paywall moment (`household_record`
     annual entitlement, PRD-223) — and is the likely drop-off point of the
     whole funnel, instrumented as `brief_gate_hit` /
     `brief_gate_converted`.
5. **Landing and upgrade cuts (enforced by tests):**
   - Remove the harbour chart hero (`HarbourChart.tsx`, `YearsTimelapse.tsx`,
     `"Your family's chart, kept current"`).
   - Remove the made-up sample family (`SampleDay.tsx`, `SAMPLE_FAMILY`).
   - Remove selling Keel Plus as AI document reading (`PlusSpotlight.tsx` and
     the `"The only paid plan adds AI document reading"` copy in `Pricing.tsx`).
   - Every rendered numeral on the brief and shared brief page must exist in the
     cached `result` payload (Intent 65 numeral-presence invariant).

## Constraints

- **Trust tier:** 0. Pure deterministic math, tenant-scoped storage, user-copied
  share link, and anonymous `opened_at` timestamp. Nothing is sent or executed
  externally on the family's behalf (`CLAUDE.md` Rule 1).
- **Regulated-advice check:** the brief states only what the household entered
  and the resulting runway months; it never recommends a policy, insurer, or
  product switch, and points to "a licensed professional" / "compare quotes from
  multiple insurers" where cover gaps appear (`CLAUDE.md` Rule 2).
- **Data/privacy:** zero hosted or local LLM calls on the first brief path
  (`CLAUDE.md` Rule 3). Share links are `noindex`, `Referrer-Policy: no-referrer`,
  rate-limited, and revocable (`POST /family/briefs/:id/revoke`).

## Out of scope

Stage 2 problem packs (PRD-223), open-banking and pension feeds (PRD-224),
third-party read grants and adviser fact-find exports (PRD-225), and AI OCR on
the first-brief path.

## Builds on

`apps/api/src/scenarios/calculate.ts` (PRD-115, PRD-132),
`apps/api/src/routes/emergency-sheet.ts` (PRD-220),
`apps/api/src/routes/family-join.ts` (Intent 63 `viewed_at` pattern),
Intent 65 (`numeral-presence-test`), Intent 70, Intent 75.

## Success metrics — product hypotheses first, not delivery latency

Instrumented funnel (events on `growth_events` / audit, content-free enums
only): `brief_created` → `brief_share_link_generated` → `brief_link_fetched`
(telemetry only — scanners set this) → `brief_confirmed_open` (explicit
"view the numbers" action by the intended member; the creator's own confirm is
recorded but excluded).

**The product hypotheses this PRD must measure (thresholds are hypotheses to
set at launch, not benchmarks):**

- **Confirmed-open rate:** share of created briefs with `confirmed_opened_at`
  by the intended second adult within 7 days. Target ~40%+.
- **Return rate:** share of households that return and create a second brief
  (or hit the second-brief gate) within 30 days.
- **Second-brief gate conversion:** share hitting the paywall who convert —
  this is the likely drop-off point of the whole funnel and is the number
  Stage 2 pricing hangs on.

**Kill/proceed criteria (decide X/Y at launch, keep these semantics):**

- If fewer than ~30% of created briefs are confirmed-opened by the intended
  second adult within 7 days → fix the share flow before building anything
  else; the "both adults saw the number" promise is the product.
- If fewer than ~15% of opened households return for a second brief within 30
  days → do not proceed to Stage 2 (PRD-223); the packs have no distribution.
- Stage 3+4 stay parked until those numbers exist.

Operational floor (not a product test): p95 brief compute latency < 150 ms;
zero LLM calls on the first brief path.

**Acceptance criteria additions:**

- All new brief templates, pack copy, and share-page strings added to the copy
  set in `packages/engine/src/__tests__/advice-rule.test.ts` and pass it.
- The pre-existing `advice-rule.test.ts` failure on `HomePricing.tsx`
  ("Scroll across to compare both plans") is resolved by this PRD's landing
  rewrite removing that surface — not waived, fixed by deletion.
- `confirmed_opened_at` cannot be set by a plain GET (an integration test
  asserts a scanner-style fetch leaves it null).

**Template numeral invariant:** `template_sentence` is generated only from
fields in the solver `result` payload — no hard-coded example numbers, same
invariant Intent 65's numeral-presence test already enforces on scenario
narration. The shared page renders `template_sentence` (or the guarded
`narrated_sentence`) verbatim; a numeral not in `result` cannot appear.

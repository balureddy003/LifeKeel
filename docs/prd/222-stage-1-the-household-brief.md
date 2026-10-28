# PRD-222: Stage 1 — The household brief (three problems, one solver, send, opened-at)

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
3. **Send + `opened_at` (`GET /b/:token` / `GET /family/briefs/shared/:token`):**
   - Creating or sharing a brief returns a revocable, unguessable share link
     (raw 24-byte hex token in the URL, SHA-256 hash stored on
     `household_briefs.share_token_hash`, mirroring `family-join.ts`'s
     `inviteTokenHash`).
   - When the second adult opens the public cacheable page (`/b/[token]`), the
     API returns the cached brief payload (`result`, `solver_version`,
     `data_version`, `opened_at`) without recomputing and atomically stamps
     `opened_at` on first open (`$set` when `opened_at` is null).
   - Both adults see the exact same runway months, and the creator sees
     `"Opened [timestamp]"` on their brief card.
4. **First brief free:**
   - Every household gets their **first brief free** (compute, save, share link,
     and `opened_at` receipt) with zero model calls and zero document uploads.
   - Creating a second brief or unlocking Stage 2 problem packs / ongoing record
     maintenance is gated on the annual household plan (~£59/year, PRD-223).
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

## Success metrics

Instrumented funnel (events on `growth_events` / audit, content-free enums
only): `brief_created` → `brief_share_link_generated` → `brief_opened`, where
`brief_opened` counts only when `opened_at` is stamped by a **second, distinct
roster member** (`opener_member_id != created_by` — the creator opening their
own link is instrumented but excluded from the success definition). Both adults
render `runway_months` from the same stored `result` payload, so "both see the
same months" is true by construction and verified by asserting the shared page
reads `result` verbatim. Success = `brief_opened` within 24h of `brief_created`
on a two-adult household; zero LLM calls on the first brief path; p95 brief
compute latency < 150 ms.

**Template numeral invariant:** `template_sentence` is generated only from
fields in the solver `result` payload — no hard-coded example numbers, same
invariant Intent 65's numeral-presence test already enforces on scenario
narration. The shared page renders `template_sentence` (or the guarded
`narrated_sentence`) verbatim; a numeral not in `result` cannot appear.

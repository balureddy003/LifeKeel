# PRD-221: Marketing learner (shadow-first) and the weekly brief

**Status: gated — do not start until ~500 site visits a month and at least 40
tagged posts exist.** Before that, any "learning" is noise. PRDs 218 and 219
must be merged and collecting data.

## Problem

After PRD-218/219 the engine records which format, hook, pillar, channel and
time each post used and how many visits and signups it earned — but a human
has to read the table and decide what to do next. The engine should adapt its
drafting itself, safely, after a shadow period, with every change visible and
revocable, plus a short weekly report of what worked and what it needs.

## Who it's for

The operator (fewer manual decisions, with evidence); the marketing engine
(it learns from its own results under guardrails).

## What "done" looks like

1. **Allocation learner (allocation only).** For each weekly-plan slot the
   learner proposes `format`, `hook`, `pillar` and time bucket from suitable
   options, using Thompson sampling with weak priors per dimension and a
   fixed **30% exploration floor** (30% of slots chosen uniformly among
   suitable options regardless of data). Reward = signups attributed to the
   post's tag within 14 days; when signups across the window are zero,
   reward = visits within 7 days. Minimum-sample gates: a dimension value
   needs >= 8 posts before it can be favoured; below that it is explored
   only. It **never** changes wording rules, the copy guard, the claims
   registry, active channels, or what is approved.
2. **Shadow first** (reuse the merged shadow-mode framework, intent 12 —
   `AutopilotMode`, shadow rows, `shadowStats`, verdicts in
   `operator/autopilot.ts`). For at least 4 weeks the learner logs the mix it
   *would* choose beside the rotation actually used, with realised results,
   and changes nothing. One Mission Control item when the shadow period has
   evidence: "Let Keel choose formats from results?", with the summary.
3. **Promotion gate.** Live allocation requires a recorded operator decision
   with reviewed evidence (the autopilot rule-promotion pattern): minimum 4
   weeks shadow, shadow-mix reward not worse than the used mix at the stated
   interval, owner approves. After promotion every plan still needs the
   approve-the-week click — nothing publishes unreviewed.
4. **Learning ledger** `marketing_learnings`: `{id, claim, dimension, value,
   evidence: {n, visits, signups}, interval, confidence, status:
   'active'|'vetoed'|'expired', created_at}` — each row a plain-language
   sentence. **One-click veto** per row; a vetoed value is excluded from
   favouring and returns to exploration. Rows expire after 90 days unless
   refreshed. The collection is tenant-keyed, so it goes in
   `DELETABLE_COLLECTIONS` (plus an `ERASURE_CATEGORY` label), not the
   exempt list.
5. **Weekly brief** (deterministic report; optional model narration of
   aggregates through a registered gateway task): what worked with ranges,
   what is being tested next week, what Keel needs from you ("approve next
   week", "reconnect LinkedIn"), one line from the distribution playbook
   table. Surfaces as a Mission Control item and a Plan-tab section; no
   email. "Not enough data" instead of ranking tiny samples.
6. **Auto-revert.** Two consecutive live weeks below the pre-promotion
   baseline by more than the interval returns allocation to rotation and
   raises a Mission Control alert explaining why.

## Constraints

- **Trust tier:** 0/1 for choosing drafts; publishing stays Tier 2 (human
  approval of exact text). The learner is added to `autopilot` rules only as
  a shadow-capable, never-publishing rule; `NEVER_AUTONOMOUS` unchanged; the
  trust-tier gate test gets no new executor caller.
- **Regulated-advice check:** the learner selects among already-guarded
  formats and facts; it cannot author copy. Optional narration describes
  aggregates only and passes `checkCopy`.
- **Data/privacy:** inputs are post features and anonymous aggregate counts —
  no user, family or lead records are read (a test asserts it via a fake db).
  Rule 3 holds: this is a statistics routine in our code, nothing trains a
  model. The narration task, if added, is registered in
  `definitions/ai-tasks.yaml` with public inputs.

## Out of scope

Model-invented topics or briefs, changing claims, auto-approval, contextual
bandits on user attributes, paid-ad optimisation, cross-product learning, a
Learning tab (the ledger lives in the brief), Search Console/GA4.

## Builds on

PRD-218 (tags + weekly table), PRD-219 (formats), intent 12 (shadow mode).
Build spec: `docs/intents/19-learner-and-weekly-brief.md`.

## Success metrics

Seeded fixture of 60 tagged posts: the shadow log prefers known winners, the
floor keeps ~30% of slots exploring, promotion/revert/veto behave under test,
and the brief reads correctly on small samples.

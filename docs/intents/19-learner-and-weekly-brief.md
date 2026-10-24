# Intent 19: Learner (shadow) and the weekly brief

**Status: do not start until about 500 site visits a month and at least 40 tagged posts exist.**
Before that, any "learning" is noise. Intents 15 and 16 must be merged and collecting data.

**Problem** — After intents 15 and 16 the engine records which format, hook, pillar, channel and
time each post used and how many visits and signups it earned, but a human has to read the table
and decide what to do next. The owner wants the engine to adapt its drafting itself, safely, after
a shadow period, with every change visible and revocable, and a short weekly report of what worked
and what it needs.

**Done looks like**
1. **Allocation learner (allocation only).** For each slot in the weekly plan the learner proposes
   the `format`, `hook`, `pillar` and time bucket from the suitable options, using Thompson
   sampling with weak priors per dimension and a fixed **30% exploration floor** (30% of slots are
   chosen uniformly among suitable options regardless of the data). Reward = signups attributed to
   the post's tag within 14 days; when signups across the window are zero, reward = visits within
   7 days. Minimum-sample gates: a dimension value needs >= 8 posts before it can be favoured; below
   that it is explored only. It **never** changes wording rules, the copy guard, the claims
   registry, which channels are active, or what is approved.
2. **Shadow first (reuse the merged shadow-mode framework, intent 12).** For at least 4 weeks the
   learner logs the mix it *would* choose beside the mix actually used (rotation from intent 16),
   with the realised results of each, and does not change the plan. The Mission Control decision
   queue gets one item when the shadow period has enough evidence: "Let Keel choose formats from
   results?", with the evidence summary.
3. **Promotion gate.** Promotion to live allocation is a recorded operator decision with reviewed
   evidence (same pattern as autopilot rule promotion): minimum 4 weeks shadow, shadow-mix reward
   not worse than the used mix at the stated interval, owner approves. After promotion every plan
   still needs the existing approve-the-week click; nothing publishes unreviewed.
4. **Learning ledger** `marketing_learnings`: `{id, claim, dimension, value, evidence: {n, visits,
   signups}, interval, confidence, status: 'active'|'vetoed'|'expired', created_at}`. Each row is a
   plain-language sentence ("Myth-vs-file posts earned 2.1x the visits of other formats, 14 posts,
   low confidence"). **One-click veto** per row; a vetoed value is excluded from favouring and
   returns to exploration. Rows expire after 90 days unless refreshed.
5. **Weekly brief** (deterministic report, optional model narration of aggregates through the
   gateway): what worked with ranges, what is being tested next week, what Keel needs from you
   (for example "approve next week", "reconnect LinkedIn"), and one line from the distribution
   playbook table (intent 18). Appears as a Mission Control item and a section on the Plan tab; no
   email. Says "not enough data" rather than ranking tiny samples.
6. **Auto-revert.** If two consecutive live weeks score below the pre-promotion baseline by more
   than the interval, allocation returns to rotation and a Mission Control alert explains why.

**Constraints**
- Trust tier: 0/1 for choosing drafts; publishing is still Tier 2 (human approval of exact text).
  The learner is added to `autopilot` rules only as a **shadow-capable, never-publishing** rule;
  `NEVER_AUTONOMOUS` is unchanged. The trust-tier gate test allow-list gets no new executor caller.
- Regulated-advice check: the learner selects among already-guarded formats and facts; it cannot
  author copy. The optional narration describes aggregates only and passes `checkCopy`.
- Data/privacy: inputs are post features and anonymous aggregate counts. No user, family or lead
  records are read. Rule 3 holds: nothing trains a model; this is a statistics routine in our code.
  The narration task, if added, is registered in `definitions/ai-tasks.yaml` with public inputs.

**Out of scope** — new topics or briefs invented by a model, changing claims, auto-approval,
contextual bandits on user attributes, paid-ad optimisation, cross-product learning, a Learning
tab (the ledger is a section of the brief), Search Console/GA4.

**Becomes** — docs/prd/221-marketing-learner.md

---

## Build spec

**Files likely touched**
- `apps/api/src/marketing/learner.ts`: pure functions `thompsonPick`, `rewardFor`, `buildLedger`
  with injectable random source and clock so tests are deterministic.
- `apps/api/src/marketing/content-plan.ts`: `planWeek` asks the learner for allocation when mode is
  `live`; in `shadow` it records the proposal only.
- `apps/api/src/operator/autopilot.ts` and the shadow framework: register `marketing.allocation`
  as shadow-capable; ensure it is not in any publish path.
- `apps/api/src/operator/mission-control.ts`: promotion decision and weekly-brief items.
- `apps/api/src/routes/marketing-learning.ts`: list ledger, veto, promote, demote
  (`marketing.manage`, audited, dual-control not required but reason required).
- `apps/web`: a "Weekly brief" section in the Plan tab and veto buttons (`ReasonAction`).
- `apps/api/src/db.ts`: indexes for `marketing_learnings`; erasure catalogue: the collection is
  tenant-keyed, so it goes in `DELETABLE_COLLECTIONS` in `apps/api/src/erasure.ts` (plus a
  `ERASURE_CATEGORY` label). (`EXEMPT_COLLECTIONS` — for tenant-free platform data — lives in
  `apps/api/src/__tests__/architecture-claims.test.ts`, not erasure.ts; only use it if the ledger
  is deliberately stored without tenant_id.)

**Tests (each must fail without the change)**
- Exploration floor: over 10,000 simulated draws with a dominant option, at least ~30% of picks are
  non-dominant; with a seeded RNG the result is reproducible.
- Sample gates: a value with 7 posts is never favoured; with 8 and a clear advantage it is.
- Reward: signups preferred over visits; falls back to visits only when the window has zero signups.
- Shadow: in shadow mode the plan used is the rotation, the proposal is logged, nothing changes.
- Promotion: cannot promote without a recorded decision, minimum shadow weeks, and evidence;
  `NEVER_AUTONOMOUS` still blocks publish; trust-tier gate test unchanged and green.
- Veto: a vetoed value is never favoured; vetoes are audited.
- Auto-revert triggers after two bad weeks and writes an alert.
- Brief: deterministic content from fixtures; small samples read "not enough data"; narration (if
  present) passes `checkCopy` and sees only aggregates.
- Learner reads no user/lead collections (assert via a fake db that throws on those collections).

**Verification** — seeded fixture of 60 tagged posts with known winners: confirm the shadow log
prefers the winners, the floor keeps exploring, the brief reads correctly, and promotion and
revert behave. Isolated stack, `dry_run_mode: true`.

**Open decisions for the owner** — shadow length (default 4 weeks), exploration floor (default
30%), whether to enable optional narration (default off to keep cost at zero).

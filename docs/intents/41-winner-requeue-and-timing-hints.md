# Intent 41: winner requeue + posting-time hints

**Problem** — two cheap signals already collected by intent 15 are unused:
(1) winners sit in the table but can't be re-run — a strong post is a one-shot
asset; (2) `hour_bucket` stats accumulate but nothing surfaces "Tuesday
morning outperforms" to the planner.

**Done looks like**
- "Requeue" action on a Posts-table row creates a **new draft** (fresh
  `post_tag`, new `content_hash`) from the same brief/format — never reuses
  the old tag so attribution stays honest — and still requires the normal
  approve-the-week gate before publishing.
- Plan tab shows a timing hint when any `hour_bucket` group has ≥5 tagged
  posts: "morning posts average X visits vs afternoon Y" — informational
  line, no auto-scheduling.
- Both reuse `post-stats.ts` groupings; no new collections.
- Tests: requeue creates draft (state `draft`, new tag, same format/hook);
  hint hidden below the 5-post threshold; approval flow unchanged.

**Constraints**
- Tier 1 — requeue produces a draft only; publishing stays human-approved.
- Advice check — requeued text re-runs `checkCopy` on the new draft.
- Privacy — aggregate stats only.

**Out of scope** — auto-rescheduling, best-time *auto*-assignment (that's the
intent-19 learner's job once it exists).

**Becomes** — PRD-223 once accepted.

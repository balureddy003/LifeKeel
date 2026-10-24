# Intent 45: hook A/B variants in the weekly plan

**Problem** — the plan picks one hook per draft; we never learn which hook
works. Variant drafts (same brief, different hook) give the PRD-221 learner
real priors before it exists.

**Done looks like**
- One slot per week generates a **variant pair**: same brief/format, two
  different hooks, on the same channel — both drafts, both tagged.
- Posts table groups by hook; the variant is visible as a pair in the plan.
- `features.variant_of` links the two posts for reporting.
- Tests: one slot produces two posts differing only in `features.hook` and
  `post_tag`; approve-the-week unchanged.

**Constraints** — Tier 1; both drafts need the human gate.

**Out of scope** — auto-winner selection (learner's job).

**Becomes** — PRD-227.

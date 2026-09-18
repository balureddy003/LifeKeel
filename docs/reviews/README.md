# Reviews

Point-in-time product reviews of Agent Oak, distinct from `docs/prd/`'s
forward-looking requirement briefs: these audit what's actually shipped
against acceptance criteria and the product vision, rather than proposing
new work in PRD format. Findings here that warrant engineering work should
graduate into a numbered PRD under `docs/prd/` rather than being tracked
here indefinitely.

1. [user-journeys-acceptance-criteria-gaps.md](user-journeys-acceptance-criteria-gaps.md) —
   every user-facing journey in `apps/web`, checked against `apps/api`,
   with acceptance criteria / what's implemented / the gap, plus a
   dedicated pass cross-referencing `ARCHITECTURE.md`'s own vision-vs-reality
   table.
2. [product-review-council.md](product-review-council.md) — a deeper,
   multi-persona critique-and-redesign pass (real user, crisis user,
   skeptical critic, competitor, product, UX, UI, QA, AI/agent architect,
   trust & safety, secondary family member, SRE) on the six highest-stakes
   journeys, plus a condensed autonomy-ladder/family-value pass on every
   other journey. Builds on document 1's findings.
3. [remediation-plan.md](remediation-plan.md) — every gap from documents 1
   and 2, sized XS through XL and ordered smallest to largest, with two
   explicit risk-overrides-size call-outs (Emergency Mode routing, the
   Act-layer approval gate). The engineering-facing "what do we actually
   do about this" companion to the first two, which are diagnostic.

All three were produced by a full read of the current codebase (no live
testing), as of 2026-09-18. The remediation plan has since been
implemented end-to-end — every item except #28 (family sharing, XL),
which the plan itself defers to a dedicated PRD. PRD-109 (policy
extraction → profile bridge) had already shipped before the pass — see
`docs/prd/109-*.md`.

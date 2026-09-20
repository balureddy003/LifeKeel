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

4. [competitive-differentiation-deep-dive-2026.md](competitive-differentiation-deep-dive-2026.md) —
   external market research cross-checked against the codebase: two new
   competitive threats (Trustworthy Autopilot, State Farm Household
   Story), six differentiation angles with recommendations, and what's
   durable vs. catching up. Re-verify before citing beyond ~6 months.
5. [mobile-apps-distribution-analysis-2026.md](mobile-apps-distribution-analysis-2026.md) —
   what it takes to offer Agent Oak as native iOS/Android apps alongside
   the web app: how much of "mobile" is already shipped as a PWA, the
   PWA / Capacitor-wrap / RN-rewrite options with real costs, and the
   phased recommendation (ship the PWA deliberately → Capacitor when
   store presence earns it, gated on the IAP billing decision).

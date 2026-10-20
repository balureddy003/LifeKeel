# Reviews

Point-in-time product reviews of LifeKeel, distinct from `docs/prd/`'s
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
   what it takes to offer LifeKeel as native iOS/Android apps alongside
   the web app: how much of "mobile" is already shipped as a PWA, the
   PWA / Capacitor-wrap / RN-rewrite options with real costs, and the
   phased recommendation (ship the PWA deliberately → Capacitor when
   store presence earns it, gated on the IAP billing decision).
6. [vision-vs-implementation-audit-2026-09.md](vision-vs-implementation-audit-2026-09.md) —
   full inventory of every implemented surface mapped against the
   multi-agent vision brief (Keel HQ + member twins, crisis resilience,
   proactive intelligence, vault, ingestion engine). Key correction to
   earlier docs: the Act layer is ahead of what ARCHITECTURE.md claimed —
   approve→execute, earned-trust auto-execution, and opt-in autonomous
   reminders all ship — while the real gaps are member-level reasoning,
   the composite readiness score, time-shifted simulation, and the Action
   Network. Produced 2026-09-28.
7. [market-positioning-october-2026.md](market-positioning-october-2026.md) —
   comprehensive market positioning and competitive landscape analysis
   updating the September deep-dive: maps every competitor category (AI
   financial advisors, family vaults, financial digital twins, insurance
   gap tools, crisis support, UK-specific), identifies LifeOS as the
   closest new direct competitor (£100/mo UK AI family office), and
   recommends positioning LifeKeel as the "family crisis readiness
   platform" in the proactive + protection quadrant. Produced 2026-10-03.
8. [built-vs-market-and-innovation-flywheel-2026-10.md](built-vs-market-and-innovation-flywheel-2026-10.md) —
   bridges document 7's external landscape with document 6's internal
   inventory: scores every positioning claim against what's actually
   built (continuous detection 7/10, whole-family 8/10, proactive 6/10,
   crisis-native 8/10, neutral 9/10), maps 14 gaps by competitive
   impact, designs a 5-stage innovation flywheel (Data Depth → Detection
   Breadth → Insight Value → Trust & Engagement → Growth Loop) with a
   sequenced acceleration plan, competitive response playbook, and a
   full capability-vs-competitor matrix. Produced 2026-10-03.
9. [synthetic-flow-validation-2026-10.md](synthetic-flow-validation-2026-10.md) —
   end-to-end validation of every major product flow against a running
   local stack (API + Web + MongoDB Atlas + Redis Cloud + Azure OpenAI).
   Tests 17 flows via real HTTP requests: readiness quiz, signup, family
   roster, financial profile + detector evaluation (9 insights from 5
   detectors), readiness score, Ask Keel, scenario simulation, life-event
   playbooks, vault, document OCR, insight approval gate, family sharing,
   member twin/agent, assets, cashflow. Finds 4 bugs (persisted scenario
   timeline zeroed, duplicate roster on join-approve, context note not
   serialized, mock data leaking into production via CommandPalette/
   AIAnswerCard/assets-data). Documents missing production configurations
   (Stripe, SendGrid, encryption key). Includes a UX/UI innovation audit
   scoring the frontend against competitors (overall 8/10 — persona-
   adaptive UI, emergency mode, glass design system, and conversational
   onboarding are differentiators; data visualization and visual
   distinctiveness are the biggest gaps). Includes a remediation table
   tracking fixes: join-request roster dedup, mock-data purge, LifeKeel
   branding cleanup, time-based proactive nudges (age milestones +
   policy renewals), adaptive playbook covered-steps, family signal
   schema registration, scenario timeline chart, readiness history
   sparkline, and cashflow visualization. Produced 2026-10-03.
10. [prd-set-market-review-2026-10.md](prd-set-market-review-2026-10.md) —
   four independent research reviews (conversion, retention, competitive,
   trust and regulatory) of PRDs 138-147 and 203-206, synthesised, with
   the code claims re-checked by hand, an evidence-quality statement, the
   decisions left for the product owner, and stale claims in the market
   documents. Produced 2026-10-18.
11. [market-strategy-and-vision-2026-2029.md](market-strategy-and-vision-2026-2029.md) —
   recommended market position and two-year strategy, with a conditional 2029
   horizon: target customer, family handover proposition, competitive evidence,
   pricing/channel experiments, architecture priorities and measurable decision
   gates. Corrects earlier claims about competitor gaps, Open Finance access,
   Product Hunt evidence and patentability. Strategy for review, not an approved
   implementation plan. Produced 2026-10-20.
12. [proprietary-mechanisms-and-future-architecture-2026-10.md](proprietary-mechanisms-and-future-architecture-2026-10.md) —
   the ownable-mechanism review: seven named candidate algorithms/patterns
   (LifeGraph evidence DAG, Disclosure Lattice, Proof-of-Handover, Drift
   Sentinels, Earned-Scope Contracts, Readiness Calculus, Receipt Chain) scored
   for defensibility, rule fit, prior-art risk and effort, with the exact
   ARCHITECTURE.md changes a follow-up PR would make. Produced 2026-10-20.
13. [llm-usage-patterns-low-cost-and-private-2026-10.md](llm-usage-patterns-low-cost-and-private-2026-10.md) —
   eight named patterns for cheaper, non-training LLM usage (LLM-as-Compiler,
   Compiled Context, Constrained Narration, classification-before-generation,
   synthetic-first distillation, construction-level privacy, batch economics,
   cost-per-correct-result metric), extending the open-model strategy doc.
   Produced 2026-10-20.
14. [mechanism-foundations-research-2026-10.md](mechanism-foundations-research-2026-10.md) —
   scientific lineage and prior-art analysis for every proposed mechanism:
   TMS/DCLabels/CUSUM/conformal/LOA-trust/UCAN/PROV foundations, deployed
   neighbors, and the defensible deltas — including a critical find that a
   TDCommons defensive publication forecloses the receipt-chain patent, and a
   system-level composition claim (LifeGraph + lattice + earned scope) as the
   strongest filing candidate. Produced 2026-10-20.
15. [cascade-framework-2026-10.md](cascade-framework-2026-10.md) — packages the
   governed-inference discipline into a named, reusable framework ("Cascade"):
   five contracts (task policy, context compiler, escalation ladder, validation
   gates, promotion/economics loop), what's built vs. missing, internal reuse
   paths, and the publish-vs-protect boundary for telling the world how to use
   LLMs at least cost. Produced 2026-10-20.
16. [device-first-ai-foundation-2026-10.md](device-first-ai-foundation-2026-10.md) —
   the device-first posture proposal: verified 2026 on-device landscape (Apple
   Foundation Models, Chrome built-in AI/Gemini Nano, WebLLM), reordered ladder
   with device as default executor, on-device-minimization-as-a-service pattern,
   task-eligibility matrix, accuracy-engineering program, and honest limits
   (device SLMs are *not* more accurate — scope-narrowing is the unlock).
   Produced 2026-10-20.
17. [device-first-grounded-blueprint-2026-10.md](device-first-grounded-blueprint-2026-10.md) —
   deep engineering blueprint grounding the device-first patterns in 2025–2026
   research and LifeKeel's codebase: 3-tier native/browser/WebGPU runtime probe
   (Apple Foundation Models, Android AICore Gemini Nano, Chrome Prompt API,
   WebLLM + XGrammar), isomorphic client guards closing the `onDeviceLlm.ts`
   validation gap, reversible on-device PII redaction ("Curtain Protocol"),
   on-device Art. 9 medical text quarantine, and a 4-slice build plan.
   Produced 2026-10-20.

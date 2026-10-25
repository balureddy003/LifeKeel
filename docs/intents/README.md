# Intents

Intents are the lightweight precursors to PRDs, per `docs/templates/intent.md`
and CONTRIBUTING.md's loop. Each file here is a stub for one Stage A item in
[docs/reviews/architecture-remediation-plan-2026-10.md](../reviews/architecture-remediation-plan-2026-10.md)
(the gap-execution plan); when accepted, it becomes a numbered PRD in
`docs/prd/` or an amendment to an existing one.

| File | Stage A item | Overlaps existing PRD |
|---|---|---|
| `00-architecture-claims-fitness-tests.md` | Stage 0 conformance machinery | — |
| `01-mandatory-ai-task-gateway.md` | A1 AI gateway enforcement | PRD-142 (registry spec) |
| `02-signed-link-approval.md` | A2 signed-link strengthening | — |
| `03-unified-publish-policy.md` | A3 publish-policy conflict | — |
| `04-erasure-and-backup-reconciliation.md` | A4/A5 erasure + backup↔erasure | PRD-146 (deletion receipts) |
| `05-backup-restore-baseline.md` | A6 restore drill | — |
| `06-federated-warmstart-and-eval.md` | A7 rule-3 violation fix | — |
| `07-durable-required-queue.md` | A8 queue durability | — |
| `08-migration-deploy-gate.md` | A8 migration gate | — |
| `09-childrens-data-posture.md` | A9 children's data | — |
| `10-claim-drift-remediation.md` | A10 drift fixes | mostly fast-path PRs |
| `11-device-runtime-verification-and-eval-harness.md` | Device-first §8.4a — weakest-runtime eval gate | — |
| `12-mission-control-and-shadow-mode.md` | Operator autonomy slice 1 — decision queue + shadow-mode rules | — |
| `13-marketing-intelligence-revenue-and-attribution.md` | Marketing intelligence slice 1 — revenue truth, attribution, channel economics | PRD-210 |
| `14-social-autopilot.md` | Social platforms — one channel registry, weekly plan for every platform, connection health, profile freshness | PRD-210 |
| `15-per-post-tagging-and-weekly-table.md` | Marketing engine step 2 — post tag, features, visits-per-post table | PRD-210 |
| `16-minimal-content-studio.md` | Marketing engine step 3 — three formats in YAML, brand cards | PRD-210 |
| `17-invite-and-share-loop.md` | Marketing engine step 4 — partner invite prompt, emergency sheet, referral | PRD-110, PRD-112 |
| `18-distribution-playbook.md` | Marketing engine step 5 — founder-run distribution plan | — |
| `19-learner-and-weekly-brief.md` | Marketing engine step 6 — shadow learner and weekly brief (gated on traffic) | PRD-210 |

Shared build context for 15 to 19: [marketing-engine-build-notes.md](marketing-engine-build-notes.md).

Intents 20–39 are sequenced into an implementation order in
[docs/reviews/product-roadmap-2026-10.md](../reviews/product-roadmap-2026-10.md).

## 20–33: 2026-10-24 QA + critic review triage

Stubs from the combined automated-QA and critic/product review
([qa-critic-review-2026-10-24.md](../reviews/qa-critic-review-2026-10-24.md)).
Ordered roughly by that review's own priority (score trust → scenario
reliability → second-adult engagement → everything else); 29–31 are
reliability/verification items rather than features, and 33 is flagged
longer-term.

| File | Concern | Overlaps existing PRD |
|---|---|---|
| `20-readiness-score-calibration-and-explainability.md` | Score feels harsh; expose the 5 components + recalibrate against personas | PRD-114, PRD-118 |
| `21-scenario-partial-data-honesty.md` | Silent fallbacks — **implemented, PR #247** (`missing_inputs` + partial-data banner) | PRD-115, PRD-132 |
| `22-derived-surface-freshness.md` | Stale figures in insights/AI Explains after profile edits | PRD-107 |
| `23-invite-status-and-second-adult-engagement.md` | "Not joined yet" opacity; copy link / resend / seen state | PRD-110, PRD-123 |
| `24-insight-severity-signaling.md` | Severity signalling — **implemented, PR #251** (accent band + high-priority chip; sort open) | — |
| `25-blended-family-member-labels.md` | Step-/shared-child distinction on the roster and chart | PRD-001 |
| `26-variable-income-capture.md` | Second-earner prominence + income notes for irregular earners | PRD-104, PRD-131 |
| `27-document-upload-feedback-loop.md` | Upload progress, stored confirmation, honest Plus gate | PRD-003 (extraction stays PRD-143) |
| `28-profile-wizard-validation-and-prefill.md` | Inline validation on blur; saved fields pre-fill on return | PRD-002 |
| `29-signup-otp-reliability.md` | Intermittent OTP; example.com addresses fail (reproduce first) | — |
| `30-ask-keel-answer-freshness.md` | Previous-answer bleed — **implemented — PR #245** (`data_as_of` stamp; upstream staleness → intent 22) | PRD-211, PRD-212 |
| `31-billing-unlock-verification.md` | Sandbox checkout → webhook → Plus unlock never verified e2e | PRD-006 |
| `32-retirement-gap-closure-estimate.md` | "What would close the gap" slider, estimate-labelled, advice-rule-safe | PRD-106 territory |
| `33-crisis-mode-simplified-view.md` | Crisis mode: top-3 next actions + runway + key documents | PRD-108 |

## 34–37: multi-device easiness pass

From the 390/768/1440px viewport pass in the same review doc. 34 is a
suspected bug (reproduce first); 36 is an audit before fixes.

| File | Concern | Overlaps existing PRD |
|---|---|---|
| `34-post-login-routing-state-fragility.md` | ~~"Create Family Group" shown to accounts that have a family~~ **implemented — PR #243** | — |
| `35-mobile-navigation-and-tablet-layout.md` | Nav density at 390px; tablet width unused | — |
| `36-accessibility-baseline-audit.md` | Keyboard order, focus, contrast, labels unconfirmed | — |
| `37-interruptible-setup-and-cross-device-continuity.md` | Autosave per step, "Continue setup", numeric input modes, resume on another device | lands with intent 28 |
| `38-renewal-price-creep-tracking.md` | Premium history + alert on recorded premium increase — informational only (rule 2 edge) | detectors/policy-review.yaml; PRD-143 for capture |
| `39-subscription-packaging-and-conversion-moments.md` | Annual plan frame, post-upload paywall moment, explicit free/Plus line | PRD-006, PRD-206 |

## 40–42: marketing amplification (Buffer/Postiz-inspired, post-15/16)

| File | Concern | Overlaps existing PRD |
|---|---|---|
| `40-short-link-click-tracking.md` | `/go/:tag` redirect counts clicks even when landing-page JS doesn't fire | extends PRD-218 |
| `41-winner-requeue-and-timing-hints.md` | requeue winners as new drafts; hour_bucket hints on Plan tab | extends PRD-218; auto-timing stays with PRD-221 |
| `42-per-channel-variants-and-card-gallery.md` | side-by-side per-channel edits + card grid | extends PRD-219 |

## 43–45: content innovation pass

| File | Concern | Overlaps |
|---|---|---|
| `43-stat-of-week-cards.md` | sourced stats as branded cards via existing pipeline | PRD-219 |
| `44-guide-revival.md` | re-promote top-visited guides monthly with new tag | extends PRD-218 |
| `45-hook-ab-variants.md` | one weekly slot emits a hook-variant pair | feeds PRD-221 priors |
| `46-standing-approvals.md` | autonomous marketing engine with a human gate: content bank, policy, scheduler, breakers | amends intent 03 |
| `47-search-console-and-ga4-readback.md` | read-only Search Console and GA4 read-back, a Search panel, topic suggestions from real queries | extends PRD-210 |

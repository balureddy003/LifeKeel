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
| `20-readiness-score-calibration-and-explainability.md` | Score explainability — **implemented, PR #246** (expander + persona-band pins) | PRD-114, PRD-118 |
| `21-scenario-partial-data-honesty.md` | Silent fallbacks — **implemented, PR #247** (`missing_inputs` + partial-data banner) | PRD-115, PRD-132 |
| `22-derived-surface-freshness.md` | Stale insight figures — **implemented, PR #248** (open-insight refresh on re-fire) | PRD-107 |
| `23-invite-status-and-second-adult-engagement.md` | Invite status — **partial, PR #250** (share link + "sent" status; viewed tracking open) | PRD-110, PRD-123 |
| `24-insight-severity-signaling.md` | Severity signalling — **implemented, PR #251** (accent band + high-priority chip; sort open) | — |
| `25-blended-family-member-labels.md` | Child relationship labels — **implemented, PR #252** (roster + add form; chart surface open) | PRD-001 |
| `26-variable-income-capture.md` | Income notes — **implemented, PR #253** (`income_notes` field + Ask Keel grounding) | PRD-104, PRD-131 |
| `27-document-upload-feedback-loop.md` | Upload feedback — **partial, PR #249** (progress bar; renewal-date field open) | PRD-003 (extraction stays PRD-143) |
| `28-profile-wizard-validation-and-prefill.md` | Wizard validation — **implemented, PR #254** (blur-level errors; prefill/autosave already shipped) | PRD-002 |
| `29-signup-otp-reliability.md` | Intermittent OTP; example.com addresses fail — **partially implemented — PR #244** (test path shipped; live repro open) | — |
| `30-ask-keel-answer-freshness.md` | Previous-answer bleed — **implemented — PR #245** (`data_as_of` stamp; upstream staleness → intent 22) | PRD-211, PRD-212 |
| `31-billing-unlock-verification.md` | Billing unlock — **verified, sandbox e2e passed** (checkout → signed webhook → plan upgrade, idempotent) | PRD-006 |
| `32-retirement-gap-closure-estimate.md` | Gap-closure estimate — **implemented, PR #259** (estimate endpoint + slider) | PRD-114 |
| `33-crisis-mode-simplified-view.md` | Crisis mode — **implemented, PR #262** (top-3 steps + fund + vault; opt-in, reversible) | PRD-108 |

## 34–37: multi-device easiness pass

From the 390/768/1440px viewport pass in the same review doc. 34 is a
suspected bug (reproduce first); 36 is an audit before fixes.

| File | Concern | Overlaps existing PRD |
|---|---|---|
| `34-post-login-routing-state-fragility.md` | ~~"Create Family Group" shown to accounts that have a family~~ **implemented — PR #243** | — |
| `35-mobile-navigation-and-tablet-layout.md` | Mobile nav — **partial, PR #255** (5-item bar + Ask Keel slot; tablet layout open) | — |
| `36-accessibility-baseline-audit.md` | A11y baseline — **audit done + fixes in this PR** (labels; SR walkthrough open) | — |
| `37-interruptible-setup-and-cross-device-continuity.md` | Interruptible setup — **implemented, PR #257** (resume at first incomplete step; autosave/inputMode pre-existing) | lands with intent 28 |
| `38-renewal-price-creep-tracking.md` | Price-creep tracking — **implemented, PR #258** (premium_history + premium_increased rule) | detectors/policy-review.yaml; PRD-143 for capture |
| `39-subscription-packaging-and-conversion-moments.md` | Annual plan frame, post-upload paywall moment, explicit free/Plus line | PRD-006, PRD-206 | IMPLEMENTED |

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
| `48-insight-attribution-scope-and-display.md` | Attribution: tick credits only its insight; feed shows titles not rule_ids | — | OPEN |
| `49-event-member-validation.md` | 404 on affected_member_id for a missing roster member | — | OPEN |
| `50-property-playbook-honesty.md` | Property playbook names the no-policy gap; copy bug fixed | — | OPEN |
| `51-runway-and-money-copy-honesty.md` | No fake-precise runways, negative money, or 'about less than a month' | — | OPEN |
| `52-event-id-resolution.md` | Event detail resolves server ids to catalog scenarios | — | OPEN |
| `53-sample-label-vs-partial-banner.md` | 'Partial', not 'sample', when missing-inputs banner shows | — | OPEN |
| `54-profile-completeness-recalibration.md` | Completeness weights asked sections; per-section breakdown | — | OPEN |
| `55-insight-severity-wiring.md` | Detector severity → insight priority; guardianship/will/zero-runway high | — | OPEN |
| `56-member-name-on-scoped-pages.md` | Member-scoped pages name the affected member | — | OPEN |
| `57-compound-event-answers.md` | Compound Ask Keel answers cover both events | — | OPEN |
| `58-sw-network-first-html.md` | Network-first HTML; deploys don't strand stale bundles | #282 | IMPLEMENTED |
| `59-stored-doc-renewal-date.md` | Optional renewal_date on stored docs feeds renewal detectors | #283 | IMPLEMENTED |
| `60-post-setup-engagement-card.md` | One honest engagement card on Home after setup | #284 | IMPLEMENTED |
| `61-gateway-provider-preference.md` | Provider pick prefers approved+configured processors | #285 | IMPLEMENTED |
| `62-score-weight-softening-early-career.md` | Rebalance score weights — early-career baseline lands mid-band | #286 | IMPLEMENTED |
| `63-invite-sent-viewed-status.md` | Invite sent/viewed timestamps on the roster | #287 | IMPLEMENTED |
| `64-shipped-fields-visibility.md` | Surface shipped relationship_label + income_notes prominently | #288 | IMPLEMENTED |
| `65-numeral-presence-test.md` | Every rendered numeral must be in the solver payload; delete sample path | #289 | IMPLEMENTED |
| `66-score-ceiling-surfaced.md` | Components state when missing data caps them | #290 | IMPLEMENTED |
| `67-derivation-closure.md` | Artefact closures + minimal invalidation, measured | #291 | IMPLEMENTED |
| `68-disclosure-join-in-engine.md` | Disclosure labels joined inside evaluate, not at the route | #292 | IMPLEMENTED |
| `69-fab-stack-above-nav.md` | SOS/gold FABs anchored above nav, inside reserved band | — | IMPLEMENTED |

## 70–77: Brief platform pivot & low-cost high-scale architecture (2026-10-28)

Market positioning and architectural pivot to the **shared, computed household brief** (Stages 1–4) plus the six low-cost, high-scale infrastructure changes that keep per-household cost decoupled from stored PDF volume.

| File | Concern | Becomes PRD | Status |
|---|---|---|---|
| `70-stage-1-household-brief.md` | Stage 1 — three problems only, one solver result, send + `confirmed_opened_at` (explicit "view the numbers" action, not a scanner-fetched GET), first brief free; remove chart, sample family, and Plus-as-OCR framing | PRD-222 | **SHIPPED** (PRs #300, #301, #305) |
| `71-stage-2-problem-packs-and-annual-record.md` | Stage 2 — six problem packs + `lifekeel_record_annual` (£59.99/yr) entitlement for the second brief / record keeping | PRD-223 | **GATED** on Stage 1 metrics (confirmed-open ~30%, second-brief return ~15%) |
| `72-stage-3-feeds-private-accounts-employer-seats.md` | Stage 3 — read-only balance and pension feeds into the same number, per-adult hidden accounts, and privacy-walled flat-fee employer seats | PRD-224 | **PARKED** until Stage 1–2 metrics exist |
| `73-stage-4-household-read-grant-and-fact-find.md` | Stage 4 — small read API under a household grant (`runway`, `renewal_dates`, `opened_at`, `document_locations`), existing-adviser fact-find export, and partner revocation preserving the graph | PRD-225 | **PARKED** until Stage 1–2 metrics exist |
| `74-object-storage-cutover-retire-gridfs.md` | Move vault and document bytes out of MongoDB GridFS into object storage (GCS/R2), keeping only metadata, hash, and pointer in Mongo | PRD-226 | **PARKED** — cost optimisation for document volume, not a brief requirement |
| `75-brief-hot-path-and-change-driven-invalidation.md` | Make the brief the hot path (narrow projection + single solver call + `data_version` cache) and switch from fixed sweeps to write-time change-driven invalidation | PRD-222, PRD-226 | **SHIPPED** (PR #300) |
| `76-hard-free-tier-spend-cap-and-zero-llm-brief.md` | Hard per-tenant free-tier spend cap across all budget classes; guarantee the first brief runs with zero model calls | PRD-226 | **SHIPPED** (PR #300) |
| `77-queue-payload-by-reference-and-cold-start-slo.md` | Enforce ID-only Redis queue payloads with a hard max-byte budget, and keep scale-to-zero with measured cold-start / brief p95 gate | PRD-226 | **PARKED** — scale concern, not Stage 1 |

**Shipped set (the Stage 1 cut): intents 70, 75, 76** — merged via PRs
#300 (backend, confirmed-open, spend cap, invalidation), #301 (governed
`brief.narrate` + numeral-presence guard), #303 (landing + /upgrade
reframe), #305 (nav entry, zero-model guarantee test). Everything else is
gated or parked on product metrics, not on engineering readiness.

## 79–82: Brief hardening, catalogue expansion, yearly refresh and trusted-person sharing (2026-10-29)

Follow-ups to the shipped factual catalogue (Intent 78): close the privacy gaps
found in review, add the family events the catalogue is missing, and give the paid
record a recurring reason to be reopened.

| File | Concern | Becomes PRD | Status |
|---|---|---|---|
| `79-sensitive-brief-facts-hardening.md` | Encrypt sensitive handover facts at rest, keep them out of logs and telemetry, reject password-shaped input | PRD-227 (Part A) | **PROPOSED** — fix first |
| `80-brief-catalogue-expansion-and-multi-step.md` | Renting, windfall, planned spend, care fees, illness, bereavement, bill in one name; past change dates; ordered multi-step briefs | PRD-227 (Part B) | **PROPOSED** — size against Stage 1 completion data |
| `81-annual-household-refresh.md` | Refresh a confirmed brief from last time's figures, household-entered review date, in-app prompt, no outbound messages | PRD-228 | **PROPOSED** — gated on Stage 1 return and gate metrics |
| `82-trusted-person-and-months-only-share.md` | "Just me" path, trusted person confirms by one-time link, months-only share, recipient controls with no creator notification | PRD-229 | **PROPOSED** — **BLOCKED** on a recorded safeguarding review |

Note: `78-factual-brief-catalogue.md` is shipped (PRs #308) but is not yet listed in
the table above; add its row when this index is next reconciled.


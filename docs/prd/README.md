# PRDs

Requirement briefs for LifeKeel, following the PRD→production process in
[CLAUDE.md](../../CLAUDE.md#prd--production-using-claude-code): problem,
who it's for, what "done" looks like, and the trust tier it touches.
Grounded in [000](000-market-landscape-and-positioning.md)'s market
research and in hands-on verification of the current codebase — every
"what's shipped" and "current gap" claim below was checked against real
code, not assumed.

## 000 — shared reference

[000-market-landscape-and-positioning.md](000-market-landscape-and-positioning.md) —
competitive landscape (AI money apps, family life-admin platforms,
insurance-gap tools) and the "world-class bar" each PRD below is written
against. Read this first; other PRDs cite it instead of repeating it.

[007-life-stage-and-crisis-response-research.md](007-life-stage-and-crisis-response-research.md) —
second shared reference, added alongside the 00x backfill set since it
grounds PRD-104 through PRD-108 the same way 000 grounds everything else:
the financial life-cycle framework, seven researched crisis-response
playbooks (job loss, bereavement, divorce, disability, recession,
aging-parent care, self-employed income shock), and why per-person
reasoning inside a shared household is still an open gap across every
competitor researched.

## 00x — backfilled: what's already shipped

Retroactive PRDs for live functionality, written against the same
template as forward-looking work so the full product surface is legible
in one place, plus a product-owner's "gaps to reach world-class" pass on
each — not just documentation, a refinement backlog.

1. [001-family-onboarding-twin-graph.md](001-family-onboarding-twin-graph.md) —
   conversational onboarding, the Family Twin's people domain.
2. [002-financial-domain-intelligence.md](002-financial-domain-intelligence.md) —
   the financial profile + 4 detectors, the one domain where the vision is
   fully real today.
3. [003-document-intake-ocr.md](003-document-intake-ocr.md) — upload +
   free storage / paid AI extraction.
4. [004-email-connector-inbox.md](004-email-connector-inbox.md) — Gmail
   scanning and the AI-summarized inbox.
5. [005-emergency-mode-scenario-simulator.md](005-emergency-mode-scenario-simulator.md) —
   the "What If?" simulator. **Flagged as the strongest differentiation
   candidate in the product** — market research found no comparable
   consumer product; see its market-bar section.
6. [006-lifekeel-plus-billing.md](006-lifekeel-plus-billing.md) — the Stripe-backed
   paid tier, currently dormant pending production cutover.

## 10x — forward: closing the vision gap

Sequenced to match ARCHITECTURE.md's roadmap — deepen the financial
domain before going wide, prepare-only actions before anything that acts.

1. [101-live-ai-assistant.md](101-live-ai-assistant.md) — replace the
   hardcoded assistant response map with real reasoning over the tenant's
   actual data. Tier 0.
2. [102-protection-insurance-domain.md](102-protection-insurance-domain.md) —
   extend the financial domain's bolted-on life/income-protection fields
   into a real Protection domain (multi-policy, renewal tracking,
   coverage-type gaps). Tier 0.
3. [103-tier1-prepare-actions.md](103-tier1-prepare-actions.md) — Keel
   drafts an outreach message for an insight; a human copies/sends it
   themselves. Tier 1, and deliberately stops there.
4. [104-per-member-financial-identity.md](104-per-member-financial-identity.md) —
   the Family Twin already models multiple people by name/role; the
   financial profile doesn't extend that to income/protection per person.
   Fixes a proven live gap where a mixed-earner household's single
   employment-status label can hide a real, quantified protection gap.
   Tier 0.
5. [105-protection-coverage-gaps.md](105-protection-coverage-gaps.md) —
   deepens PRD-102's Protection domain: adds car/home as recordable
   policy types, and gates the life-insurance-shortfall rule on genuine
   dependency (has_dependents or a mortgage), matching its sibling rule.
   Tier 0.
6. [106-retirement-past-target-age-correctness.md](106-retirement-past-target-age-correctness.md) —
   fixes a proven live bug where an already-retired household receives a
   nonsensical "projected retirement age" (observed: age 130) instead of
   an honest sustainability read. Tier 0.
7. [107-insight-lifecycle-retraction.md](107-insight-lifecycle-retraction.md) —
   insights are never retracted once the family fixes the underlying gap;
   proven live with a gap-free profile that left two stale insights
   untouched. A trust precondition for PRD-108. Tier 0.
8. [108-life-event-response-playbooks.md](108-life-event-response-playbooks.md) —
   the roadmap's own "next" after PRD-103: personalized checklists for
   job loss, bereavement, and disability, reusing PRD-103's draft
   mechanism for any step that involves outside contact. Tier 0/1.
9. [109-policy-extraction-profile-bridge.md](109-policy-extraction-profile-bridge.md) —
   OCR already extracted the right insurance fields and email scanning
   already ran attachments through it; nothing ever turned that into a
   `policies[]` entry, so every policy had to be hand-typed regardless of
   what was uploaded or scanned. Closes the one gap upstream of the whole
   protection-gap detector story. Tier 0.
10. [110-family-sharing-secondary-user-access.md](110-family-sharing-secondary-user-access.md) —
    "family" today is one login with a roster attached; the `invite_code`
    already shown in Settings redeems nowhere. Deliberately narrow v1:
    adults only (child accounts are their own, separate consent surface),
    full-access only (no per-field permissions yet), organizer-approval
    gated the same "prepare, don't auto-execute" way the Act layer's own
    trust-tier rule requires. The single highest-value, least-built gap
    in the product — a multiplier on every other journey, not just its
    own feature.
11. [111-unreported-life-change-nudge.md](111-unreported-life-change-nudge.md) —
    PRD-108's playbooks only personalize once a family explicitly reports
    an event; nothing notices when their own profile data already carries
    the signature of one (income to zero, employment status change,
    emergency savings drained). Deliberately sourced from data the family
    already typed in, not an external transaction feed — see the PRD's
    own "Market bar" section for why that's a permanent choice, not a v1
    limitation, tied to CLAUDE.md's "second rule" against ever needing
    FCA/SEC-style authorization. Tier 0, information-gathering only.
12. [112-friend-referral-loop.md](112-friend-referral-loop.md) — PRD-110's
    invite code is family-join-scoped by design; nothing lets an existing
    family refer a friend to their own, separate account. Reuses
    `generateInviteCode()` and `redeemPromoCode()`'s existing atomic-
    credit machinery rather than building parallel plumbing. Tier 0, with
    an in-app-credit-only reward (no real money, no Stripe interaction).
13. [113-on-device-inference-crisis-drafts.md](113-on-device-inference-crisis-drafts.md) —
    the one real LLM call in the life-event playbook flow (drafting an
    outreach message) routes through a cloud provider like everything
    else; no competitor offers on-device inference for family life-admin.
    Opt-in, WebGPU-gated, falls back to the existing cloud path
    invisibly on unsupported devices or any local failure. Tier 1 —
    unchanged from the feature it replaces the transport for; a human
    still reviews and sends every draft.
14. [114-composite-family-readiness-score.md](114-composite-family-readiness-score.md) —
    the dashboard's headline score was client-derived
    `100 − Σ confidence×10` penalty math that couldn't see estate
    readiness and couldn't distinguish "evaluated and clear" from
    "never evaluated." Replaces it with a deterministic, server-side
    composite (emergency fund, protection, retirement, education,
    estate) computed fresh on every read, plus the vault `doc_type`
    metadata the estate component is measured from. Tier 0.
15. [115-time-shifted-persisted-scenarios.md](115-time-shifted-persisted-scenarios.md) —
    `/assistant/simulate` could only do instant deltas and nothing
    persisted — "job loss in 6 months" measured runway from today's
    balance and vanished after the answer. Adds `monthsUntilChange`
    (fund grows/drains under today's numbers until the change lands),
    the `family_scenarios` collection + CRUD routes that recompute on
    read, and the first real web surface for scenario math on the
    job-loss tile. Tier 0.
16. [116-detector-declared-action-intents.md](116-detector-declared-action-intents.md) —
    the Act layer's execute machinery (approve → SendGrid/Twilio dispatch,
    idempotent receipts, approval-gate preview) shipped before any
    detector could feed it — every family action was a free-text string
    regex-classified as `log_only`. Adds typed `action_intents` on
    detector rules, authoritative over keyword classification in both
    directions, and exercises the first real Tier-2 intent: a self-send
    renewal-reminder email on `policy_renewal_window`. Tier 2, approve
    still the consent gate; auto-execute stays categorically
    log_only-only.
17. [117-member-twin-read-model.md](117-member-twin-read-model.md) —
    PRD-104 shipped per-member financial identity but nothing assembled
    it back into a per-member view. Adds `GET /family/members/:id/twin`
    (earner slice, attributed policies/funds/insights, computed fresh on
    read), `?member_id=` on `/insights`, and the real twin section on
    `/member/[id]` — the read-model foundation member micro-agents build
    on. Tier 0.
18. [118-member-readiness-score.md](118-member-readiness-score.md) —
    first member-scoped reasoning: `computeMemberReadiness` scores each
    member's own slice (their income protection + life cover, education
    funds; retirement organizer-only; estate adult-gated) on the twin
    endpoint and member page. Tier 0.
19. [119-per-member-pension-fields.md](119-per-member-pension-fields.md) —
    lifts PRD-104's "income only" scope: `members[]` gains optional
    pension balance + contribution, collected in the wizard, so a second
    earner's twin retirement component scores from their own pension
    projected against their income share of the household target.
    Tier 0.
20. [120-per-member-retirement-detection.md](120-per-member-retirement-detection.md) —
    closes the loop PRD-119 opened: members with pension data get the
    existing `family_retirement_gap` rules evaluated on their own
    trajectory (their age, salary, income-share target), producing
    `member_id`-attributed insights the twin and `?member_id=` filter
    already consume. Absent fields emit no event — never collected is
    not zero. Tier 0.
21. [121-estate-readiness-detector.md](121-estate-readiness-detector.md) —
    the last readiness component with no detector: `family_estate_readiness`
    turns missing will/PoA into persisted insights, evaluated both on
    profile submit (so a never-opened vault still surfaces the gap and
    stale-resolution can retire it) and on vault upload/delete.
    Tier 0.
22. [122-member-scoped-ask-keel.md](122-member-scoped-ask-keel.md) —
    `member_id` on `POST /assistant/ask` grounds the answer on the
    member's twin (extracted `getMemberTwin` — one assembly for route
    and assistant), with an "Ask Keel about {name}" card on the member
    page. The first member-scoped reasoning surface. Tier 0.
23. [123-member-invite-flow.md](123-member-invite-flow.md) —
    organizer-invites-a-specific-member, token-accept flips the existing
    roster entry `pending → active` via a new `user_id` link — no
    duplicate member, no shared-code roundtrip. Also fixes the PRD-110
    approve path to link a pending entry by email. Tier 0.
24. [124-youth-facing-twin.md](124-youth-facing-twin.md) —
    `?mode=youth` on the member twin returns a server-side redacted
    projection for minors — savings progress as percentages, zero
    minor-unit fields in the payload — plus a "Kid view" toggle on the
    member page. Tier 0.
25. [125-readiness-quiz-alignment.md](125-readiness-quiz-alignment.md) —
    the public quiz now scores through `computeReadiness` itself on a
    synthesized profile — same components, same weights, same
    "no data → null" honesty — and returns the component breakdown.
    Tier 0.
26. [126-member-agent-persona.md](126-member-agent-persona.md) —
    `GET /family/members/:id/agent`: the micro-agent's voice —
    deterministic prioritized nudges (insight → attention → progress)
    read off the twin, `guardian` persona for minors, `provisional`
    flagging for pending members. Tier 0.
27. [127-member-agent-loop.md](127-member-agent-loop.md) —
    the agent's memory: nudges persist in `member_nudges` with dedupe,
    dismiss, and self-healing resolution; a daily cron pass reconciles
    every member of every family even when nobody opens the page.
    Tier 0 — writes state, never notifies.
28. [128-member-life-cover-detection.md](128-member-life-cover-detection.md) —
    `member_no_life_cover` in `family_protection_gap`: fires on
    per-member earner events when a working second earner with
    dependents has no life policy attributed to them — the gap the
    aggregate household rule structurally can't see. Tier 0.
29. [129-youth-literacy-curriculum.md](129-youth-literacy-curriculum.md) —
    age-banded lesson cards (younger/teen) served inside the redacted
    youth twin payload and rendered as "Things worth knowing" in Kid
    view. Concepts + a parent-doable "Try it"; no amounts or products.
    Tier 0.
30. [130-continuity-check.md](130-continuity-check.md) — the dead man's
    switch, shaped to the vault's standing-access model: a throttled
    `last_seen_at` heartbeat feeds a persisted watching → check-in →
    alert state machine that emails the organizer, then their designated
    adults. Informational only — nothing is released or granted.
31. [131-cashflow-substrate.md](131-cashflow-substrate.md) — the interim
    cash-flow substrate until live bank feeds exist: a tenant-scoped
    recurring income/expense ledger (`family_cashflow_entries`) with a
    computed monthly in/out/net + runway summary, and the `/cashflow`
    page to manage it. Tier 0.
32. [132-multi-step-scenarios.md](132-multi-step-scenarios.md) —
    `ScenarioChange.steps` turns scenario math into real timelines
    (dip-and-recover, temporary cost spikes) with per-step balances,
    runway under each regime, and mid-segment fund-depletion detection;
    the scenario card generalizes beyond job-loss to bereavement,
    disability, medical, new-child, and university tiles. Tier 0.
33. [133-action-network-account-info.md](133-action-network-account-info.md) —
    the Action Network's read-only half: an `AccountInfoProvider`
    interface (env-gated sandbox + real TrueLayer token mode), sync into
    `external_accounts` with credential-health flags, and the connect
    surface on `/connect`. Permanently read-only — no payment
    initiation. OAuth consent + sync cadence stay partnership-blocked.
34. [134-vault-client-side-sealing.md](134-vault-client-side-sealing.md) —
    the zero-knowledge decision: full per-user ZK rejected (it would
    strand estate documents exactly when the family needs them); shipped
    instead is opt-in client-side sealing — PBKDF2→AES-256-GCM under a
    shared family passphrase, double-wrapped in the server layer. Tier 0.
35. [135-assets-register-and-context.md](135-assets-register-and-context.md) —
    gap 8's non-sensitive slice: a tenant-scoped assets register
    (property/vehicles/valuables, `/assets`) plus an organizer-authored
    household context note that Ask Keel reads as background.
    Medical/health records and per-member preference modeling stay
    deferred — see the PRD for why. Tier 0.
36. [136-readiness-feed-and-family-heartbeat.md](136-readiness-feed-and-family-heartbeat.md) —
    **proposed.** The detectors, score snapshots, attribution, nudges and
    scenario recomputes already run silently; nothing narrates them.
    Adds a `readiness_events` model with ten emitter hooks, a "What
    changed" feed on the home page, a weekly/monthly heartbeat per
    adult through the existing `DeliveryRouter`, saved-scenario
    watchlists, per-event feedback/mutes, and the notification
    preference center. Tier 0 — narrates, never acts.
37. [137-family-legacy-map.md](137-family-legacy-map.md) — **proposed.**
    Estate coverage today is two vault booleans. Adds a legacy register
    (wills, codicils, POA/LPA, directives, trusts, guardianship, probate
    records with named roles, jurisdiction, review dates, original
    location), an inherited/ancestral-property model on the assets
    register (ownership basis, recorded vs. claimed owners, title
    evidence, disputes, foreign jurisdiction), a mandatory verification
    label on every claim, a person↔document↔property graph Ask Keel can
    read, a `legacy` readiness component, 10 detector rules replacing
    `estate-readiness.yaml`, and a continuity rehearsal. Register and
    detectors Tier 0; any *release* of documents stays out of scope.

38. [138-quiet-care-digest.md](138-quiet-care-digest.md) — **proposed.**
    The heartbeat job exists but silence is still ambiguous. A monthly
    digest that is always sent, built as proof of work (what was checked,
    what changed, next check date), amending PRD-136's cadence and
    zero-change behaviour. Tier 0.
39. [139-notification-tiers-caps-suppression.md](139-notification-tiers-caps-suppression.md) —
    **proposed.** `DeliveryRouter` limits messages per insight, not per
    family. Four message tiers, a family-level budget and suppression
    after unopened alerts, so the product stays calm. Tier 0.
40. [140-notification-channel-fallback.md](140-notification-channel-fallback.md) —
    **proposed.** Native push, installed-PWA web push, then email, chosen
    per member, with no financial content in push payloads. Tier 0.
41. [141-retention-and-perceived-protection-metrics.md](141-retention-and-perceived-protection-metrics.md) —
    **proposed.** Defines retention for a product people do not open:
    quiet-care retention, digest engagement, data freshness and a
    quarterly perceived-protection question. Tier 0.
42. [142-ai-task-provider-registry.md](142-ai-task-provider-registry.md) —
    **proposed.** The technical gate for CLAUDE.md rule 3: no hosted model
    call without an approved task, processor, retention mode and field
    allow-list, with a tripwire test. Prerequisite for PRD-143 and
    PRD-144. Tier 0.
43. [143-reviewed-extraction-pipeline.md](143-reviewed-extraction-pipeline.md) —
    **proposed.** Classify, extract only the fields detectors consume, and
    show the source for confirmation before anything reaches the profile.
    Extends PRD-003 and PRD-109. Tier 0; the user confirms every write.
44. [144-email-signal-agent.md](144-email-signal-agent.md) — **proposed.**
    Read-only, opt-in mailbox matching on fixed categories; matched
    attachments go through PRD-143's confirm gate. Closes PRD-004's
    enrichment gap safely. Tier 0.
45. [145-freshness-and-completeness-signals.md](145-freshness-and-completeness-signals.md) —
    **proposed.** One deterministic signal for "this check is paused
    because an input is missing or old", feeding the digest, Tier C
    notifications and upgrade prompts. Tier 0.
46. [146-client-and-account-data-deletion.md](146-client-and-account-data-deletion.md) —
    **proposed.** Deletion with receipts across documents, derived data,
    device tokens and accounts, plus per-class retention. Tier 2 for the
    user-confirmed destructive action.
47. [147-pwa-install-and-polish.md](147-pwa-install-and-polish.md) —
    **proposed.** Manifest and install fixes, an iOS-aware install hint
    under the strict CSP, and a trimmed service-worker precache. Tier 0.

48. [148-detector-roadmap.md](148-detector-roadmap.md) — **proposed.**
    Eleven of the fourteen October PRDs are plumbing around nine
    detectors. Admission criteria for new ones, an evidence-ranked
    candidate list, and event-driven checks, within the advice rule.
    Tier 0.
49. [149-jurisdiction-pack.md](149-jurisdiction-pack.md) — **proposed.**
    A typed per-region bundle (currency, language, document types,
    detector parameters, advice-rule word lists), single currency per
    family, and a recorded data-residency decision for UK and Slovenia.
    Tier 0.

## 20x — marketing: the same engine as the growth mechanic

Uses LifeKeel's own detector engine and content infrastructure
(`blog.ts`, `growth-events.ts`) as the acquisition mechanism, rather than
building disconnected marketing tooling.

1. [201-public-readiness-score-lead-magnet.md](201-public-readiness-score-lead-magnet.md) —
   a public, no-signup readiness quiz that runs the *real* detector
   engine anonymously, not a simplified marketing-only approximation.
2. [202-detector-driven-content-engine.md](202-detector-driven-content-engine.md) —
   one explainer post per detector rule, cross-linked from both the
   marketing site and real in-product insight cards.

3. [203-passwordless-result-save.md](203-passwordless-result-save.md) —
   **proposed.** Turns the anonymous score into something owned: one email
   field, a magic link, no password, and a no-enumeration response.
4. [204-reveal-trust-block-and-answer-correction.md](204-reveal-trust-block-and-answer-correction.md) —
   **proposed.** A literally-true "what we do / don't do" block and a
   "correct my answers" action at the moment of doubt.
5. [205-household-share-of-snapshot.md](205-household-share-of-snapshot.md) —
   **proposed.** A revocable read-only link so a partner can see the
   snapshot before any account exists.
6. [206-free-to-plus-upgrade-moments.md](206-free-to-plus-upgrade-moments.md) —
   **proposed.** Upgrade prompts only where parsing closes a data gap,
   never from a risk alarm, with an honest trial summary.

7. [207-partner-distribution.md](207-partner-distribution.md) —
   **proposed.** A channel compatible with zero commission: flat per-seat
   fees, no steering, aggregate-only partner view, and the family's own
   existing adviser only. Needs counsel before any contract.
8. [208-trust-marks-and-public-evidence.md](208-trust-marks-and-public-evidence.md) —
   **proposed.** A public trust page where every statement is evidenced,
   a live sub-processor table, security testing and external marks, with
   a rule that claims wait for the code that backs them.
9. [209-landing-chart-story.md](209-landing-chart-story.md) —
   **proposed.** The landing page told as one extensible story ("The Chart":
   ready before, found during, sorted after) with direct signup, an animated
   sea hero, a Live/Planned capability board, and a claims registry. It
   supersedes the quiz-based parts of 201, 203, 204 and 205 for the landing
   page; those are deferred, not deleted. Tier 0.
10. [210-marketing-engine-redefined.md](210-marketing-engine-redefined.md) —
    **proposed.** The marketing engine as one system: a shared claims registry
    and copy guard for every producer, content items with a weekly-approved
    calendar, managed channel profiles with drift checks, static blog pages for
    search, and one funnel. Human approval for anything public is unchanged.
    Tier 0 for drafts and plans; Tier 2 (always approved) for publishing and
    profile changes.

## 21x — verified-twin strategic phases (decided 2026-10-22)

The phased execution of ARCHITECTURE.md's §2 "Strategic direction: the
verified twin" and §8.4b, after the local-interactive serving experiment
failed its measured latency gate (see
[decision-local-interactive-closed-2026-10.md](../reviews/decision-local-interactive-closed-2026-10.md)).
Each phase is independently shippable; dependencies are in "Builds on".

1. [211-ask-keel-hosted-processor.md](211-ask-keel-hosted-processor.md) —
   **Phase 0.** Restore Ask Keel: one hosted processor through terms review,
   deadline cancellation fixed, live compliance probes. Tier 0.
2. [212-verified-answer-resolver.md](212-verified-answer-resolver.md) —
   **Phase 1.** Factual questions resolve to authorized deterministic
   operations and provenance-bound rendering — zero model calls; the
   generation-escape rate becomes a managed KPI. Tier 0.
3. [213-own-the-noticing.md](213-own-the-noticing.md) — **Phase 2.**
   Detector coverage depth (LLM-as-compiler drafting allowed, review-gated),
   calibrated drift sentinels, delivery-judge authority evidence. Tier 0.
4. [214-trust-artifacts-as-product.md](214-trust-artifacts-as-product.md) —
   **Phase 3.** Receipt Chain (M7), first Earned-Scope Contract (M5), and
   Proof-of-Handover rehearsal (M3) as visible product surfaces. Tier 1–2
   surfaces over unchanged gate machinery.
5. [215-efficiency-hardening.md](215-efficiency-hardening.md) — **Phase 4.**
   Email de-generation (encoder/extractor + templates via shadow gate),
   bulkheads and bounded admission, escalation-rate and cost-per-accepted-
   result telemetry. Tier 0.
6. [216-ip-workstream.md](216-ip-workstream.md) — **non-engineering.**
   Provisional filings for M1, verified-answer composition, and M5;
   defensive publication for the cascade/tier-gate/caching patterns.
   Counsel-led, deliberately cheap.
7. [217-operator-ai-observability.md](217-operator-ai-observability.md) —
   **cross-phase.** The operator console has no AI-gateway visibility — the
   October outage was invisible until probed manually. `/operator/ai` health
   cards per task (latency, outcome mix, serving processor, breaker),
   processor registry status, cost per task/family, cascade and
   guard-reject visibility, a narrow audited task-disable control, digest
   and alerting integration. Tier 0 reads; Tier 2 discipline on the control.

Sequencing note: 211 → 212 is the critical path to a live, efficient
assistant; 213 and 215 can run in parallel with 212; 214 needs no dependency
beyond the existing Act machinery; 216 runs outside the engineering cadence;
217 should land alongside 211 — shipping a live hosted path without the
observability that would have caught this outage repeats the same mistake.

## 22x — marketing engine: the self-improving loop

Steps 2–6 of the marketing engine programme, written up from intents 15–19
(`docs/intents/`); shared context in
[marketing-engine-build-notes.md](../intents/marketing-engine-build-notes.md).

1. [218-per-post-attribution.md](218-per-post-attribution.md) — a per-post
   `utm_content` tag, features recorded at draft time, visits/signups per tag
   in the rollup, and a weekly posts table on the Plan tab. Tier 0.
2. [219-content-studio-minimal.md](219-content-studio-minimal.md) — three
   post formats + a hook allow-list in `definitions/marketing-formats.yaml`,
   deterministic no-model fallbacks, and signed brand-card images so
   Instagram drafts become approvable. Tier 0/1.
3. [220-emergency-sheet.md](220-emergency-sheet.md) — the invite/share loop:
   partner-invite prompt on shipped PRD-110 mechanics, an owner-generated
   opt-in emergency sheet that never lives at a URL, and referral links
   attributed as `utm_source=referral` on shipped PRD-112 mechanics.
   Tier 0/1. Counsel reviews the sheet wording once.
4. [221-marketing-learner.md](221-marketing-learner.md) — **gated** on ~500
   visits/month and 40+ tagged posts: a shadow-first allocation learner
   (30% exploration floor, promotion gate, one-click veto, auto-revert) and a
   deterministic weekly brief. Allocation only, never wording. Tier 0/1.

Not a PRD: the distribution playbook (intent 18) is a document deliverable —
`docs/marketing/distribution-playbook.md` — plus a tagged-link helper script.

**Quiz retired (2026-10-20).** PRD-125, 201, 203, 204 and 205 describe the public readiness quiz and its result-save, trust-block and share extras. The quiz, its API route and share card were removed; `/readiness` now redirects to signup. Those documents stay for history and are not on the build order.

## 222–226 — Brief platform pivot & low-cost high-scale architecture (decided 2026-10-28)

The market is crowded with storage vaults (SafeKeep, Biscuit Tin, Capsafa,
SuccessionKeeper, Lyfeguard, Safe4) and advice/distribution platforms, and empty
of a **shared, computed brief for a real household problem** where both adults
see the same runway months and leave without a product recommendation. These
five PRDs define the four-stage pivot from a broad chart/vault/OCR pitch to the
household brief platform, plus the low-cost, high-scale infrastructure changes
that keep marginal cost independent of stored PDF volume (from Intents 70–77):

1. [222-stage-1-the-household-brief.md](222-stage-1-the-household-brief.md) —
   **Stage 1 — BUILDABLE.** Three problems only (`income_stops`,
   `earning_less`, `handover_gap`); one engine (a few inputs, one deterministic
   solver result, send link, `confirmed_opened_at` — stamped only by an
   explicit "view the numbers" action, never a scanner GET); one free brief
   per household with zero model calls; remove the harbour chart, sample
   family, and Plus-as-OCR framing. Tier 0.
2. [223-stage-2-problem-packs.md](223-stage-2-problem-packs.md) — **Stage 2 —
   GATED on Stage 1 metrics.** Six problem packs on the same solver (job change
   where employer cover ends, mortgage fix ending, renewal price change,
   childcare or school bill starting, quiet month or tax bill, parent needing
   support). The second brief / record keeping is a new `lifekeel_record_annual`
   entitlement (£59.99/yr), not a re-skin of the OCR Plus plan — existing Plus
   subscribers keep their OCR features. Tier 0.
3. [224-stage-3-feeds-private-accounts-employer-seats.md](224-stage-3-feeds-private-accounts-employer-seats.md) —
   **Stage 3 — PARKED (design intent).** Read-only balance/pension feeds into
   the same number; `visibility: 'private'` accounts disclosed as
   `savings_scope: 'partial'` on shared briefs; flat-fee employer seats with a
   hard privacy wall (seats can never mint or authenticate as household
   grants). Tier 0.
4. [225-stage-4-household-read-api-and-fact-find.md](225-stage-4-household-read-api-and-fact-find.md) —
   **Stage 4 — PARKED (design intent).** Small read API under a revocable
   household grant (`runway`, `renewal_dates`, `opened_at`,
   `document_locations` — never recomputing on read, never serving raw files),
   deterministic fact-find export for an adviser the family already has, and
   partner/grant disconnection that deletes access while preserving the graph.
   Tier 0/1.
5. [226-brief-scale-and-cost-architecture.md](226-brief-scale-and-cost-architecture.md) —
   **Split status.** Buildable with Stage 1: brief hot path
   (`solver_version`/`data_version` cache), change-driven invalidation, hard
   free-tier spend cap (zero model calls on the first brief). Parked: GridFS →
   object-storage cutover (cost optimisation for document volume, not a brief
   requirement), queue payload cap, cold-start p95 gate.
   `document.extract_fields` is **BLOCKED** until an approved processor exists
   (GCP Ollama decommissioned 2026-10-24). Tier 0.


## 227–229 — Brief catalogue expansion, hardening, yearly refresh and trusted-person sharing (proposed 2026-10-29)

Follow-ups to the factual catalogue (Intent 78), from a review of what shipped:

1. [227-brief-catalogue-expansion-and-engine-hardening.md](227-brief-catalogue-expansion-and-engine-hardening.md) —
   **PROPOSED.** Part A (fix first): encrypt sensitive handover facts at rest,
   keep them out of logs and telemetry, DPIA and retention, password-shaped input hint. Part B: add
   renting, windfall, planned spend, care fees, illness, bereavement and
   bill-in-one-name; allow past change dates; accept ordered multi-step briefs.
   Tier 0.
2. [228-annual-household-refresh.md](228-annual-household-refresh.md) —
   **PROPOSED, gated on Stage 1 metrics.** Refresh a confirmed brief from last
   time's figures, a household-entered review date with an in-app prompt, and no
   outbound messages. Tier 0.
3. [229-trusted-person-and-months-only-share.md](229-trusted-person-and-months-only-share.md) —
   **PROPOSED, BLOCKED on a safeguarding review.** A "just me" path, a trusted
   person who confirms by one-time link without an account, a months-only share
   with no figures in the payload, and recipient control with no creator-visible
   "not opened" signal. Tier 0.

## 230 — Friction budget (proposed 2026-10-30)

1. [230-friction-budget-and-zero-connection-first-value.md](230-friction-budget-and-zero-connection-first-value.md) —
   **PROPOSED, targets to be baselined.** Measure time, fields and connections on the
   first-value path; first value never needs a connection; the brief link is the front
   door for households, advisers and employers; the second adult reads first and joins
   later. Tier 0.

## 231 — Household single-point-of-failure map (proposed 2026-10-30)

1. [231-household-single-point-of-failure-map.md](231-household-single-point-of-failure-map.md) —
   **PROPOSED.** One row per recurring obligation: who is named, who pays, whose
   phone gets the notices, the next due date — and a one-line summary of how much
   depends on one person. Household-entered, no connection. Tier 0.


## 233 — Lapse and change detection (proposed 2026-10-30)

1. [233-lapse-and-change-detection.md](233-lapse-and-change-detection.md) —
   **PROPOSED.** When an expected premium or renewal has no record by its date,
   an in-app signal says "no payment on file since <date>; check with your
   provider that cover is in force" — never "lapsed". Extends the existing
   premium-increase rule. Tier 0.
## 235 — Claim packet (proposed 2026-10-30)

1. [235-claim-packet.md](235-claim-packet.md) — **PROPOSED.** For one policy
   type first (life): assembles the insurer's claims contact as printed, the
   policy number, and a checklist of papers on file or not located, plus a
   fixed-template draft notification the household reviews and sends. Tier 1
   prepare-only — no ActionExecutor, nothing sent. Tier gate recorded.


## Suggested build order for 138–147 and 203–206

Dependencies are in each PRD's "Builds on"; this is the order that follows from
them. It is a recommendation, not a commitment.

1. **First, cheapest, and aimed at the two structural problems** (a score with
   nothing to own; silence that can't be told from failure): PRD-203 passwordless
   result save and PRD-138 Quiet Care digest. PRD-204 is small and ships with 203.
2. **Measure before building ingestion:** PRD-141 retention metrics and PRD-145
   freshness signals, so there is a baseline and it is clear whether ingestion
   moves conversion.
3. **Channels and calm:** PRD-139 tiers and caps, then PRD-140 channel fallback.
   PRD-147 PWA polish can run alongside, since installed PWAs are a push channel.
4. **Gate before agents:** PRD-142 task and provider registry. No hosted-model call
   from PRD-143 or PRD-144 runs before it exists.
5. **Upload path before the mailbox:** PRD-143 reviewed extraction, with PRD-146
   deletion alongside it so derived data is deletable from day one. These carry most
   of the value with none of the Gmail assessment overhead, and they build the
   confirm-before-commit gate PRD-144 reuses.
6. **Mailbox last:** PRD-144 email signal agent, once the provider's security
   assessment cost and timeline are known.
7. **Growth extras any time after 203:** PRD-205 household share, then PRD-206
   upgrade moments once PRD-143 and PRD-145 exist to sell and to key on.
8. **Breadth and reach, after billing cutover (PRD-006):** PRD-148 detector roadmap
   (evidence from steps 1 and 2 decides the ranking), PRD-149 jurisdiction pack
   before any serious push on the `.si` product, PRD-208 trust marks alongside the
   upload path, and PRD-207 partner distribution once there is something to sell.
9. **Landing story, on the existing signup (founder decision, no quiz):** PRD-209.
   It is independent of the sequence above except that it must not claim anything
   those PRDs have not shipped (no "emailed sign-in link", monthly letter or
   "not used for training" until an email sign-in link PRD, PRD-138 and PRD-142
   land). The quiz-based result-save PRDs named in the steps above (203, 204, 205)
   are deferred by this decision, and an email sign-in link PRD replaces them when
   it is written.
10. **Marketing engine:** PRD-210. Phase 0 (copy guard, stale quiz wording, content sync) first and alone; it
    depends only on PRD-209's claims registry.

## Deliberately not written as PRDs yet

Per ARCHITECTURE.md's own sequencing, these aren't ready for an
engineering PRD:

- **Health/medical domain** — GDPR special-category data; deferred on
  proportionality grounds, not just sequencing (see PRD-135). The
  non-sensitive halves of the old "Life/Assets" grouping — the assets
  register and the household context note — shipped in PRD-135; what
  remains deferred is medical records and per-member preference/decision-
  rights modeling. This is also why PRD-108's disability playbook
  personalizes against insurance *policy* data only, never a diagnosis
  or other health record.
- **Action Network partnerships** (bank/insurer/airline API integrations) —
  "mostly a business-development problem wearing an engineering costume."
  Nothing here to write a technical PRD against until a partner exists.
  This is also why a "continuously research the market and suggest a
  better policy" capability — the natural next step after PRD-105/108,
  and the clearest path to the "consistently researches the market"
  framing in the product vision — isn't written as a PRD yet: it needs a
  real market-rate data source or partner underneath it, not just an
  engineering slice.
- **Any Tier 2+ autonomous action** (auto-filing a claim, moving money) — not
  proposed until PRD-103's Tier 1 pattern has shipped and been trusted in
  production, and even then needs its own named trust-tier decision per
  CLAUDE.md's rule, not a default next step.
- **Divorce, recession, aging-parent-care, and self-employed-income-shock
  playbooks** — drafted in full in
  [007](007-life-stage-and-crisis-response-research.md) alongside the
  three PRD-108 ships, but held back as v2: better to validate the
  life-event mechanism (declaration → personalized playbook → prepare
  action) against three well-scoped events before committing to seven at
  once.
- **Full per-family-member reasoning in the assistant and every detector**
  (not just protection, as PRD-104 scopes it) — the "personalized Keel for
  every family member" end state the product vision names, but PRD-104
  deliberately ships the income/protection slice first and leaves
  per-member retirement, education, and emergency-fund reasoning for a
  follow-up once that slice is proven, rather than redesigning every
  detector's data model in one PRD.

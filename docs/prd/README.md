# PRDs

Requirement briefs for Agent Oak, following the PRD→production process in
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
6. [006-oak-plus-billing.md](006-oak-plus-billing.md) — the Stripe-backed
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
3. [103-tier1-prepare-actions.md](103-tier1-prepare-actions.md) — Oak
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
22. [122-member-scoped-ask-oak.md](122-member-scoped-ask-oak.md) —
    `member_id` on `POST /assistant/ask` grounds the answer on the
    member's twin (extracted `getMemberTwin` — one assembly for route
    and assistant), with an "Ask Oak about {name}" card on the member
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
    household context note that Ask Oak reads as background.
    Medical/health records and per-member preference modeling stay
    deferred — see the PRD for why. Tier 0.

## 20x — marketing: the same engine as the growth mechanic

Uses Agent Oak's own detector engine and content infrastructure
(`blog.ts`, `growth-events.ts`) as the acquisition mechanism, rather than
building disconnected marketing tooling.

1. [201-public-readiness-score-lead-magnet.md](201-public-readiness-score-lead-magnet.md) —
   a public, no-signup readiness quiz that runs the *real* detector
   engine anonymously, not a simplified marketing-only approximation.
2. [202-detector-driven-content-engine.md](202-detector-driven-content-engine.md) —
   one explainer post per detector rule, cross-linked from both the
   marketing site and real in-product insight cards.

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
  (not just protection, as PRD-104 scopes it) — the "personalized Oak for
  every family member" end state the product vision names, but PRD-104
  deliberately ships the income/protection slice first and leaves
  per-member retirement, education, and emergency-fund reasoning for a
  follow-up once that slice is proven, rather than redesigning every
  detector's data model in one PRD.

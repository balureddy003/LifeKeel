# Built vs Market & Innovation Flywheel (October 2026)

What Agent Oak has actually built, scored against the competitive
positioning it claims, with every gap that weakens the claim and an
innovation flywheel that closes them in a self-reinforcing cycle.

Companion to [market-positioning-october-2026.md](market-positioning-october-2026.md)
(the external landscape) and
[vision-vs-implementation-audit-2026-09.md](vision-vs-implementation-audit-2026-09.md)
(the internal inventory). This document bridges the two: does what's
built actually support the market position?

---

## Part 1 — What's Built, Scored Against Each Positioning Claim

The recommended positioning is: **"the always-on readiness system for
your family"** — proactive + protection-focused + family-scoped + neutral.
Five load-bearing claims make that true. Each is scored below.

### Claim 1: "Continuous detection — not a one-shot calculator"

**What's built:**
- 5 YAML detectors, 13 rules, covering protection gap (5 rules incl.
  per-member life cover), emergency fund (3 rules), retirement gap (3
  rules), education shortfall (2 rules), and estate readiness (2 rules).
- Re-evaluation fires on: every profile submit, every document
  apply-to-profile, every vault upload/delete, and a daily stale-profile
  sweep (`stale-profile-evaluation.ts`).
- Insight lifecycle: `identified → sent → approved → completed`, with
  stale-resolution (auto-`resolved` when the rule stops firing) and
  dedup (same `detector_id + rule_id + entity_key` within 24h).
- `policy_renewal_window` is the only rule with a declared
  `action_intent` — a self-send email reminder, Tier 2 with human
  approve gate.

**Score: 7/10 — the claim is real but narrow.**

| Strength | Gap |
|---|---|
| Re-evaluation is genuinely continuous (on data change + daily sweep) | Only 5 detectors / 13 rules — a single-domain detection library |
| Stale insight resolution means detectors self-correct | No detectors for: debt-to-income ratio, tax efficiency, pension consolidation, beneficiary staleness, policy overlap/duplication, spending anomaly |
| Per-member detection (PRD-128) is genuinely novel | No time-based triggers beyond renewal window (e.g. "your emergency fund hasn't grown in 6 months", "your child turns 18 in 3 months — review education fund") |
| Evidence trails + explain endpoint give transparency | Detection only triggers on profile data changes; no connector-fed live signals (bank balance drops, transaction patterns) |

**What would make this 9/10:** Double the detector count to cover the
obvious gaps families actually face. The engine is built for it — every
new detector is a YAML file + a signal mapping, not new code. See the
flywheel (Part 3) for sequencing.

---

### Claim 2: "Whole-family, not single-user"

**What's built:**
- Family roster with `organizer/parent/adult/child` roles, DOB, stable
  `member.id` identity.
- Two real invite flows: invite-code join (PRD-110, organizer-approved)
  and per-member email invite (PRD-123, token-accept).
- Per-member financial identity: `household.members[]` with employment,
  salary, income protection, pension balance/contribution.
- Member twin read model (`GET /family/members/:id/twin`): earner slice,
  attributed policies, education funds, member-scoped insights,
  `computeMemberReadiness`.
- Member-scoped Ask Oak (`member_id` on `/assistant/ask`).
- Youth twin (`?mode=youth`): server-side redacted, age-banded lessons,
  savings progress without amounts.
- Member agent persona (`GET /family/members/:id/agent`): deterministic
  nudges, guardian persona for minors, daily reconciliation loop.
- Continuity check (PRD-130): heartbeat → check-in → alert state machine
  for designated adults.

**Score: 8/10 — genuinely differentiated against every competitor found.**

| Strength | Gap |
|---|---|
| Per-member reasoning is real (not just shared access) — Monarch/Copilot/Origin don't do this | No per-member scenario simulation (scenarios are household-level only) |
| Youth twin with server-side redaction is careful, trust-appropriate design | Youth literacy curriculum is thin (age-banded lesson cards, no progression/quizzing) |
| Member agent loop + nudges is a real micro-agent, not just a view | No per-member notification preferences (all delivery is tenant-level) |
| Invite flow is genuinely organizer-gated (prepare-not-send applied to access) | No per-field permissions yet (adult members get full access or nothing) |

**What would make this 9/10:** Per-member scenario scoping ("what happens
to *your* retirement if *your* income changes") and richer youth
financial literacy (progression, gamification, savings challenges).

---

### Claim 3: "Proactive intelligence — surfaces what wasn't asked"

**What's built:**
- Detector engine fires on data change → insights surface in inbox
  without user action.
- Unreported-life-change nudge (PRD-111): detects `employment_status_change`,
  `salary_to_zero`, `emergency_fund_drained` across profile saves.
- Policy renewal window (60-day proactive alert).
- Life-event vault reminders (bereavement/disability/medical → email
  other adults about estate vault).
- Checklist reminders (3 days after a reported event if steps incomplete).
- Daily member-agent nudge reconciliation (attention/insight/progress).
- LLM judge holding insights for human review before delivery
  (`move-judge.ts`).
- Delivery router with urgency floor, quiet hours, digest mode, and
  WhatsApp → SMS → email → push fallback chain.

**Score: 6/10 — the infrastructure is excellent, the content is thin.**

| Strength | Gap |
|---|---|
| The delivery stack is production-grade (multi-channel, quiet hours, dedup, signed links, digest) | Only 3 profile-drift triggers (employment change, salary→zero, emergency fund drained) — the unreported-life-change detection is barely exercised |
| Renewal window is genuinely proactive (not reactive to a user query) | No time-based proactive nudges: "you haven't updated your profile in 6 months", "your child's education fund target date is approaching" |
| The nudge → life-event → playbook pipeline is a real, unique flow | No external-signal triggers (Open Banking feeds aren't live; no spending pattern detection) |
| Member agent nudges run daily even when nobody logs in | Insights are only delivered on state change, not on *absence* of expected state change ("you set a savings goal 3 months ago and haven't increased your contributions") |

**What would make this 9/10:** The detect-before-declared angle from the
September deep-dive is still the highest-upside unclaimed capability in
the market. But it needs the Action Network (live bank feeds) to move
beyond profile-diff detection into real behavioral signals. In the
interim, *time-based* proactive nudges are free to build and would
meaningfully increase the "surfaces what wasn't asked" claim.

---

### Claim 4: "Crisis-native — Oak knows what to do next"

**What's built:**
- Emergency Mode overlay with life-safety notice, 7-event taxonomy
  (job loss, bereavement, disability, medical, car, property, travel).
- All 7 have real playbooks (YAML-defined, rendered against live profile
  data, provider contacts from policies).
- Server-persisted checklist completion (cross-device family
  coordination).
- What-If readiness per event type (`GET /family/events/:eventId/readiness`).
- Multi-step scenario simulation with time-shifting and regime changes
  (PRD-115/132): `monthsUntilChange`, `steps[]`, fund-depletion
  detection, timeline visualization.
- Persisted named scenarios recomputed against live profile on every read.
- Scenario tiles for job-loss, bereavement, disability, medical,
  new-child, university.
- Tier 1 draft outreach from playbook steps (never sent by Oak).
- Vault awareness notifications on crisis events.
- Continuity check (dead-man's-switch-shaped notification system).

**Score: 8/10 — the strongest competitive differentiator in the product.**

| Strength | Gap |
|---|---|
| No competitor found combines crisis playbooks + real financial data + scenario simulation | Playbooks are static templates — no adaptive branching based on family specifics beyond provider-name substitution |
| Emergency Mode's emotional design (life-safety notice, escape key, event de-dupe) is validated by 2026 banking UX research | No free-text context capture during crisis reporting ("tell me what happened" — the council review's top recommendation) |
| Multi-step scenarios with fund-depletion are genuinely novel | Scenarios are household-level only — "what happens to *my* runway" isn't possible for a second earner |
| Vault reminders on crisis events are a trust-building touch | No integration with Empathy or similar post-crisis support — the handoff from "Oak prepared you" to "here's professional help" doesn't exist |

**What would make this 9/10:** Adaptive playbook branching (the family
has income protection → skip the "apply for benefits" step, show the
"file your claim" step instead) and free-text context capture that
grounds the playbook in *this specific* crisis, not just *this type of*
crisis.

---

### Claim 5: "Neutral — no commission, no product recommendation"

**What's built:**
- Every detector's `reasoning_template` and `actions` field uses
  informational language: "this is an informational estimate," "consult
  a licensed insurance professional," "compare quotes from multiple
  insurers."
- SYSTEM_PROMPT explicitly prohibits: definitive advice, product/provider
  recommendations, naming or steering toward providers.
- Output guard on local inference (`withOutputGuard`): blocks volunteered
  provider names (Aviva, AXA, Vanguard, etc.), ungrounded numbers
  (any 3+ digit figure not in the prompt), and regulated-advice patterns.
- No affiliate links, no referral commissions, no insurance partner
  integrations.
- `billing-constants.ts`: Oak Plus at £7.99/mo — subscription revenue
  only.

**Score: 9/10 — structurally true and well-enforced.**

| Strength | Gap |
|---|---|
| The neutrality is enforced at three layers: YAML copy, LLM system prompt, and output guard — defense in depth | The claim is never stated to the user in-product; it's implied by the absence of product links, not explicitly communicated |
| Business model (subscription-only) structurally can't have commissions | No "how we make money" transparency page (LifeOS has one; Trustworthy doesn't need one because they're free) |
| Output guard blocks provider names even in local inference | Residual "Kairos" branding in email sender defaults and SMS copy undermines trust/identity |

**What would make this 10/10:** A visible neutrality badge or statement
on every protection-gap insight card: "Oak has no financial relationship
with any insurer. This analysis is based solely on your family's data."
Fix the Kairos branding residue.

---

## Part 2 — The Gap Map: What Weakens the Position

Gaps ordered by their impact on the competitive positioning — not by
engineering size, but by how much each one undermines the market claim.

### Critical gaps (the position doesn't hold without these)

| # | Gap | Weakens which claim | Why it matters competitively | Size |
|---|---|---|---|---|
| G1 | **Only 5 detectors / 13 rules** — a family finance product with no debt-ratio, tax, pension consolidation, beneficiary, or spending-pattern detection | Continuous detection | LifeOS's "Sage" conversation covers all these topics reactively; Origin's proactive checks cover 100+ dimensions. Oak's 13 rules are a proof of concept, not a moat. | M per detector (YAML + signal mapping) |
| G2 | **No in-product neutrality statement** — the single most defensible claim is invisible to users | Neutral | A family comparing Oak's insight against State Farm's AI or PolicyPilot's score has no reason to believe Oak is less self-interested unless told. | XS (copy) |
| G3 | **No time-based proactive nudges** — detection only fires on data change, never on the *absence* of expected change | Proactive intelligence | "You haven't updated your profile in 6 months" or "your child turns 18 in 90 days" are trivially implementable and would meaningfully increase the "always-on" claim. | S per nudge |
| G4 | **Residual Kairos branding** in email sender names, SMS copy, and SendGrid from-address defaults | Neutral, trust | A user receiving a "Kairos Studio" email from their "Agent Oak" family twin has reason to question who they're actually dealing with. | XS |

### Significant gaps (the position holds but is weaker than it should be)

| # | Gap | Weakens which claim | Why it matters competitively | Size |
|---|---|---|---|---|
| G5 | **Playbooks are static templates** — no adaptive branching based on what the family actually has (income protection? → skip "apply for benefits", show "file claim") | Crisis-native | ShockPlan (a hackathon project) already branches based on what you tell it. Oak has the data to branch *without asking* and doesn't. | M |
| G6 | **No free-text context capture during crisis** — Oak can't personalize beyond event-type + profile data | Crisis-native | The product-review council's #1 recommendation for Emergency Mode. "My spouse is at County Hospital, kids need pickup" is information Oak should capture and show to other family members. | M |
| G7 | **Scenarios are household-level only** — no per-member "what happens to *my* retirement" | Whole-family | The member twin exists, member readiness exists, but scenarios can't scope to a member. A second earner can't explore their own trajectory. | M |
| G8 | **No Open Banking live feeds** — detection runs on declared data only, not real account balances | Continuous detection, Proactive intelligence | Trustworthy "Next" has Gmail sync for documents; Oak has that too. But neither has live financial feeds. The first to get them has a detection advantage the other can't match from documents alone. | L (partnership-blocked) |
| G9 | **Youth financial literacy is thin** — age-banded lesson cards with no progression, gamification, or savings challenges | Whole-family | Nova Financial AI and Monia both pitch family financial education as a headline feature. Oak's youth twin is carefully designed (redacted, guardian-personed) but content-thin. | M |
| G10 | **No adaptive insight copy** — all insights use the same reasoning_template regardless of how many times the family has seen it, whether they've acted on it before, or what else changed | Proactive intelligence | The first time "your emergency fund is short" fires, it's valuable. The 5th time, it's noise. Origin's proactive system resolves or escalates; Oak re-fires the same template. | M |

### Latent gaps (not urgent but will matter in 6-12 months)

| # | Gap | Weakens which claim | Notes |
|---|---|---|---|
| G11 | **No Empathy-style post-crisis handoff** — the playbook ends with Oak's own checklist, no referral to professional support | Crisis-native | Empathy expanded to the UK in 2025. A natural partnership, not a build. |
| G12 | **No on-device inference for crisis flows** (PRD-113 scoped but not built) | Trust, differentiation | Still unclaimed by any competitor. The most sensitive flows (bereavement, disability) routing through a cloud LLM is a reasonable privacy concern for some families. |
| G13 | **No "explain this score" on the readiness score itself** — subscores are shown but the reasoning behind each (which rules fired, what data drove it) isn't exposed to the user | Proactive intelligence | PolicyPilot and CoverageGap.ai both show a score *with* the reasoning. Oak's readiness score is a number without a visible audit trail on the client side. |
| G14 | **`/assistant/simulate` doesn't expose multi-step `steps[]`** — only the persisted `/family/scenarios` routes do | Crisis-native | The conversational assistant can't do "what if I lose my job for 3 months, then get a new job at 80% salary?" in a single question. |

---

## Part 3 — The Innovation Flywheel

The flywheel is the self-reinforcing loop that makes Agent Oak
progressively harder to compete with. Every turn of the wheel makes the
next turn easier and more valuable.

```
                    ┌─────────────────────────┐
                    │   FAMILY DATA DEPTH      │
                    │   (more profile fields,  │
                    │    more documents, more   │
                    │    connected accounts)    │
                    └────────────┬────────────┘
                                 │
                    Data depth enables...
                                 │
                    ┌────────────▼────────────┐
                    │   DETECTION BREADTH      │
                    │   (more YAML detectors,  │
                    │    more rules, richer     │
                    │    signal types)          │
                    └────────────┬────────────┘
                                 │
                    More detections produce...
                                 │
                    ┌────────────▼────────────┐
                    │   INSIGHT VALUE          │
                    │   (more relevant,        │
                    │    personalized, timely   │
                    │    insights the family    │
                    │    acts on)               │
                    └────────────┬────────────┘
                                 │
                    Acted-on insights generate...
                                 │
                    ┌────────────▼────────────┐
                    │   TRUST & ENGAGEMENT     │
                    │   (family trusts Oak,    │
                    │    returns, updates       │
                    │    profile, uploads docs, │
                    │    connects accounts)     │
                    └────────────┬────────────┘
                                 │
                    Which feeds back to...
                                 │
                    ┌────────────▼────────────┐
                    │   FAMILY DATA DEPTH      │
                    │   (the cycle compounds)  │
                    └─────────────────────────┘
```

**Why this is defensible:** every turn of the wheel deposits data and
earned trust that a competitor can't replicate by copying features. A
family that has uploaded 12 insurance policies, built 3 scenarios, and
acted on 8 insights has an Oak that *knows them* — switching to LifeOS
or Trustworthy means re-entering everything and losing the detection
history. The flywheel's switching cost is the data + the trust + the
history, not the UI.

### Flywheel acceleration plan — sequenced by which turn they power

Each initiative is tagged with: the flywheel stage it primarily
accelerates, the gap it closes (from Part 2), and the competitive claim
it strengthens.

#### Turn 1 — Detection Breadth (the cheapest, highest-leverage turn)

New detectors are YAML files + signal mappings. The engine, delivery,
insight lifecycle, and approval gate already exist. Every new detector
is a marginal-cost addition with compounding value.

| Initiative | Gap closed | New detector(s) | Effort | Priority |
|---|---|---|---|---|
| **Debt-to-income ratio detection** | G1 | `family_debt_health`: high DTI (>36%), rising DTI trend (if cashflow entries exist) | S | P0 |
| **Beneficiary staleness detection** | G1 | `family_beneficiary_review`: policy `member_id` doesn't match current roster (member removed/role changed since policy added) | S | P0 |
| **Time-based proactive nudges** | G3 | `family_profile_hygiene`: no profile update in 6 months, child approaching age milestones (5/11/16/18), retirement target approaching | S | P0 |
| **Education fund pacing detection** | G1 | `family_education_pacing`: fund on-track at current contribution rate vs. needed rate (the math already exists in `scenarios/calculate.ts`) | S | P1 |
| **Policy overlap/duplication detection** | G1 | `family_policy_overlap`: two active policies of the same type covering the same member (common after switching and forgetting to cancel) | S | P1 |
| **Pension consolidation opportunity** | G1 | `family_pension_consolidation`: multiple small pension pots across members (when per-member pension data exists) — informational only, never "consolidate into X" | M | P2 |
| **Cashflow-based emergency fund trajectory** | G1 | `family_emergency_trajectory`: current savings rate → months to reach 6-month target (uses cashflow substrate, PRD-131) | S | P1 |

**Target: 12 detectors / 25+ rules within one development cycle.**
This alone moves Claim 1 from 7/10 to 8/10.

#### Turn 2 — Insight Value (making each detection more useful)

| Initiative | Gap closed | What it does | Effort | Priority |
|---|---|---|---|---|
| **Adaptive insight copy** | G10 | Track per-rule fire count per tenant; after 2 fires for the same rule+entity, escalate language from "consider reviewing" to "this is the Nth time Oak has flagged this" and include what changed since last fire | M | P0 |
| **In-product neutrality statement** | G2 | A visible badge/line on every protection-gap insight card: "Oak has no financial relationship with any insurer" | XS | P0 |
| **Readiness score explainability** | G13 | Expose the rules that drove each subscore on the readiness endpoint + a client-side "why this score" expandable section | S | P1 |
| **Adaptive playbook branching** | G5 | Playbook steps gain `condition` fields (same filtrex as detectors) — "skip if family has income_protection", "show if no will on file" | M | P1 |
| **Free-text crisis context** | G6 | A `context` field on `POST /family/life-events` stored with the event, displayed to other family members, fed to Ask Oak for grounded crisis Q&A | S | P1 |

#### Turn 3 — Trust & Engagement (making families return and deepen data)

| Initiative | Gap closed | What it does | Effort | Priority |
|---|---|---|---|---|
| **Kairos branding cleanup** | G4 | Replace all `kairos`/`Kairos Studio` defaults in SendGrid from-address, SMS copy, email HTML, and action-executor with `Agent Oak` / `oak@agentoak.com` | XS | P0 |
| **Member-scoped scenarios** | G7 | `member_id` on scenario inputs → compute against the member's earner slice + pension, not the household aggregate | M | P1 |
| **Youth literacy progression** | G9 | Track lesson completion per member; unlock age-appropriate next lessons; parent-visible progress | M | P2 |
| **Insight-to-action conversion tracking** | — | When a family dismisses + acts (e.g., uploads a new policy within 30 days of a protection-gap insight), attribute the action to the insight. Visible in the audit log + readiness score history. | M | P1 |
| **Multi-step in assistant** | G14 | Expose `steps[]` in `/assistant/simulate` so the conversational assistant can model regime changes ("job loss for 3 months, then new job at 80%") | S | P2 |

#### Turn 4 — Data Depth (making the twin richer)

| Initiative | Gap closed | What it does | Effort | Priority |
|---|---|---|---|---|
| **Open Banking read-only feeds** | G8 | Complete the PRD-133 AISP OAuth consent flow + scheduled sync; TrueLayer integration is already scaffolded | L (partnership) | P1 |
| **Beneficiary tracking on policies** | G1 | Optional `beneficiary_member_id` on `policies[]` — who each policy protects, not just who pays for it | S | P1 |
| **Annual profile review prompt** | G3 | A yearly "here's what changed since your last review" summary email with one-tap "confirm still accurate" or "update" — keeps data fresh without nagging | S | P1 |
| **Cashflow auto-categorization** | G8 | When Open Banking feeds land, auto-categorize transactions into income/expense/savings to replace manual `cashflow_entries` | M | P2 |

#### Turn 5 — Growth Loop (making the flywheel attract new families)

| Initiative | Gap closed | What it does | Effort | Priority |
|---|---|---|---|---|
| **Readiness quiz → signup conversion** | — | Quiz result page shows "you scored 62/100 — families like yours improved by 23 points in their first month" with a direct signup CTA | S | P0 |
| **Shareable readiness score card** | — | A branded, privacy-safe image (score + components, no personal data) for social sharing from the quiz result | S | P1 |
| **Detector-driven SEO content** | — | PRD-202's content engine: one explainer post per detector rule, cross-linked from insight cards and the marketing blog | M | P1 |
| **B2B2C positioning doc** | G11 | A one-pager for insurance carriers: "Oak prepares families before the claim; Empathy supports them after. Offer both." | XS (content) | P2 |

### Implementation status (October 2026 batch)

All P0 and P1 items above are shipped. Detector count went from 5 to 9
(`family_debt_health`, `family_policy_review` — covering beneficiary
staleness *and* policy overlap via `beneficiary_member_id` +
holder-composite entity keys — `family_education_pacing`,
`family_emergency_trajectory`), each with a `detector-evals/` golden
dataset at F1 = 1.0. Adaptive insight copy (G10), readiness drivers
(G13), free-text crisis context (G6), member-scoped scenarios (G7),
insight→action attribution, annual profile review, quiz CTA,
beneficiary field, and the Kairos branding cleanup are all live.
Quiz CTA uses factual benefits, not the invented "improved by 23
points" social-proof stat — we don't have that data yet. Remaining:
P2 items, Open Banking (blocked on TrueLayer partnership), detector
SEO content, and the shareable score card.

---

## Part 4 — The Flywheel Metrics

Each flywheel stage has a leading metric that tells you whether the
wheel is turning:

| Flywheel stage | Leading metric | Lagging metric |
|---|---|---|
| **Data Depth** | % of families with ≥3 policies recorded | Average fields-per-profile |
| **Detection Breadth** | # of detector rules that fired at least once this month | % of families with ≥1 open insight |
| **Insight Value** | Insight act-on rate (approve + prepare ÷ total surfaced) | Insight dismiss-without-action rate |
| **Trust & Engagement** | 30-day return rate (families who log in 2+ times in 30 days) | Monthly profile-update rate |
| **Growth Loop** | Readiness quiz → signup conversion rate | Referral code redemption rate |

**The compounding signal:** if Data Depth and Detection Breadth are both
growing but Insight Value (act-on rate) is flat or declining, the
detectors are producing noise, not signal. If Trust & Engagement is
growing but Data Depth isn't, families are returning but not deepening
their twin — the product is entertaining but not sticky.

---

## Part 5 — Competitive Response Playbook

What to do when a competitor makes a move:

| If... | Then... | Don't... |
|---|---|---|
| **Origin adds protection/insurance domain** to their proactive checks | Double down on crisis-native UX (playbooks, scenarios, Emergency Mode) — Origin's DNA is wealth management, not crisis readiness | Try to match Origin's 100+ daily checks across wealth/tax/investing |
| **Trustworthy ships gap detection** on top of their household data graph | Emphasize per-member reasoning + continuous re-evaluation (Trustworthy's model is household-aggregate, document-stored) | Compete on document organization — Trustworthy has years of UX investment there |
| **LifeOS drops to £50/mo** or adds a free tier | Lead with the detection engine + scenario simulation — LifeOS's value depends on conversations, Oak's value accrues silently | Compete on price (£7.99 is already value-priced; going lower signals low quality) |
| **An insurer ships a neutral-looking gap tool** | Make the neutrality claim explicit and visible in-product (G2); publish the business model ("subscription only, zero commissions") | Assume families will infer neutrality from the absence of affiliate links |
| **Empathy enters the pre-event space** | Explore partnership (Oak before, Empathy after) rather than competing; their B2B distribution is a channel, not a threat | Build grief counseling, bereavement support, or care-management features |
| **A competitor ships detect-before-declared** | Accelerate Open Banking integration and the unreported-life-change detection — this is the highest-stakes land grab in the category | Panic-ship a half-baked version; this feature needs trust-tier design more than speed |

---

## Part 6 — Summary: The Three Things That Matter Most Right Now

1. **Double the detector library (G1, Turn 1).** Every new YAML
   detector is marginal cost on existing infrastructure with compounding
   value. This is the single highest-leverage investment available — it
   turns the "continuous detection" claim from a 3-detector demo into a
   real moat. Target: 12 detectors / 25+ rules.

2. **Make the neutrality claim visible (G2, G4).** The most defensible
   positioning advantage is invisible to users. A one-line badge on
   protection-gap insights + fixing the Kairos branding residue is an
   afternoon of work that strengthens the one claim no funded competitor
   can copy without changing their business model.

3. **Ship time-based proactive nudges (G3).** The "always-on" claim
   requires that Oak contacts the family *even when nothing changed in
   the profile* — child age milestones, stale data, approaching
   retirement targets. These are trivial new detector rules
   (time-comparison conditions) that meaningfully increase the
   "proactive" surface without new infrastructure.

Everything else is important. These three are the ones where the gap
between the claim and the reality is widest, the fix is cheapest, and
the competitive consequence of *not* doing them is most acute.

---

## Appendix: Full Capability Inventory vs. Competitor Feature Matrix

| Capability | Agent Oak | Origin | Monarch | Trustworthy | LifeOS | PolicyPilot | Empathy |
|---|---|---|---|---|---|---|---|
| Continuous detection engine | ✅ 13 rules | ✅ 100+ daily checks | ❌ | ❌ | ⚠ conversation-initiated | ❌ one-shot | ❌ |
| Per-member reasoning | ✅ twin + readiness + scoped Ask Oak | ❌ household only | ❌ | ❌ | ❌ | ❌ | ❌ |
| Protection gap analysis | ✅ 5 rules | ⚠ (as part of broader checks) | ❌ | ❌ | ✅ GOV.UK-grounded | ✅ per-policy | ❌ |
| Emergency/crisis mode | ✅ 7 event types + playbooks | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ post-event |
| Scenario simulation | ✅ multi-step, time-shifted, persisted | ⚠ Monte Carlo for retirement | ❌ | ❌ | ❌ | ❌ | ❌ |
| Document ingestion + OCR | ✅ GPT-4o, policy extraction | ❌ | ❌ | ✅ Autopilot | ❌ | ✅ policy upload | ❌ |
| Digital estate vault | ✅ AES-256-GCM, client-side sealing option | ⚠ estate planning module | ❌ | ✅ (their core) | ✅ will guidance | ❌ | ✅ LifeVault |
| AI assistant grounded in real data | ✅ profile + insights + documents | ✅ multi-agent, 150+ tools | ✅ transaction-grounded | ✅ document Q&A | ✅ GOV.UK + memory | ❌ | ⚠ |
| Family-scoped (multi-user) | ✅ roster + invites + roles | ⚠ household-level | ✅ shared accounts | ✅ family members | ⚠ single household | ❌ | ❌ |
| Autonomous actions (Tier 2+) | ✅ approve-gated send_email, earned trust | ❌ (advisory only) | ❌ | ❌ | ❌ | ❌ | ❌ |
| Trust-tier discipline | ✅ codified 4-tier, approval gates, dry-run | ✅ SEC compliance | N/A | N/A | ⚠ "not advice" disclaimer | N/A | N/A |
| Open Banking / live feeds | ⚠ scaffolded, not live | ✅ Plaid/MX | ✅ Plaid/MX/Finicity | ❌ | ❌ | ❌ | ❌ |
| Mobile app | ⚠ PWA (installable, offline, push) | ✅ native | ✅ native | ✅ native | ❌ web only | ❌ web only | ✅ native |
| Neutral (no commissions) | ✅ structural | ❌ SEC-registered advisor | N/A | ✅ | ✅ (informational) | ❌ agent referral | N/A |
| Pricing | £7.99/mo | employer/DTC | $99–150/yr | free + premium | £100/mo | free | B2B |

# PRD-108: Life-event response playbooks

## Problem

Every detector Agent Oak has today is a static financial-ratio rule
(protection gap, emergency-fund adequacy, education shortfall, retirement
gap) evaluated against whatever the family last entered. None of them
represent a *declared life event* — a family has no way to tell Oak "I
just lost my job" or "my spouse died" and get a sequenced, personalized
response back. ARCHITECTURE.md's own roadmap already names this as the
next step after PRD-103 shipped: "extend 'prepare' beyond insights, e.g.
event-response checklists." This PRD is that step, turned into a scoped
build — not a new direction the roadmap hasn't already pointed at.

## Market bar

See [007](007-life-stage-and-crisis-response-research.md#life-events-are-the-part-a-static-age-only-model-misses).
Every researched crisis checklist (U.S. Bank, Prudential, Wells Fargo,
MoneyHelper) is generic — the same static PDF for every reader, with no
knowledge of *this* family's actual mortgage, actual policies, actual
emergency fund. Agent Oak's differentiated bar, matching 000's
"reasoning grounded in the family's real data, not templated advice":
a playbook that already knows the family has £0 income protection and a
£250k mortgage outstanding doesn't need to ask, and can open with the one
step that matters most for *this* household, not a generic step 1 of 12.

## Who it's for

Families mid-crisis, at the exact moment researched guidance says the
first-week decisions matter most and are also when people are least able
to research calmly — the entire premise behind "Oak knows what to do
next" in the product's own tagline.

## What "done" looks like

A new "Report a life event" entry point (home screen and Emergency Mode)
offering three event types for this PRD's scope: **job loss**,
**bereavement**, and **disability/critical-illness diagnosis** — chosen
because each maps directly onto data already in the financial profile
(`employment_status`, the family roster, `policies[].type`), so
personalization doesn't require new data collection to ship v1. Selecting
one opens a playbook: a sequenced checklist drawn from
[007](007-life-stage-and-crisis-response-research.md)'s researched steps,
with each step's copy interpolating the family's real numbers where
relevant (e.g. bereavement's "notify your insurers" step lists the
family's actual policies from `policies[]`; job loss's "calculate your
runway" step computes it from the real `emergency_savings_minor` and
`monthly_expenses_minor` already on file). Any step that involves outside
contact — "email your insurer," "notify your employer's HR" — offers the
existing `insight.prepare` draft-and-copy affordance from PRD-103,
reused rather than rebuilt.

## Trust tier

**Tier 0 for the playbook display itself** (rendering a personalized
checklist is pure Understand/Predict, same as any insight card). **Tier 1
where a step offers a draft** — identical posture to PRD-103, reusing its
exact mechanism: Oak drafts, a human copies or opens in their own email
client, nothing is ever sent from this app. This PRD introduces no new
trust tier and no new Act-layer surface; it's a new *presentation* of
Tier 0 data plus a new *entry point* into the already-shipped Tier 1
draft mechanism.

## Scope

1. New signal type `family.life_event` — user-declared (`event_type: 'job_
   loss' | 'bereavement' | 'disability'`, `reported_at`, optional
   `affected_member_id` referencing the family roster) — distinct from the
   existing threshold-based detector signals, since a life event is a
   fact the family reports, not a condition the engine infers.
2. Three playbook templates (content, not code — markdown or structured
   JSON checked into the repo alongside the detector YAMLs, in the same
   spirit as `detectors/family/*.yaml` being the source of truth for
   understanding), each step referencing the specific profile fields it
   personalizes with.
3. A playbook-rendering route/component that interpolates the family's
   real `family-financial-profile.ts` and `policies[]` data into the
   template at render time.
4. Wire eligible playbook steps to the existing `insight.prepare` action
   from PRD-103 (same backend action type, same LLM plumbing, same
   copy/`mailto:` exits — no send button, matching PRD-103's guardrail
   exactly).
5. Depends on **PRD-104** for one specific personalization: the
   bereavement playbook's "affected member" should be able to reference a
   specific earner's income/protection once per-member identity exists,
   rather than only the household total. Ship without it if PRD-104
   hasn't landed yet — degrade to household-level personalization, not a
   hard blocker.

Out of scope for this PRD: divorce, recession, aging-parent care, and
self-employed-income-shock playbooks (all four are drafted in
[007](007-life-stage-and-crisis-response-research.md) and are natural v2
candidates once the first three validate the mechanism); any
health-record storage for the disability/critical-illness playbook — it
personalizes against the family's existing *insurance* data
(`policies[].type === 'critical_illness'`), never collects or stores an
actual diagnosis or medical detail, keeping this squarely Tier 0/1
financial-domain territory rather than the GDPR special-category Health
domain ARCHITECTURE.md deliberately defers; any automatic detection of a
life event from other signals (e.g. inferring bereavement from a roster
member being removed) — v1 is explicitly user-declared only.

## Success metrics

- **Playbook completion rate** (steps marked done) among families who
  report a life event — the core value-delivery signal.
- **`insight.prepare` usage rate from within a playbook** vs. from a
  standalone insight card (PRD-103's existing metric) — tests whether
  crisis-moment context drives more action than routine insight browsing.
- **Time from event report to first playbook step completed** — a proxy
  for whether the "knows what to do next" promise is landing in the
  moment it matters, not days later.

## Acceptance criteria

- Reporting a job-loss event opens a playbook whose runway-calculation
  step shows the family's real emergency fund ÷ real monthly expenses,
  not a placeholder.
- Reporting a bereavement event opens a playbook whose "notify your
  insurers" step lists the family's actual policies from `policies[]` by
  provider and type.
- Reporting a disability event opens a playbook that correctly reflects
  whether `income_protection_monthly_minor > 0` and whether a
  `critical_illness` policy exists, changing its guidance accordingly
  (a family with cover in place gets "here's how to claim," not "here's
  why you need cover").
- Every "contact" step's draft affordance goes through the existing
  `insight.prepare` code path — the same no-send-path test PRD-103
  requires applies here with no new exception.
- No life-event playbook collects or persists a medical diagnosis, a
  cause of death, or any other health-record-shaped field.

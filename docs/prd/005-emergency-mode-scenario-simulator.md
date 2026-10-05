# PRD-005 (backfill): Emergency Mode / "What If?" scenario simulator

*Retroactive PRD. See [001](001-family-onboarding-twin-graph.md) for the
template note. Flagged as the product's strongest differentiation
candidate — see market bar below.*

## Problem it solves

"When life doesn't go to plan, LifeKeel knows what to do next" is the entire
tagline. Most financial tools show you a dashboard; none of them let you
rehearse the bad day before it happens. This feature is the tagline made
literal — pick a situation (job loss, medical emergency, a death in the
family), see the household's actual response plan against its own real
data, not a generic checklist.

## Market bar

See [000](000-market-landscape-and-positioning.md) — this is the one
finding from market research worth restating here: a targeted search for
a consumer "family digital twin" or scenario-rehearsal product returned
nothing comparable. "Digital twin" is currently enterprise-finance
jargon (Capgemini, TCS write about corporate risk-scenario modeling, not
consumer products) for testing "what if" scenarios against live data
before risks materialize — which is structurally exactly what this
feature does, just aimed at a family instead of a balance sheet. **This is
not a feature to bring up to parity with competitors — it's the one place
LifeKeel is ahead of the category**, and should be resourced and
marketed accordingly (see PRD-201).

## Who it's for

Two moments: a curious new user exploring "Events" out of general anxiety
about being prepared, and a family mid-crisis (job loss just happened)
looking for what to do *right now*.

## What's shipped

An `/events` ("What If?") page listing 10 scenarios (family member passed
away, medical emergency, car accident, travel emergency, home damage, lost
job, new child, marriage, university, retirement). Verified live: clicking
"Retirement" surfaces a real "Family Readiness" percentage, an "Actions to
Take" checklist, and an "AI Explains" section that pulls the tenant's
*actual* detector-generated insight ("No retirement savings are listed in
your family profile...") — not a generic scenario description. Each
scenario page is explicitly labeled "This is a simulation... your family's
real data stays private and is never shared," and includes an "Ask AI
About This" link into the assistant (currently hardcoded — PRD-101 closes
that gap for this surface specifically).

## Trust tier

**Tier 0 — pure simulation.** No action is taken; the entire feature is
"rehearse, don't act." The landing page's own sample content already
reinforces this framing before signup ("This is what Emergency Mode hands
you — not a score, a checklist").

## Gaps to reach world-class

- **Only 4 of 10 scenarios have real detector backing** (retirement,
  and presumably the ones tied to protection-gap/emergency-fund/education
  detectors) — the other scenarios (car accident, travel emergency, home
  damage, marriage, new child) have no corresponding Family Twin domain or
  detector yet, so they likely render generic/sample content today. This
  is the strongest argument in this whole PRD set for *why* PRD-102
  (Protection) matters beyond its own merits — every insurance-adjacent
  scenario in this list (car accident → auto insurance, home damage →
  home insurance, travel emergency → travel insurance) is currently
  unbacked and becomes real the moment Protection ships as a domain.
- **Static scenario list, not personalized.** Every household sees the
  same 10 scenarios regardless of what's actually relevant to them (a
  childless couple still sees "New child" with equal prominence to
  "Lost my job"). A world-class version ranks or filters scenarios by
  relevance to the household's actual composition and profile.
- **No re-entry hook.** Nothing brings a user back to a scenario after
  their first visit — no "your readiness for this changed" notification
  when underlying data updates. Given this is the flagship differentiator,
  it's the highest-value place to invest in a retention loop once
  detectors run continuously (PRD-002's gap).

## Success metrics

- **Scenario engagement rate** (% of active users who visit `/events` at
  least once, and how many scenarios per session) — the leading indicator
  for whether this differentiator is actually being discovered and used,
  not just shipped.
- **Real-data vs. sample-content ratio per scenario** — track which of the
  10 scenarios render genuine detector-backed content vs. generic
  copy, as a direct measure of the gap above closing over time as more
  domains ship.
- **Scenario → assistant handoff rate** ("Ask AI About This" click-through)
  — this is the bridge to PRD-101; a high handoff rate with a low-quality
  hardcoded answer on the other end is actively wasting the interest this
  feature generates.

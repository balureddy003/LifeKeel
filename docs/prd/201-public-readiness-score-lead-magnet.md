# PRD-201: Public Family Readiness Score — the detector engine as a growth loop

## Problem

Agent Oak's landing page already leads with a category-education stat
("Only 30% of U.S. households have the documents they'd actually need
ready for an emergency, per FEMA's 2023 National Household Survey") but
has no interactive way to let a visitor find out *their own* number before
signing up. Every top-of-funnel asset in this category (Policygenius'
life-insurance calculator, Ladder's coverage calculator) is exactly this
mechanic — a free, no-signup calculator that produces a personal number
and a reason to come back. Agent Oak has something those calculators
don't: a real multi-rule detector engine already computing exactly this
kind of score for logged-in users. This PRD reuses it, publicly, instead
of building a second, disconnected marketing quiz.

## Market bar

See [000-market-landscape-and-positioning.md](000-market-landscape-and-positioning.md).
Ladder and Policygenius' calculators are single-purpose (life insurance
only) and one-shot. A "Family Readiness Score" spanning protection,
emergency fund, and retirement — the same three domains the real product
already evaluates — is a wider, more shareable hook than either
competitor's single-number tool, and it's *authentic*: the number a
visitor sees pre-signup is produced by the same rules engine, not a
simplified marketing-only approximation that then disappoints once they
see the real product.

## Who it's for

Cold-traffic visitors from SEO/content/social who aren't ready to create
an account but will answer 5-6 quick questions for a personalized number —
the emergency-fund-adequacy and protection-gap detectors' inputs
(household income, savings, mortgage, dependents) are already exactly
this shape.

## What "done" looks like

A public, unauthenticated, no-signup quiz (`/readiness` or similar) asking
5-6 questions that map directly to the real `family_financial_profile`
schema's highest-signal fields (monthly salary, emergency savings, monthly
expenses, mortgage outstanding, life cover, dependents). On submit, the
answers run through the **exact same** `@agentoak/engine` detector
evaluation used by real accounts (protection-gap and
emergency-fund-adequacy rules at minimum — retirement/education need more
inputs than a quick quiz should ask for) via a new stateless, anonymous
endpoint — no `tenant_id`, nothing persisted server-side beyond an
aggregate/anonymized event. The result page shows a readiness score and
1-2 real `reasoning` strings from the actual rules that fired, styled the
same way the real Home dashboard shows them, with a clear "this is based
on 2 of Oak's 6 signals — see your full picture" CTA into signup.

## Trust tier

**Tier 0.** Pure calculation over ephemeral, user-supplied input; nothing
is stored against an identity, nothing is sent anywhere.

## Scope

- **Backend**: a new unauthenticated route (added to the existing
  `open` routes allowlist in `server.ts`, same pattern as
  `/growth/events`) that accepts the quiz answers, maps them to the
  `family_financial_profile` shape, and calls `engine.evaluate()`
  directly — reusing the detector YAML, not re-implementing the rules.
  Explicitly do not persist the submitted answers tied to any identifier;
  log only the anonymized score band (e.g. "60-70") as a `growth_events`
  entry for funnel analysis, extending the existing
  `KNOWN_EVENTS` allowlist in `growth-events.ts` (e.g.
  `readiness_quiz_completed`).
- **Frontend**: a new public page in `apps/web`, reusing the existing
  score-ring/insight-card components from Home so the quiz result *looks*
  like a preview of the real product, not a separate marketing widget.
- **Out of scope**: retirement/education questions (too many inputs for a
  quick quiz — protection-gap and emergency-fund-adequacy alone are enough
  for a compelling, accurate result); any lead-capture email gate before
  showing the score (show the score first, ask for signup after — gating
  the number itself would undercut the entire "authentic, not a teaser"
  positioning this PRD is built on).

## Success metrics

- **Quiz completion rate** (started → saw a score) and **quiz → signup
  conversion rate** — the two funnel numbers that justify the feature's
  existence.
- **Score-band distribution** — if the anonymous quiz consistently
  produces very high scores, either the questions are too easy or the
  targeting is wrong (visitors who don't need the product); a healthy
  distribution should skew toward "some gaps found," matching the FEMA
  stat's framing.
- **Organic/content-driven share of quiz starts** — this feature only pays
  off as a growth loop if it's actually being found via SEO/content
  (PRD-202) and social sharing, not just internal nav clicks from people
  already on the landing page.

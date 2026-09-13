# PRD-001 (backfill): Family onboarding and the Twin graph

*Retroactive PRD — documents a shipped feature against the same template
used for forward-looking work, so the full product surface is legible in
one place. "What's built" is verified; "gaps to reach world-class" is new
product-owner analysis, not implemented.*

## Problem it solves

A family's first five minutes decide whether they trust Oak with anything
real. A form with 20 fields loses people before they see any value; no
structure at all means Oak never actually has a family graph to reason
over. The product needs a way to build the Family Twin's people domain
(ARCHITECTURE.md's first of six domains) that feels like a conversation,
not paperwork.

## Market bar

See [000-market-landscape-and-positioning.md](000-market-landscape-and-positioning.md).
Trustworthy is the closest competitor with a genuine family-wide (not
single-user) model. Most AI money apps (Monarch, Copilot) onboard around a
single user's linked accounts, not a household graph — Agent Oak's
conversational, visibly-growing-graph onboarding is closer to the bar this
category should be held to than what most competitors actually ship.

## Who it's for

Every new signup, in the 2 minutes between account creation and their
first look at Home.

## What's shipped

A chat-style flow (verified live this session) that asks name, marital
status, partner's name, children, building a visible family graph node by
node as each answer lands — "Nice to meet you, Alex! Let's build your
family graph," progress bar ticking 0%→100%. Backed by
[family-group.ts](../../apps/api/src/routes/family-group.ts), which
persists the roster (member name, role — Organizer/Parent-Guardian/Child —
relationship). Settings additionally supports an "Experience Mode" per
member (Organizer/Parent/Adult/Child/Elderly — each with different
financial-data visibility and language complexity) and family invites via
a 6-character code.

## Trust tier

N/A — pure data collection, Tier 0 by construction (no detectors run
until the financial-profile step, a separate flow).

## Gaps to reach world-class

- **No birthdates.** `apps/web`'s own Life Timeline card says it outright:
  "We don't collect birthdates yet, so we can't estimate education
  milestones for your children." This silently breaks the connection
  between the People domain and the Education-shortfall detector's
  `years_remaining`/`child_age` inputs, which currently have to be entered
  a second time, manually, in the financial-profile flow — the exact
  "asking a family to fill out forms twice" failure the data-intake
  principle warns against. Adding a birthdate question to onboarding
  (optional, skippable) and threading it through to auto-populate the
  education-fund step is the single highest-leverage fix to this feature.
- **Experience Mode is built but under-leveraged.** A "Child: no money
  shown" mode already exists in Settings, but nothing in onboarding
  itself adapts — the conversational flow is identical regardless of who's
  answering. A world-class version asks "who's setting this up?" early and
  tailors both onboarding copy and the resulting default Experience Mode.
- **The graph is currently people-only.** ARCHITECTURE.md names five more
  domains (health, protection, life/assets, context, preferences) the
  Twin should eventually cover — onboarding is the natural place to plant
  the *seeds* for those (e.g., "any pets or property?") even before the
  domains have real detectors, the way Trustworthy's onboarding already
  asks about property/vehicles/pets as first-class objects.

## Success metrics

- **Onboarding completion rate** (started chat → reached Home) — the
  primary activation metric; the whole point of the conversational,
  visibly-growing-graph design was to beat a static form's drop-off, so
  this should be benchmarked against a plain-form control if one is ever
  tested.
- **Time-to-first-insight** — onboarding → financial profile → first
  detector-generated insight. This flow currently requires a second,
  separate form (financial-profile); shortening that gap is more valuable
  than polishing onboarding in isolation.
- **% of households with a completed member roster (partner + all
  children named)** vs. solo signups who never add anyone — a proxy for
  whether "family" framing is landing or people are using this as a
  single-user budgeting app with extra steps.

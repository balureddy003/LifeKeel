# PRD-006 (backfill): Keel Plus billing

*Retroactive PRD. See [001](001-family-onboarding-twin-graph.md) for the
template note.*

## Problem it solves

The product needs a monetization mechanism that maps to real value
delivered, not a paywall on core safety information — free-tier
protection-gap detection shouldn't be held hostage for revenue, but AI
document extraction and inbox summarization (compute-cost-bearing
features) reasonably can be.

## Market bar

See [000](000-market-landscape-and-positioning.md). This is a standard
freemium SaaS pattern, not a differentiation opportunity — the bar here is
"don't get this wrong," not "be novel." Money apps in this category
(Monarch, Copilot) gate around account-linking limits or advanced
budgeting; LifeKeel's gate (AI extraction + inbox summaries) is a
reasonable, defensible choice already, since it keeps every safety-net
detector (protection gap, retirement gap, etc.) free.

## Who it's for

Households who've hit the free tier's ceiling — stored-but-not-extracted
documents, sample-only inbox summaries — and are deciding whether the
paid tier is worth it.

## What's shipped

Stripe-backed billing ([billing.ts](../../apps/api/src/routes/billing.ts)),
gating AI document extraction (PRD-003) and inbox AI summaries (PRD-004)
behind "Keel Plus." ARCHITECTURE.md itself currently labels this
"dormant" — present in the codebase, registered as a route, but per
`SECURITY.md`'s deployment notes, `apps/web` isn't yet pointed at this
repo's own `apps/api` in production, so no real subscriptions exist yet.

## Trust tier

N/A — billing, not agentic. The one place this PRD set intersects a real
irreversible-action concern is refunds/chargebacks, which is out of scope
here and should stay a human-operated process regardless of how much else
in the product becomes automated.

## Gaps to reach world-class

- **The gate doesn't yet cover PRD-102's Protection domain or PRD-103's
  Tier 1 drafts** — as those ship, a monetization decision is needed for
  each: is policy-document OCR extraction part of the existing "Keel Plus"
  tier (likely yes, same mechanic as PRD-003), and are Tier 1 prepared
  drafts (PRD-103) free or paid? Given drafts are LLM-cost-bearing the
  same way extraction and inbox summaries are, the consistent answer is
  to fold them into the existing tier rather than inventing a third
  pricing dimension.
- **No visible value-preview before paywall.** Verified live: the free
  tier's copy is honest ("Upgrade to have AI extract the key details...")
  but doesn't show what a *specific* extracted document would have looked
  like — a "here's what Plus would have found in this document" preview
  (even a blurred/redacted one) is a well-established conversion pattern
  this feature doesn't use yet.
- **Pricing/plan structure isn't verifiable from the code alone** — this
  gap analysis is scoped to what's inspectable in `apps/api`; an actual
  pricing-tier PRD needs input from whoever owns Keel Plus's commercial
  terms, not just the engineering surface.

## Success metrics

- **Free → paid conversion rate**, segmented by which gated feature
  triggered the upgrade (documents vs. inbox) — this tells you which paid
  feature is actually pulling its weight and which might need the
  value-preview treatment above.
- **Time-to-first-paywall-hit** — how long a household uses the free tier
  before encountering a gate, as a proxy for whether free-tier value
  (detectors, onboarding, scenario simulator) is generous enough to build
  trust before asking for money, matching the landing page's own framing
  ("Free to start · No credit card").
- **Churn rate on Keel Plus** — since this is currently dormant with no
  real subscribers, this metric doesn't exist yet; flagging it here so
  it's tracked from day one once production billing goes live, not added
  retroactively after a churn problem is already visible.

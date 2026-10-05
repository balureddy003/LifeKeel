# PRD-202: Detector-driven content engine

## Problem

`blog.ts` already exists as a real markdown CMS (categories: product,
tutorial, case-study, news) but nothing systematically feeds it. Content
marketing in this category runs on exactly the kind of specific,
credible claim LifeKeel's detectors already produce as their normal
output — "a family with £0 life insurance and a £250k mortgage is
underinsured by roughly £450k" is a stronger, more citable hook than
generic advice, and it's already sitting in `reasoning_template` strings
in `detectors/family/*.yaml`, written by whoever wrote the detector, for
a completely different purpose.

## Market bar

See [000-market-landscape-and-positioning.md](000-market-landscape-and-positioning.md).
Policygenius' content strategy is built entirely on this pattern —
specific, numbers-driven explainers ("What Is a Life Insurance Coverage
Gap?") that rank on the exact question a worried visitor searches. Agent
Keel has a structural advantage Policygenius doesn't: six (soon more, per
PRD-102) detector rules that already encode the *logic* of these
explainers as executable YAML, not just prose someone has to keep
separately in sync with the product.

## Who it's for

Two audiences: SEO/organic visitors searching a specific worry ("how much
life insurance do I need with a mortgage"), and PRD-201's quiz-takers who
want to understand *why* a specific rule fired on their result.

## What "done" looks like

A lightweight, repeatable process — not full automation — where each
detector rule has a companion blog post explaining its logic in plain
language, cross-linked from the rule's `reasoning_template` output
wherever it's shown (the real Home dashboard, PRD-201's public quiz
result, and PRD-103's future draft-message context). Six rules today
(protection-gap ×2, emergency-fund, retirement-gap, education-shortfall
×2) means six starter posts — not a large content backlog, deliberately,
so this stays proportionate to what the product actually does rather than
promising more topics than there are real detectors behind them.

## Scope

- **Content**: one post per detector rule, each opening with the same
  category-education framing the landing page already uses (a cited
  stat, then "here's exactly how Keel checks this for your family") and
  ending with a link into PRD-201's quiz.
- **Product surface**: a `learn_more_url` field on each detector rule's
  YAML (or a lookup table keyed by `rule_id`) that the insight card UI
  (Home, `/events` scenario pages) can link out to — so a real logged-in
  user seeing "no income protection policy" gets the same explainer a
  cold-traffic visitor would, closing the loop between marketing content
  and in-product education instead of maintaining them separately.
- **Case studies**: `blog.ts`'s existing `'case-study'` category is the
  natural home for anonymized, aggregate patterns once there's real usage
  data (e.g., "X% of households who complete the financial profile
  discover a protection gap they didn't know about") — explicitly gated
  on having real, privacy-safe aggregate numbers to cite, not written
  speculatively ahead of that data existing.
- **Out of scope**: auto-generating blog content from detector YAML via
  LLM at publish time (the reasoning strings are precise and
  numbers-correct *for one household's insight*; a good explainer article
  needs a human editorial pass, not a template expansion — keep the
  content quality bar above what the in-product `reasoning_template` bar
  needs to be).

## Success metrics

- **Organic search sessions landing on detector-explainer posts**, and
  their **explainer → quiz (PRD-201) → signup** conversion rate — the
  full funnel this content is meant to feed.
- **In-product `learn_more_url` click-through rate** on real insight
  cards — validates whether the same content pays off for existing users
  too, not just cold-traffic acquisition.
- **Content-to-detector coverage ratio** — track that every shipped
  detector rule has a matching post (currently 0 of 6); this is a
  completeness metric more than a growth one, but it's what keeps this
  PRD's scope honest as PRD-102 adds more rules.

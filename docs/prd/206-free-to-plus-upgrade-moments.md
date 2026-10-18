# PRD-206: Free → Keel Plus upgrade moments and honest trial

## Problem

Keel Plus (£7.99/mo) adds AI document and email reading (PRD-006, PRD-003,
PRD-004). The risk is the upgrade prompt being triggered by a risk alarm, which
reads as extortion, or a trial that ends in resentment. Free users also have no
view of what automation would have saved them.

## Who it's for

Free-tier users with at least one detector gap caused by **missing data** rather
than a real shortfall, on any device.

## What "done" looks like

1. An upgrade prompt appears only when parsing would close a data gap, for example
   "3 items could be filled in from your email". It is never attached to a risk
   alert and never uses fear framing.
2. A 14-day trial with an end-of-trial summary of what Plus read and what it filled
   in, shown **before** the first charge, with the exact date and amount.
3. Cancel is two taps from settings and works the same on web, PWA and the native
   shell. (Apple and Google billing rules for the shell must be checked before any
   in-app purchase flow; web-only checkout may be the right v1.)
4. Downgrade keeps everything already extracted; only new automation stops.

## Constraints

- **Trust tier:** 0, and billing is not an autonomous action. The user starts and
  confirms any subscription.
- **Regulated-advice check:** prompts describe data on file, never a product to buy.
- **Data/privacy:** the prompt is computed from field-completeness metadata, not by
  reading documents or email to decide whether to show it.

## Builds on

PRD-006 (Stripe-backed tier, dormant pending production cutover), PRD-145
(freshness and completeness signals), PRD-143 and PRD-144 (the automation being sold).

## Success metrics

Trial start rate from the prompt; trial → paid; month-3 and month-6 retention of
paying users with and without logins; refund and complaint rate.

## Out of scope

Pricing changes, annual plans, promotional discounts, any commission-bearing offer.

## Open questions

Whether the native shell may offer web checkout under current store rules, or must
use store billing. Resolve before building step 3 for the shell.

## Becomes

docs/prd/206-free-to-plus-upgrade-moments.md

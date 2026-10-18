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

## Amendments from the October 2026 market review

See [prd-set-market-review-2026-10.md](../reviews/prd-set-market-review-2026-10.md)
for evidence quality. Numeric defaults below are hypotheses to test, not benchmarks.

1. **Law.** The UK subscription regime in the DMCC Act is reported as not yet in force
   (expected spring 2027; secondary source, counsel to confirm), while the CMA's
   direct consumer enforcement has applied since April 2025. Build to the expected
   2027 standard now and describe it as "designed to meet", never "compliant".
2. **Trial design for v1:** no-card trial, a reminder around day 11 showing the date
   and amount, one-click cancel from settings.
3. **Trigger copy must be literally true.** "3 items could be filled in from your
   email" cannot hold for a user with no mailbox connected, and completeness metadata
   cannot predict what a mailbox contains. Use "N empty fields Plus can read from
   documents you add".
4. **Frequency:** at most one prompt per 14 days, a 60-day snooze after dismissal, and
   never alongside a risk alert.
5. **Shell checkout.** Apple's rules allow link-outs to non-in-app purchase without an
   entitlement only on the US storefront, and no UK entitlement was found. v1 is web
   checkout only, with no purchase button or price in the native shell. "Cancel works
   the same in the shell" is only true while subscriptions are bought on the web.
6. **Measurement.** Trial-to-paid cannot be tested at this scale. Use before and after,
   with a 10% never-prompted holdout.
7. **Open:** the competitive review argues for a pricing and packaging test and for
   dropping "annual plans out of scope". That is a product decision; see the review.
8. **Gate:** do not ship before PRD-006 cutover. Billing is dormant today.

## Becomes

docs/prd/206-free-to-plus-upgrade-moments.md

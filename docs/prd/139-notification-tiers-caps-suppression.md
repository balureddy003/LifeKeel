# PRD-139: Notification tiers, family-level caps, and suppression

## Problem

`DeliveryRouter` applies an urgency floor, quiet hours and dedup **per insight**.
Nothing limits how many messages a family receives across insights, heartbeats,
renewal reminders and nudges, so each feature is polite on its own and the family
can still be over-messaged. Notification fatigue is the fastest route to uninstall
for a product whose promise is calm.

## Who it's for

All adult members, on all channels.

## What "done" looks like

1. Every outbound message is assigned one tier:

   | Tier | Trigger | Cap |
   |---|---|---|
   | A: change alert | A detector crosses a threshold, or a dated obligation is near | at most 1 per 14 days per family |
   | B: digest | PRD-138, fixed day | 1 per month, exempt from the budget |
   | C: data needed | A detector cannot run because an input is missing or stale | at most 2 per quarter |
   | D: life-event prompt | Profile signal (new child, move, job change) | in-app only, opt-in |

2. A **global budget** across A, C and D (default: 2 non-digest messages per month
   per family) enforced in one place, with the dropped messages recorded.
3. **Suppression:** after two consecutive unopened A or C messages the member drops
   to digest-only, and is told in the next digest and in settings. A visible
   "digest only" setting exists from onboarding.
4. A message that is not a change, a confirmation or a decision is not sent.
5. Quiet hours and timezone are respected for push; informational content never
   uses push.
6. Critical, safety-relevant items (for example a continuity-check alert, PRD-130)
   are exempt from the cap but never from quiet-hours rules unless already defined
   there.

## Constraints

- **Trust tier:** 0.
- **Regulated-advice check:** unchanged; this PRD only decides whether to send.
- **Data/privacy:** budget and suppression state store counts and timestamps, not
  message content.

## Builds on

`apps/api/src/delivery/delivery-router.ts` (urgency floor, quiet hours, dedup, digest
mode), PRD-111, PRD-127, `policy-renewal-reminders`, PRD-138.

## Success metrics

Notification-driven unsubscribe and uninstall rate; share of members on digest-only;
open rate of A and C messages (a falling rate triggers suppression review).

## Out of scope

Marketing and campaign email (operator control plane), SMS and WhatsApp channel
changes.

## Open questions

Whether the budget is per family or per member. Default: per member, because
members open different messages; revisit after the first month of data.

## Becomes

docs/prd/139-notification-tiers-caps-suppression.md

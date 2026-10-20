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

## Amendments from the October 2026 market review

See [prd-set-market-review-2026-10.md](../reviews/prd-set-market-review-2026-10.md)
for evidence quality. Numeric defaults below are hypotheses to test, not benchmarks.

1. **Numbers are hypotheses.** "1 per 14 days", "2 per month", "2 per quarter" and "two
   unopened" have no supporting evidence found. Treat them as starting values and log
   what each one drops.
2. **Never demote dated obligations.** Renewal reminders at 30, 14 and 7 days already
   exceed the Tier A cap on their own. Critical and dated-obligation messages are
   exempt from the cap and from silent demotion.
3. **Ask before demoting.** Offer "switch to digest only?" rather than doing it
   silently, and record every dropped message with its reason.
4. **Use clicks, not opens.** Apple Mail Privacy Protection makes opens unreliable
   (inference), so suppression keys off clicks and explicit responses.
5. **Resolve the per-family versus per-member contradiction:** the budget is per
   member, because members act on different messages.
6. **Two facts in the code to fix:** quiet hours use the server clock rather than the
   family's timezone, and the heartbeat bypasses `DeliveryRouter`, so a "single place"
   budget needs the heartbeat routed through it or counted by it.
7. **Consent and legal basis per channel** (see PRD-140) and the cap logic apply to
   service messages only; marketing is out of scope.

## Status (first build)

Built: one decision point (`delivery/notification-budget.ts`) with a `notification_ledger`
of tier, kind, outcome, reason, key and time (no content). Tier A at most 1 per 14 days;
Tier C at most 2 per quarter and never the same input twice in one; 2 non-digest messages
per month across A, C and D; Tier D never sent outbound. Critical alerts, dated
obligations (renewal reminders), safety messages and organizer-released alerts are
exempt and logged; the digest is exempt and counted. `DeliveryRouter.deliver()` asks the
budget, and a held-back alert goes to the digest queue with the drop recorded. The
heartbeat and Quiet Care digest are counted as Tier B.

Demotion is ask-first and click-based (amendments 3 and 4): after two consecutive
unanswered A/C alerts (no signed-in click, no approve/dismiss within 7 days) a pending
"digest only?" offer appears in Settings and as one line in the next digest. Yes sets
digest mode; no is remembered for 90 days; nothing changes silently. Alert links carry
`?src=alert&i=<insight>`. Held-back counts by reason appear in the operator retention card.

Budget scope is per tenant, not per member (amendment 5), because delivery preferences and
channels are tenant-level today.

Not built: Tier C sending (rules and tests exist; copy and push payload belong with PRD-140),
timezone-aware quiet hours, a per-member budget, "informational content never uses push",
telling people about digest-only during onboarding, and counting the directly-sent
continuity, checklist and vault reminder emails. The numbers are hypotheses and the
ledger exists to read back what each drops.

## Becomes

docs/prd/139-notification-tiers-caps-suppression.md

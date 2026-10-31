# Channels and use cases for a frictionless, high-value LifeKeel (October 2026)

Date: 30 October 2026. Companion to
[brief-platform-pivot-and-scale-2026-10.md](brief-platform-pivot-and-scale-2026-10.md),
[Intent 83](../intents/83-friction-budget-and-zero-connection-first-value.md) and
[PRD-230](../prd/230-friction-budget-and-zero-connection-first-value.md). Source: the
product owner's "LifeKeel roadmap summary" document and its use-case ranking.

> Competitor comparisons here rest on the competitors' own marketing pages. Admini's
> and SafeKeep's pages did not load in full. Run a proper teardown before claiming a
> gap in public.

## How the two halves fit

The direction is frictionless and high value. These look opposed, because the most
valuable use cases need a continuous, multi-mailbox feed, which is effort. They fit as
two layers of one number:

- **Front door (frictionless):** a brief link opens a real result in under a minute
  with no connection and no sign-up. This is what every channel sends.
- **Depth (high value):** the feed finds what the household did not know it had, and
  improves the same number. This is the reason to stay, and the reason to pay.

No use case below may be a prerequisite for the front door.

## Use cases, strongest first

Friction cost is the effort asked of the household before value: **none** (no
connection), **low** (one connection, once), **medium** (several connections or a
consent step), **high** (needs another person's consent or a legal review).

| # | Use case | Why only LifeKeel | Trust tier | Advice-line risk | Friction | Cheapest first test | Becomes |
|---|---|---|---|---|---|---|---|
| 1 | **Employer cover blind spot.** Death-in-service, income protection and health cover found in work email or an HR portal; on a job change, a notice that cover may end with the employment. | Rivals rely on the user already knowing what they have. | 0 | Low. Say "cover on file may end with the job". Never what to buy. | Medium (work mail needs a forwarding address or confirmed opt-in) | Run it on the founder's own inbox; add the cover found to the existing job-change brief's recorded-cover field. | [Intent 84](../intents/84-employer-cover-blind-spot.md) |
| 2 | **Household single-point-of-failure map.** Whose name each policy is in, whose card pays, whose phone gets codes and renewal notices; "if one adult is out for six weeks, what stops, and when?" | Nothing in the competitor scan does this. | 0 | Low | Low once data exists; none if entered by hand | Mock one screen and show it to five parents. | [Intent 85](../intents/85-household-single-point-of-failure-map.md) |
| 3 | **One-tap claim packet.** Contact, policy number, drafted message and papers ready for the household to send. | Most tools stop at storing the document. | Prepare-only (PRD-103); sending stays with the household | Medium. The draft goes to the household's **existing** provider only. | Medium | One policy type end to end. | [Intent 86](../intents/86-claim-packet.md) |
| 4 | **Parent mode.** An adult child holds a parent's file with the parent's consent: papers, power-of-attorney status, who to call. | Finding a parent's papers is the pain nobody serves. | 0 | Low | High (consent design; overlaps PRD-229) | Landing page plus five interviews. | [Intent 89](../intents/89-parent-mode.md), blocked on PRD-229's safeguarding review |
| 5 | **Beneficiary check.** Pension and policy nominations compared with the current family; an ex-partner still named or a new child missing is flagged, with a link to the provider's form. | Needs several sources reconciled. | 0 | Medium. Flag and link only; never "change it to X". | Medium | Flag mismatches from entered data. | [Intent 87](../intents/87-beneficiary-check.md) |
| 6 | **Change detection over time.** Last year's renewal beside this year's; a stopped payment signals a possible lapse. | Needs continuous data, not a one-off upload. | 0 | Low | Medium | Extend the premium-increase rule to a stopped-payment signal. | [Intent 88](../intents/88-lapse-and-change-detection.md) |
| 7 | **Staged emergency access.** The right adults open the right papers at the right time. | Combines consent, timing and provenance. | Touches Tier 2 or 3 | High. Releasing papers on a trigger is an irreversible action. | High | Attorney review and a prototype. | [Intent 90](../intents/90-staged-emergency-access.md), **parked.** Needs an approval gate and counsel before any design. |

**Best depth demo:** 1 + 2 + 3 together — employer cover found, the risk map, the claim
packet — shown after the front door, never before it.

### Smaller ideas from the same research

Value ledger (found vs confirmed saved), waste finder (subscriptions, price creep, deals
ending), life-event playbooks, old pension tracing prompt, 48-hour dependants kit,
data-access requests to find forgotten accounts. Each keeps its own intent. The cheapest
first test and phase for each are in the owner's roadmap summary; none is promoted here.

## Channels

| Channel | Who pays | Front-door version | Measure (replaces "finish setup") | Advice-line and legal notes |
|---|---|---|---|---|
| **Advisers, brokers, will-writers, accountants** ([Intent 91](../intents/91-adviser-and-employer-brief-link-pilot.md)) | The professional, per seat or per client | The professional sends a brief link; the client sees a real result with no sign-up. | Time to first number; share of clients whose second adult confirms. Pilot: five contacts, ten clients each. | The link carries LifeKeel's factual numbers only. No commission, no placement fee, no product named. Their compliance teams will review wording (PRD-207); get counsel's view first. |
| **Employers** | The employer, per head, as a staff benefit | A life-event brief (job change, new baby) the employee runs privately. | Time to first number; share of staff who finish a brief. | The employer never sees figures (Stage 3 employer seat). Slower to close, larger contracts. |
| **UK-India families** (a hypothesis, no researched demand) | The household | Handover briefs: who to call, key papers, across two countries. | Five conversations through the founder's own network, then time to first number. | Do not claim demand until the conversations show it. |
| **Invites and gifts** | The household or the giver | The partner reads the shared brief first and joins afterwards. A gift is a first brief, not a subscription. | Second-adult confirmation within 7 days. | Intent 82: no creator-visible "not opened" state. Gifting to parents depends on parent mode (use case 4). |
| **Direct, organic** | The household | The brief itself, with a titled share page. | Same first-value numbers. | The zero-cost plan is a separate document; nothing here depends on it. |

Revenue stays on subscriptions only. One £7.99 plan sold household by household is slow:
about 125 payers make £1,000 a month and about 1,250 make £10,000, so reach should come
through people who already hold the client.

## Open decisions this review does not make

1. Headline promise: "found for you" from the inbox, or a guided life plan. This review
   assumes the first; the second competes with LifeOS on its own ground and costs the
   household more effort.
2. First segment to pilot: advisers, employers or UK-India families.
3. First three life events (suggested: job change, new baby, bereavement).
4. Work email: direct connection, or a forwarding address only.
5. Prior-art search and attorney review before any mechanism is published.
6. A regulatory view on readiness wording before approaching advisers.
7. A proper teardown of Admini, LifeOS and SafeKeep.

# PRD-207: Partner distribution that keeps the zero-commission rule

## Problem

The strategy review found no distribution plan. Competitors reach families through
bundles (a legacy-planning product reportedly reaches millions through an insurer,
and bank AI assistants are shipping alongside accounts). LifeKeel's differentiator is
that it has no financial relationship with any insurer or provider, so the obvious
channels are exactly the ones it cannot use. Without a channel that is compatible
with that rule, growth depends on search and word of mouth alone.

## Who it's for

Employers who pay for family-protection benefits; existing advisers who want their
clients to keep their own information current; community organisations and charities.
End users are the family members who receive the product through one of them.

## What "done" looks like

1. **Allowed commercial models:** a flat per-seat or licence fee paid by the partner.
   Not allowed: per-lead, per-sale, referral, commission, revenue share, or any payment
   from an insurer or product provider.
2. **No steering:** partner contracts cannot influence what a detector says, which
   providers are mentioned (none are), or ranking. A clause makes this explicit and a
   breach ends the contract.
3. **Privacy wall:** a partner sees only aggregate, minimum-cohort statistics (seats
   activated, share of families with a given gap, never an individual or household).
   An employer never learns who has used the product or what they entered.
4. **Employee choice:** joining through a partner is opt-in, with consent separate from
   the employer relationship, and the account can leave the partner and keep working.
5. **Adviser use is the customer's own:** the family may share a read-only snapshot with
   their *existing* adviser, started by the family (a Tier 1 prepare action, as PRD-103).
   LifeKeel does not introduce families to advisers or select one for them.
6. **A public "how we make money" page** (PRD-208) lists these rules and the partner
   model in plain words.
7. A **pilot** with one employer, a small seat count, and success measures agreed before
   it starts.

## Constraints

- **Trust tier:** 0. A shared snapshot is read-only and user-initiated; nothing acts.
- **Regulated-advice check:** CLAUDE.md rule 2 is the constraint that shapes this PRD.
  Introducing customers to authorised firms can itself be a regulated activity in some
  circumstances, which is why item 5 is limited to the family's existing adviser. Counsel
  confirms this and the employer model before any contract is signed.
- **Data/privacy:** employer-paid seats create a controller question and a power-
  imbalance concern under GDPR; the privacy wall and separate consent are the mitigation
  and counsel reviews them.
- Insurer funding is out, because it breaks the "no financial relationship with any
  insurer" position the product is sold on.

## Builds on

PRD-006 (billing; must be live first), PRD-112 (referral loop; individuals, not
partners), PRD-103 (existing-provider outreach), PRD-208, `docs/reviews/market-
positioning-october-2026.md`.

## Success metrics

Seats activated as a share of seats purchased; retention of partner-sourced users
against organic; cost to acquire a seat against the licence fee; zero complaints that a
partner influenced content.

## Out of scope

Insurer, broker or lender funding; affiliate links; selling or sharing leads; white-label
rebranding that hides the zero-commission position.

## Open questions

Is an employer pilot realistic at the current stage, or does it wait for billing
cutover and a few hundred organic families? Who is the first partner?

## Becomes

docs/prd/207-partner-distribution.md

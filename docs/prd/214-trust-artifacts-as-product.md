# PRD-214: Trust artifacts as product — receipts, earned scope, handover (Phase 3)

## Problem

LifeKeel's trust mechanics (audit ledger, approval gates, action receipts)
are built as compliance infrastructure and invisible to the family. No
competitor offers a visible record of "what Keel did and why," an autonomy
model that expands by demonstrated behaviour, or a family continuity
rehearsal. These are simultaneously the strongest differentiation candidates
(M3, M5, M7) and the preconditions for ever widening the Act layer safely.
Trust should be a product surface, not a back-office control.

## Who it's for

Families (visible accountability, confidence in autonomy); the organizer and
their dependents (handover); LifeKeel (the only Act-layer expansion path
consistent with CLAUDE.md rule 1).

## What "done" looks like

1. **Receipt Chain (M7), user-visible**: every prepare/act action shows its
   receipt in-app — what was proposed, who approved, what executed, when,
   and the policy that allowed it — tamper-evident chained, exportable.
   Read-only surface over existing action/audit machinery.
2. **Earned-Scope Contracts (M5), first contract**: autonomy expressed as an
   explicit, versioned artifact ("Keel may email *you* renewal reminders for
   policies on file") that the family grants, reviews, and can collapse in
   one action. Behaviour and incidents adjust scope downward automatically;
   expansion only by explicit new grant. v1 covers notification-class scopes
   only.
3. **Proof-of-Handover (M3), rehearsal v1**: a guided rehearsal — a designated
   family member walks the continuity flow (legacy map, vault access rules,
   key contacts) in a simulated "organizer unavailable" mode, and the family
   earns a dated rehearsal record. Open gaps found during rehearsal become
   insights, not failures.
4. Each artifact ships with its evidence: receipts render from the real
   ledger; scope contracts render from real policy; rehearsal outcomes write
   real records.

## Constraints

- **Trust tier:** 1–2 surfaces, but the *gate* machinery is unchanged —
  every action still passes `ActionExecutor` with `approvedBy`
  (`trust-tier-gate.test.ts`). Earned scope can only grant what the tier
  system already permits; it never widens tiers by itself.
- **Regulated-advice check:** unchanged — receipts and contracts describe
  actions, not recommendations.
- **Data/privacy:** receipts are family-visible operational records, not
  telemetry; export must respect member scoping (youth twin excluded).

## Builds on

M3/M5/M7 in `proprietary-mechanisms-and-future-architecture-2026-10.md`;
PRD-116 (typed action intents), PRD-130 (continuity check), PRD-137
(legacy map), the action executor and audit logger already shipped.

## Success metrics

Receipts visible for 100% of executed actions; at least one earned-scope
contract live end-to-end (grant → adjust → collapse) in production; rehearsal
completion rate and gap-derived insights among families offered it; zero
trust-tier-gate regressions.

## Out of scope

Auto-execution beyond trusted `log_only` scopes, partner/insurer-facing
receipts, legal use of rehearsal records, blockchain/anchoring beyond the
existing hash chain.

## Open questions

Does the rehearsal record stay private to the family, or is an anonymized
"continuity readiness" metric useful for the product story (PRD-208)?

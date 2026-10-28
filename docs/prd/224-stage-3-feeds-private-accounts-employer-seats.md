# PRD-224: Stage 3 — Feeds into the same number, hidden accounts, and employer seats

## Problem

Once households rely on their briefs (PRD-222, PRD-223), keeping the runway
number accurate manually creates friction—yet existing read-only account sync
(`external_accounts` in PRD-133) does not feed the brief solver's savings number,
every account in a tenant is visible to all adults with no way for one partner
to keep a personal account private, and employer distribution (PRD-207) lacks a
concrete seat-grant billing mechanism that enforces zero employer access to
household figures and zero per-policy fees.

## Who it's for

Returning households who connect read-only accounts or record pension pots to
keep their brief's months current; couples where one adult wants to hide an
individual account; employees receiving a flat-fee LifeKeel seat from their
employer.

## What "done" looks like

1. **Read-only balances feed the same number:**
   - Synced `external_accounts` (PRD-133) gain an opt-in boolean
     `include_in_runway: boolean` (default `true` for shared savings/current
     accounts, configurable per account).
   - When `syncAccountInfo` (`apps/api/src/open-banking/sync.ts`) updates a
     linked account's `balance_minor`, it updates the household's effective
     liquid savings input, increments the tenant's `data_version`, and marks
     dependent `household_briefs` rows `stale: true` (PRD-226). No new service
     is introduced.
2. **One adult can hide an account — with explicit disclosure, never silent omission:**
   - `external_accounts` and `family_assets` gain `owner_user_id: string` and
     `visibility: 'shared' | 'private'` (default `'shared'`).
   - Any account with `visibility: 'private'` is:
     - excluded from household brief calculations and shared brief payloads;
     - filtered out server-side on `GET /family/assets`, `GET /connectors/*`,
       and `GET /family/emergency-sheet/preview` whenever `req.authContext.user_id !== doc.owner_user_id`;
     - never exposed on Stage 4 household read grants or fact-find exports.
   - **When any account is private, the shared brief must say so.** The payload
     carries `savings_scope: 'complete' | 'partial'`; whenever it is `'partial'`
     the brief and shared page render "savings on file (partial — one adult has
     private accounts not included)" (or equivalent reviewed copy) next to the
     months figure. Silently presenting a runway computed on partial savings as
     a complete household number violates the partial-data honesty rule
     (Intent 21/PRD-115) — omission is the bug this clause prevents, not a copy
     nicety.
3. **Pension pots update the retirement component only (no consolidation):**
   - Manual pension pot updates today (`household.members[].pension_balance_minor`,
     PRD-119) and read-only pension dashboard feeds later (only after the
     2027/28 public MoneyHelper dashboard and FCA private-dashboard rules make
     read access lawful) write into the same `pension_balance_minor` field.
   - Finding or updating a pot updates the retirement trajectory/component and
     marks retirement-linked briefs stale; it **never** initiates a pension
     transfer, consolidation journey, or provider recommendation (`CLAUDE.md`
     Rule 2).
4. **Employer seat (`employer_seats` billing & grant layer):**
   - Employers pay a flat per-seat licence fee (`employer_orgs` +
     `employer_seat_redemptions`).
   - Redeeming an employer seat activates the employee's household entitlement
     (unlocking Stage 2 briefs/record-keeping) without linking the household
     tenant to any employer read path.
   - **Hard privacy wall:** no API route or operator export ever joins
     `household_briefs`, `family_financial_profile`, or `opened_at` back to an
     `employer_org_id`. The employer sees only aggregate seat-redemption counts
     (with a minimum cohort floor), never household figures, and pays zero fee
     per policy.
   - **Seat grants and household grants are distinct, non-transferable types.**
     `employer_seat_redemptions` entitles plan features only; it has no bearer
     token field and can never mint, be exchanged for, or authenticate as a
     `household_grants` token (PRD-225) — even if the employee later issues a
     household grant, that grant is family-scoped and its token resolves only
     against `household_grants`. `GET /v1/household-grant/:token` looks up
     exactly one collection, and a fitness test asserts no route joins
     `employer_seat_redemptions` to any household data path.

## Constraints

- **Trust tier:** 0. Read-only balance ingestion, server-side visibility
  filtering, and flat-fee seat redemption.
- **Regulated-advice check:** no payment initiation, no pension consolidation or
  transfer advice, no private pensions dashboard before FCA rules allow it, and
  no per-policy or commission fee on employer seats (`CLAUDE.md` Rule 2).
- **Data/privacy:** `visibility: 'private'` is enforced at the query/projection
  layer in `apps/api` and verified by cross-user tenant tests; employer seat
  isolation is verified by a dedicated fitness test.

## Out of scope

Payment initiation (PISP), transaction-category budgeting (Monarch/YNAB scope),
pension switching/consolidation, or pre-authorization private pension dashboard
aggregation.

## Builds on

PRD-133 (`external_accounts` read-only sync), PRD-119 (per-member pension
fields), PRD-207 (partner distribution rules), PRD-222, PRD-223, PRD-226,
Intent 72.

## Success metrics

Brief `data_version` auto-advances on read-only balance sync; zero leakage of
`visibility: 'private'` accounts to second adults or shared briefs in tests;
zero household fields reachable from an employer seat record.

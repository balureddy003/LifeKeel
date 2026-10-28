# PRD-225: Stage 4 — Others can read, not own (household grant API & adviser fact-find)

> **Status: PARKED — design intent only.** Parked until Stage 1–2 metrics exist
> (confirmed second-adult opens, second-brief return rate). The grant model is
> specified here so Stage 1's token/grant semantics stay compatible — not to be
> built yet.

## Problem

Once a household's briefs and policy/account records are kept true in LifeKeel
(Stages 1–3), external tools or a financial adviser the family *already* works
with have no safe way to read that state without asking the family to re-key
everything into a separate fact-find form or hand over a raw GDPR JSON dump
(`GET /account/export`).

## Who it's for

Households who want to share a bounded, revocable view of their brief or send a
clean fact-find summary to an existing adviser; partner tools granted read-only
access by the household.

## What "done" looks like

1. **Small read API under a household grant (`GET /v1/household-grant/:token`):**
   - An adult household editor can create a scoped read grant
     (`POST /family/grants`) choosing which scopes to include:
     `runway`, `renewal_dates`, `opened_at`, `document_locations`.
   - The grant token is shown once, stored as a SHA-256 hash in
     `household_grants` with `tenant_id`, `scopes`, `label`, `created_by`,
     `expires_at`, and `revoked_at`.
   - `GET /v1/household-grant/:token` is a thin projection over the stored
     `household_briefs` result (`runway_months`, `solver_version`,
     `data_version`, `opened_at`), `policies[].renewal_date`, and document
     location labels.
   - **Grant-type isolation:** the endpoint resolves `:token` only against
     `household_grants`. Household grants are a distinct, non-transferable type
     from employer seat entitlements (PRD-224) and member invite tokens — an
     employer seat can never call this endpoint, and a grant can only be issued
     by an adult household editor, never by a partner or seat.
   - **Never recomputes on read, never returns raw document/vault files, and
     never includes `visibility: 'private'` accounts** (private accounts instead
     surface as `savings_scope: 'partial'` per PRD-224). Every read writes a
     content-free audit event (`grant.read`) visible to the family on
     `/audit-log`.
2. **Fact-find export for an existing adviser (`POST /family/fact-find/export`):**
   - Produces a deterministic, family-downloaded fact-find package (structured
     JSON + printable summary) containing:
     - Household adult names/roles and dependants (minors opt-in, matching
       `emergency-sheet.ts`).
     - Shared income, monthly essentials, liquid savings, and the latest stored
       brief result (`runway_months`, `solver_version`, `data_version`,
       `opened_at`).
     - Recorded policies (`type`, `provider`, `source`, `coverage_amount_minor`,
       `monthly_premium_minor`, `renewal_date`, `policy_number`) and document
       locations (no raw files unless the member separately exports them).
   - Delivered directly to the authenticated member to send to an adviser they
     already have — LifeKeel never transmits it to a third party or introduces
     an adviser.
3. **Disconnecting a partner deletes their access, not the graph:**
   - Revoking a grant (`DELETE /family/grants/:id`) immediately invalidates the
     token (`401`/`404` on subsequent reads) while leaving `household_briefs`,
     `family_financial_profile`, and the household graph untouched.
   - Removing a partner login (`DELETE /family/members/:id`, shipped in
     `family-group.ts:391`) revokes their user status, sessions, invites, and
     any grants they created, while preserving the household graph.

## Constraints

- **Trust tier:** 0 / 1. Read-only projection under an explicit household grant,
  and a user-downloaded fact-find file.
- **Regulated-advice check:** LifeKeel never introduces, recommends, or matches
  families with advisers, brokers, or insurers (`CLAUDE.md` Rule 2). The
  fact-find export is strictly for an adviser the family already has.
- **Data/privacy:** raw vault/document bytes are never reachable via
  `/v1/household-grant/:token`; `visibility: 'private'` items are excluded; all
  grant issuance, reads, and revocations are recorded in `audit_log`.

## Out of scope

Write APIs for third parties, adviser marketplaces or lead-generation fees,
streaming raw PDFs over grant tokens, or recomputing solver results on partner
API reads.

## Builds on

PRD-222 (stored brief result + `opened_at`), PRD-224 (`visibility: 'private'`
filtering), `apps/api/src/routes/emergency-sheet.ts` (PRD-220),
`apps/api/src/routes/family-group.ts` (member removal), Intent 73.

## Success metrics

100% of `/v1/household-grant/:token` reads served from stored projections
without invoking the solver or touching object storage; immediate access
termination on grant revocation or partner removal; zero raw file bytes in grant
responses.

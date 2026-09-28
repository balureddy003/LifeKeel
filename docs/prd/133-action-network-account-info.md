# PRD-133 — Action Network: read-only account-info connector plumbing

## Problem
The Action Network gap (audit row 6) is primarily a partnerships problem —
no AISP aggregator is onboarded — but the connector architecture had no
code path for account-information data at all: `connectors/open-banking.yaml`
was a contract with nothing behind it, and the family connector routes only
knew email.

## Solution
The full read-only pipeline, exercisable end-to-end today:

- **`open-banking/providers.ts`** — `AccountInfoProvider` interface
  (`listAccounts(credential) → ExternalAccount[]`) with two providers:
  - `sandbox` — deterministic demo accounts so the pipeline is testable
    without a partner; dev/test only unless `OPEN_BANKING_SANDBOX=1`.
  - `truelayer` — real `GET /data/v1/accounts` reads against a
    user-consented access token (`TRUELAYER_API_BASE` switches
    sandbox/live endpoints). Gated on `OPEN_BANKING_TOKENS=1` until the
    OAuth consent flow exists to mint tokens properly.
- **`open-banking/sync.ts`** — `syncAccountInfo()` upserts into the
  tenant-scoped `external_accounts` collection, drops accounts the
  provider stopped returning, and maintains credential health
  (`last_synced_at`, `needs_reauth` on auth failure) — the same pattern
  the email connector uses.
- **Routes** in `family-connectors.ts`:
  - `POST /connectors/open-banking/credentials` — validate-before-save via
    a real `listAccounts` call (the IMAP pattern); token encrypted at rest.
  - `POST /connectors/open-banking/sync` — manual re-sync, 401+`NEEDS_REAUTH`
    on a dead grant.
  - `GET /connectors/open-banking/accounts` — the synced read model.
  - `/connectors/status` computes `comingSoon` live (false when a provider
    is usable) and surfaces `needsReauth` for the new connector.
- **Web** — `/connect/open-banking` page (provider choice + token field,
  explicit read-only banner), an accounts list + "Sync now" panel under
  the connected card.

## Boundaries
- **Read-only, permanently.** No payment initiation, no money movement,
  no write-back to the provider — that's a different regulated scope and
  a different trust-tier conversation. (CLAUDE.md "second rule.")
- The OAuth consent flow + scheduled sync cadence are the partnership-
  dependent remainder — tracked as blocked on AISP onboarding, not
  pretend-shipped.
- Sandbox accounts are labeled "demo" in the UI and gated off in
  production by default.

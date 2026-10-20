# Data retention and deletion

What LifeKeel keeps, for how long, and what deletes it. Written from the code (PRD-146);
change this file when the code changes. Numbers marked *default* are starting values, not
benchmarks.

## What the family controls

| Data | Kept until | How it goes |
|---|---|---|
| Documents (files, what was read from them, their text) | the family deletes it, or deletes the account | `DELETE /documents/:id` returns a receipt. **Never swept by age.** |
| Mailbox connection and what was read from it (inbox summaries, saved attachments, sync state, scan failure log) | the family disconnects with "delete what was read", or deletes the account | `POST /connectors/:id/disconnect` with `delete_data: true` returns a receipt. A plain disconnect revokes access only and keeps the rest, and says so. |
| Financial profile, family roster, vault | the family changes or removes them, or deletes the account | account deletion |
| Everything above and every other tenant-scoped collection | the family deletes the account | `POST /account/delete` (see below) |

Details a family saved to their profile from a document or message are the family's own
entries; deleting the source does not remove them.

## Account deletion

1. The tenant is marked `deleting` first, so access closes immediately.
2. Every tenant-scoped collection, document blob, connector credential, push device and
   encryption key is removed (`DELETABLE_COLLECTIONS` and `CUSTOM_DELETES` in `erasure.ts`).
3. A check counts anything left. Only a clean check marks the tenant `deleted` and the receipt
   `completed`; otherwise it stays `deleting` and the nightly `erasure-replay` retries it, so a
   failure halfway is never forgotten.
4. `deleted` tenants are re-wiped nightly, which handles a backup restore that brings data back.

## Deletion receipts

Counts by category, the post-deletion check, and three honest statements: live data erased
(true only when the check passed); the backup window; and what each hosted processor states
about retention ("not confirmed" while its terms are unreviewed). Never content. Kept 7 years,
like the audit log, so the operator can answer a deletion request
(`GET /operator/deletion-receipts`). The wording never says "permanent", "instant" or "none
exist".

**Backup window.** Erasure covers backups, but a backup taken before a deletion can keep a copy
until it is overwritten. Set `BACKUP_RETENTION_DAYS` to the real window. Until it is set,
receipts say it is not confirmed.

## Age-based sweep (derived data only)

`RetentionWorker` runs nightly at 02:00. Per tenant, configurable in `tenants.data_retention`
within the clamp shown:

| Class | Collection | Default | Allowed range |
|---|---|---|---|
| Signals and events | `signals` | 90 days | 30 to 365 |
| Insights | `insights` | 180 days | 30 to 365 |
| Workflow runs | `workflow_runs` | 90 days | 30 to 365 |
| Agent memory | `agent_memory` | 365 days | 30 to 730 |

Each run is recorded in `job_runs` (counts only). The sweep never deletes documents.

## Other fixed windows

| Data | Kept | Where |
|---|---|---|
| Audit log | 7 years (TTL) | `audit/audit-log.ts` |
| Deletion receipts | 7 years (TTL) | `deletion/receipt.ts` |
| Billing records | as the financial record | `routes/account.ts` header |
| Saved quiz answers awaiting an email link | 24 hours | `routes/magic-link.ts` |

## Not covered here

Legal-hold workflows; cross-border transfer paperwork; deleting anything at a third-party
processor (LifeKeel cannot verify a negative at a provider, so receipts record what each states);
the breach plan and the position on children's data, which are launch evidence for the owner.

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

| Data | Kept | Reason | Where |
|---|---|---|---|
| Audit log | 7 years (TTL) | project policy: evidence of approvals and deletions; not a universal legal requirement, review per action class | `audit/audit-log.ts` |
| Deletion receipts | 7 years (TTL) | answering a later "was I deleted?" request | `deletion/receipt.ts` |
| Credit ledger and Stripe identifiers of a deleted household | 7 years after deletion, then swept | UK company record-keeping (6 years after the financial year end) | `jobs/retention-worker.ts` |
| Stripe revenue copies for marketing intelligence (`revenue_events`, `revenue_subscriptions`: invoice id, amount, date, tenant) | same as the credit ledger: 7 years after the household's deletion, then swept | the same payments, read-only from Stripe, to measure what each channel earns; no content, no card data | `marketing/revenue.ts`, `jobs/retention-worker.ts` |
| Sign-in history (`login_events`) | 30 days (TTL); removed at once on account deletion | security investigation | `db.ts`, `erasure.ts` |
| Signed-out session tokens (`revoked_sessions`) | 31 days (TTL), hashes only | longest session lifetime | `auth/session-revocation.ts` |
| Parked OAuth grants (`oauth_pending_grants`) | 10 minutes (TTL), encrypted | completing a connection | `routes/connector-credentials.ts` |
| Marketing leads | 2 years after last activity; removed at once on account deletion | consented marketing; stale consent isn't relied on | `jobs/retention-worker.ts`, `erasure.ts` |
| Lifecycle email ledger | 2 years | stops a sequence being sent twice | `jobs/retention-worker.ts` |
| Growth events | 13 months | product analytics, aggregate | `jobs/retention-worker.ts` |
| Stripe webhook event ids | 400 days once completed | idempotency across Stripe's retry window, plus a year for reconciliation | `jobs/retention-worker.ts` |
| Invitation send counter | 7 days | daily invitation limit | `jobs/retention-worker.ts` |
| Saved quiz answers awaiting an email link | 24 hours | completing the link | `routes/magic-link.ts` |
| Unverified signups (`users.registration_status: pending`) and the tenant only they created | 7 days, then swept unless they ever signed in | an address someone mistyped or abandoned becomes free again | `jobs/pending-registrations.ts` |
| Email OTP challenges (`otp_chains`) | chain lifetime (30 minutes) + 1 hour (TTL); code stored only as an HMAC | completing sign-in | `auth/otp.ts`, `erasure.ts` |
| Email OTP send budgets (`otp_send_windows`) | each window's end + 25 hours (TTL), counts only | abuse limits that survive restarting signup or login | `auth/otp.ts`, `erasure.ts` |
| Uploads awaiting scan (R2 `lifekeel-quarantine`) | deleted at promotion or rejection; bucket lifecycle removes anything left after 1 day | malware and structure checks before anything is readable | `documents/scan-job.ts`, `documents/reconciler.ts` |
| Infected or rejected uploads | metadata only (no bytes) under the audit-log window | evidence of what was blocked | `documents/scan-job.ts` |
| Deleted documents in R2 | first purge at delete; second purge after every presigned URL has expired (about 10 minutes), then the receipt closes | an unexpired upload URL cannot bring a deleted file back | `documents/deletion.ts` |
| Daily upload counters (`tenant_quota_days`) | 48 hours (TTL) | daily upload limit | `documents/quota.ts` |

Still open (tracked in `docs/reviews/SECURITY_AND_COMPLIANCE.md`, R23): an inactivity
window for households that stop using LifeKeel, retention for AI evaluation captures and
queue collections, and the processor-side windows, which depend on contract terms.

## Not covered here

Legal-hold workflows; cross-border transfer paperwork; deleting anything at a third-party
processor (LifeKeel cannot verify a negative at a provider, so receipts record what each states);
the breach plan and the position on children's data, which are launch evidence for the owner.

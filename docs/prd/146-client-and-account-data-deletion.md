# PRD-146: Client and account data deletion with receipts

## Problem

Deletion is currently partial. `retention-worker.ts` expires `signals`, insights,
workflow runs and agent memory by age. PR #62 purges client-side caches, the offline
queue and per-user storage on sign-out, but there is no device-token cleanup for push,
no per-document retention expiry, no deletion of derived extraction data and
embeddings, and no receipt the user or an auditor can rely on. CLAUDE.md rule 3
requires explicit retention and deletion rules and deletion evidence; PRD-143 and
PRD-144 add derived data that must be covered from day one.

## Who it's for

Any user deleting a document, disconnecting a mailbox, or closing an account; and the
operator answering a deletion request.

## What "done" looks like

1. **Document delete** removes the raw file, extracted fields, source spans and any
   embeddings, and recomputes the detectors that used them.
2. **Mailbox disconnect with delete** removes the stored token, the "what we've read"
   log and everything derived from matched messages.
3. **Account deletion** cascades through every tenant-scoped collection, push device
   tokens, connector credentials and processor-side artifacts (none should exist by
   PRD-142, and the job verifies it).
4. Each deletion produces a **receipt** listing what was removed by category and
   count, a timestamp, and the verification result, available to the user and to the
   operator audit log. The receipt contains no content.
5. A configurable retention window per data class, with defaults documented, enforced
   by `RetentionWorker`; stale or orphaned derived data is swept.
6. Backups: the receipt states the backup retention window honestly instead of
   claiming instant erasure.
7. Deletion is idempotent and resumable after a partial failure.
8. **Tenant isolation is tested:** deleting one tenant's document, mailbox or account
   leaves every other tenant's data untouched, in the style of
   `apps/api/src/__tests__/ml-tenant-isolation.test.ts`.

## Constraints

- **Trust tier:** 2 for the destructive action: a named action with explicit user
  confirmation (the existing `deleteAccount` confirm step). The retention sweep is a
  background job over the user's own past data and runs on documented rules; it never
  deletes data the user has marked to keep.
- **Regulated-advice check:** receipts and confirmation copy contain no advice; the
  copy is added to `advice-rule.test.ts`'s copy set.
- **Data/privacy:** deletion evidence is metadata only.

## Builds on

`apps/api/src/jobs/retention-worker.ts`, `deleteAccount` in the settings flow, PR #62
(`purgeClientData`), PRD-142, PRD-143, PRD-144.

## Success metrics

Deletion completion rate and time; receipts issued per request; zero residual
tenant-scoped records in a post-deletion verification test.

## Out of scope

Legal-hold workflows, cross-border transfer paperwork, deletion from third-party
processors beyond verifying none were used.

## Amendments from the October 2026 market review

See [prd-set-market-review-2026-10.md](../reviews/prd-set-market-review-2026-10.md)
for evidence quality. Numeric defaults below are hypotheses to test, not benchmarks.

1. **The receipt has three lines:** live data erased; backup retention window in days
   (erasure covers backups, which may persist "beyond use" until overwritten, and the
   receipt must say so); per-processor retention. Never write "permanent" or "none
   exist".
2. **Remove "the job verifies none exist" at processors.** LifeKeel cannot verify a
   negative at a provider. Record the processor's stated retention and inform
   processors of the erasure where required.
3. **Retention sweep and CLAUDE.md rule 1.** A sweep that irreversibly expires user
   documents conflicts with the human-approval rule. Limit the sweep to derived data,
   or give a notice and a grace period before any document expires.
4. **Apple 5.1.1(v)** requires in-app account deletion; this PRD supplies it.
5. **Launch evidence:** a breach plan covering the ICO and the Slovenian regulator, and
   a position on children's data.

## Status (first build)

Built: **deletion receipts** (`deletion/receipt.ts`, `deletion_receipts`, kept 7 years like the audit
log): counts by category, the result of a check run afterwards, and the three lines from amendment 1
(live data erased only when the check passed; the backup window from `BACKUP_RETENTION_DAYS`, or "not
yet confirmed"; each hosted processor's *stated* retention, "not confirmed" while unreviewed). The
wording never says "permanent", "instant" or "none exist".

**Account deletion is now resumable (item 7).** The tenant is marked `deleting` before the wipe
(access closes at once); a wipe that fails halfway used to leave the tenant half-erased and never
retried, because the tombstone was written only afterwards. It becomes `deleted` only after a clean
check, and the nightly `erasure-replay` finishes any `deleting` tenant and completes its receipt.
A partial result is reported as such (HTTP 202), not as success.

**Document delete** returns a receipt (file, record, what was read from it) and says that details
already saved to the profile stay. **Mailbox disconnect with delete** (`delete_data: true`) removes
the credentials (the Gmail grant is stored under both `gmail` and `email`), sync state, inbox
summaries, documents saved from attachments with their blobs, and the scan failure log; it also works
after an earlier plain disconnect. A plain disconnect revokes access only and says the rest is kept.

Tenant-isolation tests run against real MongoDB: a row in every erasure-listed collection for two
tenants, delete one, zero residual and the other untouched (also for document and mailbox deletes).
The retention sweep stays limited to derived data, never documents (amendment 3), and each run is
recorded in `job_runs`. Defaults are documented in `docs/data-retention.md`. Web: a receipt card after
a document delete, a mailbox delete-and-disconnect, and account deletion (a one-time
`/account-deleted` page; the account can no longer be asked for its receipt). The account-deletion
button and warning no longer say "permanently".

Not built / needs the owner: the **backup retention window** (set `BACKUP_RETENTION_DAYS`; until then
receipts say it is not confirmed); a per-mailbox "what we've read" log (arrives with PRD-144); device
push tokens are removed by account deletion and, since PRD-140, at sign-out; legal hold, the breach
plan covering the ICO and the Slovenian regulator, and a position on children's data (amendment 5) are
launch evidence, not code. Deletion at a processor cannot be verified, so receipts record what each
states instead.

## Becomes

docs/prd/146-client-and-account-data-deletion.md

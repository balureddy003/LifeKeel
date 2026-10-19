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

## Becomes

docs/prd/146-client-and-account-data-deletion.md

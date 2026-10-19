# PRD-143: Reviewed extraction pipeline — classify, extract only what detectors need, confirm before commit

## Problem

PRD-003 shipped upload and OCR, and PRD-109 bridges extracted policy fields into
`policies[]`. Remaining gaps named in PRD-003: no document-type-aware routing, no
staleness signal, and extracted values reach the profile without the user seeing
the source. A wrong sum assured silently feeding a detector produces a wrong gap,
which is the fastest way to lose trust in a product that claims to understand the
family's documents.

## Who it's for

Keel Plus users uploading or photographing documents on any device; free users keep
storage-only behaviour.

## What "done" looks like

1. **Intake:** triggered by an upload or a user-approved forwarded attachment. Type
   and size checks, malware scan, OCR where needed, and classification into a small
   set (policy schedule, pension statement, will or power of attorney, tax letter,
   other). When classification confidence is low the user is asked "confirm what this
   is" instead of the system guessing; the choice is recorded.
2. **Extraction:** only the fields that a detector consumes (for example sum assured,
   renewal date, beneficiary present yes/no, pension value and as-of date). The
   whole document text is never sent when a field-level extraction is enough.
3. Every extracted field carries its source page and span, a confidence, the model
   and version, and a document ID.
4. **Review and commit:** fields below a confidence threshold, and all fields on
   first use, are shown to the user next to the source snippet to confirm, edit or
   reject. Only confirmed fields are written to the financial profile, with
   provenance (document, who confirmed, when).
5. On any extraction failure the user is offered manual entry. Nothing is partially
   written.
6. Classification feeds a visible staleness signal (document date versus today),
   used by PRD-145.
7. Uploaded content is treated as untrusted data: the extraction step has no tools
   other than "emit typed fields", so instructions embedded in a PDF cannot trigger
   an action.

8. The extractor's output is validated against a typed schema before anything is
   stored. Output that fails validation is treated as an extraction failure (item 5),
   never repaired silently.
9. An **audit log** records each agent step (intake, extraction, review, commit) as
   metadata only: event type, document ID, counts, durations, who confirmed. No
   document text, field values or snippets appear in logs or telemetry.
10. **Tenant isolation is tested.** Every read and write carries a tenant ID and is
    authorised against it, and a test in the style of
    `apps/api/src/__tests__/ml-tenant-isolation.test.ts` shows a second tenant cannot
    read, confirm, edit or delete another tenant's documents, candidates or fields.

## Constraints

- **Trust tier:** 0 for extraction. Writing to the profile is the user's explicit
  confirmation, never automatic. Anything outbound stays Tier 1 and goes through
  `ActionExecutor` with `approvedBy`.
- **Regulated-advice check:** extraction states what a document says. It never
  compares to other products or suggests a switch (CLAUDE.md rule 2, PRD-103 scope). The copy on the review and confirm screens is
  added to `advice-rule.test.ts`'s copy set.
- **Data/privacy:** runs only through PRD-142's registry. Prefer local OCR and
  extraction; hosted calls use the minimum field set. Raw files stay in
  tenant-scoped encrypted storage, and vault documents bypass OCR (PRD-134).

## Builds on

PRD-003, PRD-109, PRD-134, `packages/*` OCR path, PRD-142.

## Success metrics

Per-field precision on a golden dataset under `detector-evals/` (targets set by the
user before launch; a release below them is blocked); share of fields confirmed
without edit; time from upload to confirmed profile fields.

## Out of scope

Reading documents the user did not upload, bulk historical import, any cross-tenant
learning from corrections.

## Open questions

Which field set per document type is the v1 minimum? Proposed: insurance and
pension first, since they feed the existing protection and retirement detectors.

## Amendments from the October 2026 market review

See [prd-set-market-review-2026-10.md](../reviews/prd-set-market-review-2026-10.md)
for evidence quality. Numeric defaults below are hypotheses to test, not benchmarks.

1. **Launch gate: a DPIA, a ROPA entry and an Art. 6 / Art. 9 decision.** Policy
   schedules and wills can contain health data and third parties' details, and the
   ICO's DPIA triggers include AI plus another risk factor (UK and EU versions;
   counsel).
2. **Never extract medical text.** The field schema excludes it, with a test.
3. **Reword "cannot trigger an action".** Having no tools stops injected instructions
   from acting, but a poisoned field value can still mislead; confirm-before-commit is
   the real control, and the PRD should say so.
4. **Published trust statement** must say that opt-in vault sealing (PRD-134) excludes
   OCR, so paid extraction and the strongest privacy feature cannot be combined.
5. **Pen test** of the upload path before launch.

## Becomes

docs/prd/143-reviewed-extraction-pipeline.md

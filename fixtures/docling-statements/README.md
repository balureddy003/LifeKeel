# docling-statements — synthetic bank-statement fixtures (intent 97, slice 3)

12 made-up bank statements (PDF, single page, two layouts) with the six
banking fields each must yield: opening/closing balance, money in, money
out, period start/end. All names, sort codes and numbers are invented.

- `generate.py` — stdlib-only generator; rerun to regenerate PDFs +
  `expected.json` deterministically (seeded).
- `expected.json` — per-fixture expected field values.
- The statement figures are internally consistent
  (opening + money in − money out = closing), so the mechanical
  reconciliation check has real work to do.

## What runs in CI

`apps/api/src/extraction/__tests__/statement-fixtures.test.ts` proves every
PDF parses through the current local path (`unpdf`) and yields its six
expected values — fixture quality, not model accuracy.

## The slice-3 acceptance eval (runs on demand, needs the worker)

The intent's check — parsing + field extraction + mechanical checks
reproducing the expected six fields on ≥90% of fixtures (owner-set
proportion) — requires the Docling worker and the governed extraction
model, so it cannot run in CI:

1. Deploy `infra/docling-service` (owner hosting/cost decision pending) and
   set `DOCLING_SERVICE_URL`.
2. For each fixture, run the extraction job path (or
   `extractDocumentFieldsLocal` with the local `decide`, and the hosted
   path for comparison) over the PDF bytes.
3. Score per fixture: all six expected fields present and correct after
   `normaliseValue`, plus `checkExtraction('bank_statement', …)` — note the
   schema.ts banking fields and the extraction-checks bank_statement
   minor-unit fields are different shapes; score the six schema.ts fields
   the intent names, and record check results separately.
4. Ship Docling as default only if the proportion meets the owner-set bar;
   otherwise keep the local path and record the gap.

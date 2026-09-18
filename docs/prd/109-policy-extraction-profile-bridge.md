# PRD-109: Policy extraction → Financial Profile bridge

## Problem

Found by tracing the passive-intake path for insurance policies end to end,
not by reading the code in isolation: OCR (`ocr/extract.ts`) already
extracts the right fields from an insurance document — `provider`,
`policy_number`, `renewal_date`, `coverage_amount` — and email scanning
(`jobs/email-scan.ts`) already runs attachments through that same pipeline.
Both hops of "passive observation" work. But `ocr/profile-mapping.ts`, the
one thing that turns extraction into a Financial Profile change, was scoped
to exactly 3 unrelated scalar paths (`household.life_cover_minor`,
`household.mortgage_outstanding_minor`, `retirement.pension_balance_minor`)
— written before `policies[]` (PRD-102) existed, and never extended when it
shipped. The apply endpoint (`documents.ts`'s `/apply-to-profile`) is a flat
`$set` on those 3 paths, structurally incapable of appending an array
element regardless. Confirmed live in `DocumentDetailClient.tsx`: an
uploaded policy's provider, policy number, and renewal date render as plain
read-only text under "Extracted details," with no apply affordance next to
any of it.

Net effect: every `policies[]` entry in the product had to be hand-typed,
no matter what was uploaded or scanned — directly contradicting
ARCHITECTURE.md's own data-intake principle ("passive observation is the
primary intake channel; manual entry is the fallback"). Since
`policy_renewal_window` and the PRD-102/105 protection-gap rules read
exclusively from `policies[]`, this meant the entire protection-gap
detector story ran on manually-typed data regardless of how good OCR was —
this is the one gap that sits upstream of everything else "Oak understands
your family's protection" depends on.

## Market bar

See [000](000-market-landscape-and-positioning.md). The differentiated bar
this product has already committed to (PRD-102, PRD-108) is reasoning
grounded in the family's real data, entered with minimal friction — not a
generic calculator the user re-keys numbers into. A policy-tracking feature
that silently degrades to "type it in yourself" the moment a real document
is involved isn't meeting that bar; it's a form with an OCR preview bolted
on. Closing this is a precondition for PRD-102/105/108's own claims to be
true in practice, not a new promise.

## Who it's for

Every family that's already uploading insurance documents or has email
scanning connected — which per PRD-003/004 is meant to be most of them,
since passive intake is supposed to be the default path, not an
opt-in power-user feature.

## What "done" looks like

Uploading an insurance document (directly, or via an email attachment
picked up by the scanner) surfaces an editable "Add as an insurance
policy?" card on `/documents/:id`, pre-filled with whatever OCR found:
policy type (inferred from a new `policy_type` field in the OCR prompt,
left blank rather than guessed when uncertain), provider, coverage amount,
monthly premium, renewal date (only when OCR returned a strict ISO date —
never guess-parsed from free text), and policy number. The user reviews,
corrects anything wrong, and taps "Add to Financial Profile" — one action,
same posture as the existing scalar suggestions ("always surfaced to
confirm, never applied silently"). The policy lands in `policies[]`
immediately; "Save & Generate Insights" on the wizard remains the one place
that re-evaluates detectors, unchanged from the existing pattern.

Two small schema-level gaps closed along the way: `policies[]` gained a
`policy_number` field (didn't exist at all before — not even the manual
wizard could record one), and the manual-entry wizard itself now has a
"Policy number" input, so the two intake paths (manual and passive) produce
the same shape of record.

## Trust tier

**Tier 0 — Observe/Understand/Predict.** Reading a document, proposing a
suggestion, and writing to the family's own Financial Profile on explicit
per-suggestion confirmation. No external side effect, no message sent, no
third party contacted. Same tier as the existing scalar-suggestion flow
this extends.

## Scope

1. `ocr/extract.ts`: extend `CATEGORY_PROMPT` to ask for a `policy_type`
   field (one of the six `policies[].type` values) on insurance documents,
   omitted when the model isn't confident — no schema change to
   `ExtractionResult`, still a free-text `Record<string,string>`.
2. `ocr/profile-mapping.ts`: new `mapExtractedFieldsToPolicySuggestion()`.
   Provider is the minimum confidence bar (same standard the existing
   scalar rules use) — no provider, no suggestion. Coverage/premium parsed
   via the existing money-parsing helper; renewal date accepted only when
   it's already a strict `YYYY-MM-DD` string, left null otherwise rather
   than guess-parsed from arbitrary free text.
3. `family-financial-profile.ts`: add optional `policy_number` to the
   `policies[]` zod schema. Not read by any detector — a reference field so
   the family (or a PRD-103 prepare draft) can quote the right number back
   to the insurer.
4. `documents.ts`: `GET /documents/:id/profile-suggestions` now also
   returns `policySuggestion` alongside the existing scalar `suggestions`.
   New `POST /documents/:id/apply-policy` — validates `type` and `provider`
   are present, `$push`es a policy record into `family_financial_profile`
   (upserting the profile document if none exists yet, same as the
   existing apply-to-profile endpoint does for scalars). Deliberately
   separate from `/apply-to-profile` rather than overloading it — the two
   have structurally different write shapes (`$set` on a scalar path vs.
   `$push` onto an array).
5. `apps/web`: a new editable review card on `/documents/:id` (type
   picker, provider, coverage, premium, policy number, renewal date, all
   pre-filled and editable before the user confirms); a shared
   `POLICY_TYPE_LABELS` module so the wizard and this new card can't drift;
   the manual wizard gains its own "Policy number" field for parity between
   the two intake paths.

Out of scope: automatically applying a policy suggestion without a review
step (breaks the "never applied silently" posture the rest of this flow
relies on); OCR confidence scoring beyond the existing "provider present"
bar; retroactively re-processing documents uploaded before this shipped —
those still show extracted fields as read-only text; any change to how
`policy_renewal_window` or the protection-gap rules consume `policies[]` —
this PRD is entirely about how records get *into* that array, not how
they're reasoned over once there.

## Success metrics

- **% of newly-uploaded insurance documents that result in an applied
  policy suggestion**, among documents where OCR found a provider — the
  direct measure of whether passive intake is actually closing the loop
  now, not just extracting-and-displaying.
- **% of applied policy suggestions where the user changed at least one
  field** (especially `type`, given it's inferred) before confirming — a
  high rate here would flag the `policy_type` prompt needs tightening, not
  that the review-step design is wrong.
- **Manual-entry policy count vs. document-derived policy count** over
  time — the ratio this PRD exists to shift, without needing manual entry
  to hit zero (some families will always type faster than they can find
  the document).

## Acceptance criteria

- Uploading a life-insurance PDF with a clear provider name and coverage
  amount produces a `policySuggestion` from `GET
  /documents/:id/profile-suggestions` with `type: 'life'`, the provider,
  and a non-null coverage amount.
- A document with no identifiable provider produces `policySuggestion:
  null` — never a suggestion with a blank/guessed provider.
- A renewal date extracted in a non-ISO format (e.g. "15 March 2027")
  results in `renewalDate: null`, not a mis-parsed date.
- `POST /documents/:id/apply-policy` with a valid `type` and `provider`
  appends to `policies[]` without disturbing any existing policies already
  on the profile.
- `POST /documents/:id/apply-policy` with a missing or invalid `type`, or a
  blank `provider`, returns 400 and writes nothing.
- The Financial Profile wizard's manual "Add a policy" flow now includes a
  policy-number field, and round-trips it correctly through
  `fromProfile`/`toPayload` on an existing saved profile.
- Regression: the 3 existing scalar suggestion paths
  (`household.life_cover_minor`, `household.mortgage_outstanding_minor`,
  `retirement.pension_balance_minor`) and their `/apply-to-profile` endpoint
  behave exactly as before this PRD.

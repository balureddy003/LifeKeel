# PRD-149: Jurisdiction pack — UK and Slovenia without forking the product

## Problem

The product is served on two domains (`app.lifekeel.co.uk`, `app.lifekeel.si`), and
the native shell now routes users between them (`apps/web/src/lib/region.ts`).
But the region concept stops at the host. A search of the web and API source found no
internationalisation library and no `Intl` use. Amounts are stored as minor units with
no currency code, and ARCHITECTURE.md already lists the single-currency assumption as a
P2 gap. Detector thresholds, document types, "licensed professional" wording and the
advice-rule word lists are written for one jurisdiction in one language.

Also verified: `apps/web/firebase.json` routes `/api/**` to a Cloud Run service in
`us-central1`, and ARCHITECTURE.md says deployment is single-region. For users in the UK
and Slovenia that raises a data-transfer question that counsel, not engineering, must
answer.

## Who it's for

UK families and Slovenian families, and plausibly families split between the two. Which
of these the `.si` product is for is the first open question and changes the whole PRD.

## What "done" looks like

1. A **jurisdiction pack** is a typed, versioned bundle selected by region, containing:
   currency and formatting, language and plural rules, default timezone, supported
   document types, detector parameter overrides, the "licensed professional" wording and
   legal pages, support hours, and the advice-rule word lists for that language.
2. **Currency:** every profile carries a currency code. v1 is **single currency per
   family**, set from the region, with no conversion. A family holding assets in another
   currency records them in a separate register with that currency and they are excluded
   from detector maths, and the product says so. This resolves ARCHITECTURE's P2 item with
   an explicit scope rather than an FX feature.
3. **Language:** an i18n layer (none exists today) with Slovenian as the first non-English
   language, including dual plural forms and date and time formats. All new PRDs' user
   copy (digest, reveal, notifications) is written to be translatable.
4. **Advice rule per language:** `advice-rule.test.ts` gains a Slovenian word list written
   and reviewed by a native speaker with regulatory awareness. A language without a
   reviewed list does not ship user-facing advice-adjacent copy.
5. **Detectors are jurisdiction-tagged** (PRD-148); a UK rule never fires for a Slovenian
   family and the reverse.
6. A **data-residency decision** is recorded: where each region's data lives, the transfer
   mechanism, and what the trust page (PRD-208) may truthfully say.
7. Adding a third jurisdiction is a pack plus a review, not a code change in many places.

## Constraints

- **Trust tier:** 0.
- **Regulated-advice check:** each jurisdiction has its own regulator and perimeter. UK
  FCA reasoning does not transfer to Slovenia. Counsel confirms the information-versus-
  advice boundary per jurisdiction before any user-facing copy for it ships.
- **Data/privacy:** UK GDPR and EU GDPR differ in detail; Slovenia has its own regulator
  and national law. Treat the pack as a compliance boundary, not only a translation.
- Do not invent Slovenian pension, insurance or estate rules. Detector parameters for a
  jurisdiction come from a named source that a person has checked.

## Builds on

`apps/web/src/lib/region.ts`, the region-aware native shell, ARCHITECTURE.md's currency
and deployment sections, PRD-148, PRD-208, `advice-rule.test.ts`.

## Success metrics

Share of `.si` users completing the check in Slovenian; detector parity (the same
families score the same in both packs for equivalent facts); zero advice-rule failures
in a reviewed language; time to add a third jurisdiction in a trial.

## Out of scope

Currency conversion, tax modelling, multi-country asset valuation, languages without a
native reviewer.

## Open questions

1. Is `.si` for people resident in Slovenia, UK-resident Slovenians, or both? (A
   competitive review suggests the UK-Slovenia diaspora family as a wedge; that is an
   inference, not evidence.)
2. Which processor regions are acceptable for each jurisdiction (counsel)?
3. Who is the native reviewer for Slovenian copy?

## Becomes

docs/prd/149-jurisdiction-pack.md

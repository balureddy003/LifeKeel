# PRD-121: estate readiness detector

## Problem

PRD-114 gave the composite readiness score an `estate` component driven by
vault `doc_type` metadata — but nothing *detected* the gap. A missing will
lowered the score and appeared as a detail string, yet produced no
persisted insight: nothing to act on, nothing in the insights feed,
nothing explaining the estate domain on the health page. Every other
readiness component has a detector behind it; estate was the last one
without.

## Who it's for

Any adult member of a household whose estate readiness lives (or should
live) in the Digital Estate Vault — including a family that has never
opened the vault. The gap exists whether or not they know it does.

## What "done" looks like

- A new `detectors/family/estate-readiness.yaml` detector
  (`family_estate_readiness`) with two rules, `estate_no_will` and
  `estate_no_power_of_attorney`, evaluated on a `family.estate` event
  carrying `has_will`, `has_power_of_attorney`, and `estate_doc_count`
  derived from tenant-scoped vault documents' user-declared `doc_type`.
- The event is emitted in two places so the insight can't go stale in
  either direction:
  - **`evaluateProfileAndGenerateInsights`** — every profile submit, so a
    family that never opened the vault still gets the gap surfaced, and
    `resolveStaleInsights` can safely retire insights once the docs land
    (the detector is in `FAMILY_DETECTOR_IDS`, which is only safe because
    the event is emitted unconditionally each submit).
  - **Vault upload/delete** — `registerVaultRoutes` now accepts an
    optional `Engine` + delivery callback (wired in `server.ts` to the
    same `insightsDeliveryHook` the profile routes use). Re-evaluation
    happens after the mutation commits and is failure-isolated: a
    detector hiccup logs a warning and never breaks the vault write.
- Insights persist through the existing `persistAndDeliverInsights`
  dedup path — repeated submits re-fire the same (rule, entity_key='')
  pair without piling up duplicates.
- `GET /family/readiness` maps `family_estate_readiness` → the `estate`
  component, so the insight explains the score, and
  `useFamilyData`/`api.ts` include the detector so the estate domain on
  the health page picks the insight up.
- Copy stays informational and non-regulated per CLAUDE.md: "not on
  file", point to a solicitor or will-writing professional, never "buy
  X". Estate gaps carry `impact_low`/`impact_high` of `0` — there is no
  honest minor-unit cost to invent.
- Household-level, not member-attributed — the vault documents estate
  instruments for the family, and attribution would need per-document
  member binding that doesn't exist yet.
- Tier 0 — detection only. No release, delegation, or dead-man's-switch
  logic; adult-only vault access is unchanged.

## Acceptance criteria

- [x] Detector loads under the real engine with `strictValidation: true`
      (the production mode).
- [x] Empty vault → both `estate_no_will` and
      `estate_no_power_of_attorney` fire on profile submit.
- [x] Will on file → only `estate_no_power_of_attorney` fires; both on
      file → no estate insights.
- [x] Documents outside `estate_vault` category and unrecognised
      `doc_type` values don't count.
- [x] A previously-open `estate_no_will` insight resolves once the will
      is on file (stale-resolution via the unconditional event).
- [x] Vault upload/delete re-evaluates immediately — uploading a will
      without a profile resubmit retires the gap, deleting the last PoA
      re-opens it.
- [x] Existing vault callers/tests unaffected (engine params optional).
- [x] Document-apply and inbox-apply regeneration paths (which share
      `evaluateProfileAndGenerateInsights`) emit the estate event too.

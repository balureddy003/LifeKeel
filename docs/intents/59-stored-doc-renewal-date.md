# Intent 59: Renewal date on stored documents

**Problem** — Carried partial from intent 27: uploaded documents have no renewal-date field, so 'stored + confirmed' can't show when cover renews.

**Done looks like**
- Optional renewal_date on stored docs, editable; surfaced in the doc list and fed to the renewal detectors' derivation

**Constraints**
- Tier 0 — schema + display. Feeds existing renewal detectors.

**Out of scope** — new features beyond the listed fix.

**Becomes** — PRD in docs/prd/ on acceptance.

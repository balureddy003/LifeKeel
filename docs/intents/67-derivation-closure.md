# Intent 67: Derivation closure + measured invalidation (M1)

**Problem** — Engine review: provenance is a trail, not a graph — 'grandma's access revoked' can't compute the minimal set of artefacts to invalidate. Needed for IP claim 2.

**Done looks like**
- Each insight/projection stores its closure (signal values, extraction version, permission version, detector version)
- invalidate(change) returns the minimal artefact set; a profile write only recomputes artefacts naming that version; recomputes-avoided is measured

**Constraints**
- Tier 0 — engine plumbing; larger work item.

**Out of scope** — new features beyond the listed fix.

**Becomes** — PRD in docs/prd/ on acceptance.

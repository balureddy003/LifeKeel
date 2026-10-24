# Intent 25: Blended-family member relationship labels

**Problem** — Both reviews flagged that all children appear as one flat
household roster: a blended family can't distinguish "my child", "partner's
child", or "shared", and the chart gives no visual cue. Blended households
were the lowest-scoring demographic in the critic review (low–medium
usefulness) partly for this reason.

**Done looks like**
- Each child/member gains an optional organizer-entered relationship label
  (e.g. birth child / step-child / partner's child / shared) stored on the
  member record in `family-group.ts`'s roster model.
- The family chart and member list render the label as a small tag/icon;
  the financial profile's dependents section uses it where the label is
  material (e.g. per-child education attribution).
- The label never implies legal status — copy makes clear it's descriptive
  for the family's own clarity.
- Tests cover schema acceptance, rendering, and that the label is absent
  (not defaulted) when never chosen.

**Constraints**
- Trust tier: 0 — metadata on the existing roster.
- Regulated-advice check: none.
- Data/privacy: labels describe minors — organizer-entered only, covered by
  the children's-data posture (intent 09); never surfaced in youth view or
  marketing telemetry.

**Out of scope** — legal guardianship/custody modelling, estate-map roles
(PRD-137 territory), per-member financial-split logic driven by the label.

**Becomes** — PRD in docs/prd/, amending PRD-001's people domain.

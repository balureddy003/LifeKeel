# Intent 54: Profile completeness recalibration

**Problem** — QA pass 1: after saving a full financial profile the wizard still showed 18% — unfilled domains (education, assets, documents) dominate the denominator.

**Done looks like**
- Completeness weights sections the user was actually asked to complete; each section's contribution is visible (per-section breakdown) so the number explains itself
- Saving the core financial steps lands materially above 18%

**Constraints**
- Tier 0 — presentation.

**Out of scope** — new features beyond the listed fix.

**Becomes** — PRD in docs/prd/ on acceptance.

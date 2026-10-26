# Intent 53: Sample label vs partial-data banner

**Problem** — QA pass 1: home damage showed the intent-21 'Using the data you have so far' banner AND still labelled the result 'sample' — contradictory states.

**Done looks like**
- When missing_inputs is non-empty the surface reads 'partial — your data + named gaps', never 'sample'; 'sample' is reserved for zero personal data
- Single source of truth for the label shared by scenario card + narrative

**Constraints**
- Tier 0 — presentation.

**Out of scope** — new features beyond the listed fix.

**Becomes** — PRD in docs/prd/ on acceptance.

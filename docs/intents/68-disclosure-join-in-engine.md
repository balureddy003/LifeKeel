# Intent 68: Disclosure join inside evaluate (M2)

**Problem** — Engine review: youth redaction happens at the HTTP route, but a derived insight can still be built from a field that member can't see — the lattice is missing its enforcement point.

**Done looks like**
- Inputs tagged household|organiser|member|youth; the insight's disclosure label is the join (most restrictive); a youth request can never receive an estate amount — enforced inside evaluate, not at the route

**Constraints**
- Tier 0 — engine + tripwire tests.

**Out of scope** — new features beyond the listed fix.

**Becomes** — PRD in docs/prd/ on acceptance.

# Intent 65: Numeral-presence test + sample-path deletion

**Problem** — Engine-vs-surface review (2026-10-25): the solver is careful but the UI still has a sample-scenario branch — some rendered numbers aren't calculate.ts output. World-class = one solver, one version, and every numeral on screen comes from the solver payload.

**Done looks like**
- A test fails if any rendered numeral on a scenario/score/Ask Keel surface is absent from the solver payload that produced it
- The sample-scenario copy path is deleted — partial data renders 'using what you have so far' + missing_inputs, never invented figures
- Every scenario/score detail calls calculate.ts

**Constraints**
- Tier 0 — test + display. This is also the evidence exhibit for IP claim 1.

**Out of scope** — new features beyond the listed fix.

**Becomes** — PRD in docs/prd/ on acceptance.

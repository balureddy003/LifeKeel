# Intent 52: Event detail resolves server event ids

**Problem** — QA pass 1: the job-loss event detail showed 'This event could not be found' — the events list links server event ids but the detail page only searches the static LIFE_EVENTS catalog.

**Done looks like**
- Detail page resolves a server-side event id to its catalog scenario (scenarioId/scenario_id) before falling back to LIFE_EVENTS, so any linked event renders
- An unresolvable id shows the event's own name/type rather than 'could not be found'

**Constraints**
- Tier 0 — display.

**Out of scope** — new features beyond the listed fix.

**Becomes** — PRD in docs/prd/ on acceptance.

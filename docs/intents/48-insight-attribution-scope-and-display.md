# Intent 48: Insight attribution scope + display names

**Problem** — QA pass 2 (2026-10-25): ticking ONE playbook step resolved FIVE unrelated insights, and the activity feed shows raw ids ('You acted on: no_income_protection'). insight-attribution.ts:112 falls back to raw rule_id when hypothesis is empty, and the match between a completed step and the insights it credits is too broad. Wrong credit erodes the 'you acted on' trust story.

**Done looks like**
- A playbook step completion resolves/credits only the insight(s) the step addresses (rule/entity match), not unrelated open insights
- Activity feed never renders raw rule_ids — falls back to the detector's human display title, and only then a generic 'a flagged gap'
- Regression test: completing one step does not mark other insights as acted on

**Constraints**
- Tier 0 — display + bookkeeping. Advice check: copy stays informational. No new data stored.

**Out of scope** — new features beyond the listed fix.

**Becomes** — PRD in docs/prd/ on acceptance.

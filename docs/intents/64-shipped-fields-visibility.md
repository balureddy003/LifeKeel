# Intent 64: Visibility pass on shipped-but-hidden fields

**Problem** — Demographic matrix flags 'no blended labels' and 'no variable-income note' — both shipped (intents 25/26: relationship_label, income_notes) but not surfaced where the tester looked. Either they render in the wrong place or only appear in edit flows.

**Done looks like**
- relationship_label shows on the family chart/member rows once set, not only in the editor
- income_notes is visible on the income step and flows to Ask Keel grounding (already) — verify the deployed build renders it
- Invite status shows 'sent/viewed' once intent 63 lands

**Constraints**
- Tier 0 — display.

**Out of scope** — new features beyond the listed fix.

**Becomes** — PRD in docs/prd/ on acceptance.

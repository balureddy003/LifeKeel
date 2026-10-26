# Intent 51: Runway + money copy honesty

**Problem** — Two QA passes: fake-precise '150 months' runway when a tiny shortfall makes savings last years; 'cover about less than a month'; '0 months'; '£3500.00'; '£-2000.00' negative money. runwayMonths() math is sound — the display layer over-promises precision and mishandles edges.

**Done looks like**
- Runway > ~60 months renders as a rounded phrase ('many years'/'over five years') or shows the small monthly shortfall instead of a fake-precise count
- Negative runway floors at 0; 'less than a month' phrasing is grammatically correct; money never shows '£-x' or double-decimal tails
- Same phrasing rules applied consistently in ScenarioCard, Ask Keel, playbooks

**Constraints**
- Tier 0 — presentation. Advice: informational arithmetic only.

**Out of scope** — new features beyond the listed fix.

**Becomes** — PRD in docs/prd/ on acceptance.

# Intent 24: Severity signalling on Home and insight cards

**Problem** — QA found the Home insight cards visually identical regardless of
seriousness: a household with debt payments >20% of income and under one
month of savings looks the same as one with a minor education-fund gap, and
cards aren't ordered by urgency (findings 5 and 10; the critic's "visual
severity" priority). A high-debt/zero-savings family needs unmistakable
"this is urgent" treatment; a mild gap shouldn't look like a crisis.

**Done looks like**
- A severity tier per insight/card derivable from the underlying numbers
  (e.g. critical: savings < 1 month runway, debt service > 20% of income, no
  will with dependents; important: meaningful cover/education gap;
  informational otherwise) — deterministic, not a new judgement call.
- Home sorts most-urgent first and renders a distinct treatment (coloured
  left border/icon, amber→red band) for critical states; mild gaps keep the
  current calm card.
- A dedicated "Debt pressure" state exists when debt service crosses the
  threshold, with concrete next actions from the existing detector action
  copy.
- The treatment is designed for at-a-glance scanning on a phone — the
  device test flagged urgency as unscannable on small screens; pairs with
  intent 20's compact component expander so the score is explainable
  without leaving the screen.
- Severity ordering is covered by a component test; copy passes
  `advice-rule.test.ts` (severity describes the numbers, never prescribes
  products).

**Constraints**
- Trust tier: 0 — presentation only.
- Regulated-advice check: "urgent" framing must stay factual ("savings cover
  under one month of expenses") — no fear copy, no "you must act now on a
  policy" steering.
- Data/privacy: none new.

**Out of scope** — notification escalation tiers (PRD-139), new detectors,
changing the readiness score (intent 20), education-prominence layout for
single parents beyond the same severity sort.

**Becomes** — PRD in docs/prd/.

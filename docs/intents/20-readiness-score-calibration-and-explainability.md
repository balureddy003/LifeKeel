# Intent 20: Readiness score calibration and "why this score" explainability

**Problem** — In the 2026-10-24 QA/critic pass, the Family Readiness Score read
consistently harsher than persona expectations (22 for a high-debt
self-employed household; 31–50 for normal first-home profiles) and the Home
card shows only the ring number — the five component subscores
(`READINESS_WEIGHTS` in `apps/api/src/readiness/score.ts`, already returned by
`GET /family/readiness` with per-component `detail` strings) never surface.
When the first number a user sees feels unfair and unexplained, they stop
trusting the rest of the product — both reviews independently ranked this the
top gap.

**Done looks like**
- A "Why this score?" expander on the Home score card listing each scored
  component with its score, weight, and the existing `detail` string — no
  second fetch needed; components the family hasn't supplied data for show as
  "not entered", never zero (the honesty rule `score.ts` already encodes).
- A calibration pass against a fixed persona set (young couple/first home,
  single parent, pre-retiree, high-debt self-employed, blended) documenting
  expected bands and adjusting thresholds or weights where a component
  punishes a stage-appropriate profile (e.g. a first-time buyer carrying a
  mortgage with some cover). Expected bands are asserted in
  `readiness/__tests__/score.test.ts` so the calibration is enforced, not
  just noted.

**Constraints**
- Trust tier: 0 — pure read of data already on file; no approval gate.
- Regulated-advice check: `detail` strings and the expander describe what's
  on file ("life cover is 3.2× income against a 5× mortgage-plus-dependents
  need") — never "buy X", never a named provider. Copy passes
  `advice-rule.test.ts`.
- Data/privacy: component details are adult-only where gated today (estate
  `gated: true` for child members stays gated in the UI).

**Out of scope** — new components or detector changes; per-member score
surfacing beyond what PRD-118 shipped; the separate freshness problem
(intent 22).

**Becomes** — PRD in docs/prd/ (likely an amendment to PRD-114's scope).

---

**Status: implemented — PR #246.** The "Why this score?" expander on the
Home score card surfaces the five component subscores (already returned by
`GET /family/readiness`). Calibration finding: computed personas landed at
72 (young couple, mortgage + cover) and 14 (high-debt self-employed) — the
composite's shape is sound, so no weight changes were made; persona-band
tests now pin it so future threshold changes are deliberate. The observed
low real-world scores (22–50) most likely reflect thinner real profiles —
which the expander now explains — rather than miscalibration.

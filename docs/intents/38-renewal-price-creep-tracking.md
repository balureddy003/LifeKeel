# Intent 38: Renewal price-creep tracking on recorded policies

**Problem** — The 2026-10-24 PMF report names "renewal & price-creep alerts
tied to actual uploaded policies" a high-impact Plus differentiator. The
renewal *date* side exists (`policy_renewal_window` and
`policy_renewal_date_in_past` in `detectors/family/`), but nothing tracks the
*premium* over time: a policy that auto-renews 20% dearer every year is
invisible — one of the most common real-world ways families overpay, and the
kind of quiet noticing the product is for.

**Done looks like**
- The policy record keeps premium history (each update appends
  `{amount, effective_from}` rather than overwriting) — via manual edit now,
  via PRD-143 extraction later.
- A detector rule fires when a recorded premium increases vs the previous
  entry (threshold e.g. >5% or above CPI), producing an informational
  insight: "Your {policy type} premium went from £X to £Y at renewal" with
  the neutral next-step pattern the family detectors already use ("check the
  renewal documents", "compare quotes from multiple insurers", "a licensed
  professional can advise").
- Insight appears at renewal-confirmation time; history is shown on the
  policy so the creep is visible, not just the latest number.
- Detector YAML + golden eval + profile/frontend surface per the
  add-detector recipe; copy passes `advice-rule.test.ts`.

**Constraints**
- Trust tier: 0 — detection and display of the family's own recorded data.
- Regulated-advice check: this rule lives one line away from rule 2.
  Alerting that *their own* recorded premium rose is informational; anything
  resembling "switch to a cheaper provider", a named alternative, or a
  price-comparison feature is insurance arranging and stays out — the
  detector must never emit a comparison or a provider name. Copy review
  required.
- Data/privacy: premium history is existing profile data, same tenant scope
  and erasure.

**Out of scope** — market price comparison or benchmarking against "typical"
premiums (needs a market data source *and* drifts toward advice — see
PRD-README's "deliberately not written" note on market research), automatic
premium capture (PRD-143), any insurer contact (PRD-103's prepare-only
drafts are the ceiling).

**Becomes** — PRD in docs/prd/, a detector addition to the
`policy-review.yaml` family.

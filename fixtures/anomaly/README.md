# anomaly — synthetic multi-month series for the slice-8 evaluation

12 made-up households × 14 months of money-in/money-out totals (minor
units), with 16 planted anomalies — 10 gross (≥ ~3× or ≤ ~0.3×) and 6
subtle (1.3–1.45×, 0.78–0.8×) — so a robust rule has a real gap to miss.

- `generate.py` — seeded generator; rerun to regenerate
  `monthly-series.json` deterministically.
- `monthly-series.json` — `{households, expected_flags}`; expected flags
  name household, period, metric and direction (never amounts in flags).

## Scoring

`apps/api/src/resilience/__tests__/anomaly-eval.test.ts` runs the
deterministic baseline (`resilience/anomaly-flag.ts`, median/MAD modified
z-score) over every household/metric and reports recall and false-flag
rate. Current measured baseline: **recall ≈ 0.69, false-flag ≈ 0.006** —
the number a CatBoost helper must beat (owner-set margin, proposed ≥10
points recall at the same false-flag rate) before it can ship. If CatBoost
never beats it, the baseline ships and CatBoost is dropped.

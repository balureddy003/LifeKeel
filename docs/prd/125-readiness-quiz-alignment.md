# PRD-125: readiness-quiz alignment with the composite score

## Problem

The public `/readiness-quiz` lead magnet computed its own number —
`100 − Σ confidence × 10` over fired insights — a "how many flags did
the detectors raise" formula the product deliberately retired in
PRD-114. The quiz marketed a different metric than the app actually
computes, so a prospect's quiz score couldn't predict their in-app
Family Readiness Score.

## Who it's for

Cold visitors whose quiz score should honestly preview what the real
product will tell them — and the conversion funnel reading their
component-level gaps.

## What "done" looks like

- The six quiz answers fold into a synthetic `FinancialProfile` and
  score through `computeReadiness` — the exact function
  `GET /family/readiness` runs. Dependents become empty synthetic
  education funds (targets unset → they mark "has dependants" for
  protection without inventing a savings goal).
- Only collected components score: `emergency_fund` + `protection`.
  Retirement/education return null; `estate` is passed `null`
  (vault-gated) and comes back gated — all three drop out of the
  weighted mean, the same "no data → no score" honesty rule as the
  authenticated score. Estate never reads as a dishonest 0 for someone
  who was never asked about it.
- The response now carries `components` — the shared scorer's own
  labels, weights, and detail lines — alongside the existing
  detector-produced `insights` and `score` (additive; the engine
  evaluation still runs purely to explain the score).
- Anonymous posture unchanged: no `persistSignal`, synthetic per-request
  tenant, only a score-band growth event (`unscored` when null).
- Web quiz page renders the component breakdown under the score ring and
  its copy now honestly names what was and wasn't measured.

## Acceptance criteria

- [x] Quiz response `components` matches `/family/readiness`'s component
      vocabulary and weight-renormalized math (regression test recomputes
      the expected composite from the response itself).
- [x] Uncollected components return `score: null` and are excluded from
      the mean — never counted as 0.
- [x] Existing behavior preserved: score ordering
      (under-protected < well-covered), no persisted signal, anonymized
      funnel event, 400 on malformed answers.
- [x] 6 tests green in `readiness-quiz.test.ts`; api + web typecheck
      clean.

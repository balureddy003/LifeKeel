# PRD-132 — Multi-step scenario timelines + non-job-loss event surfaces

## Problem
PRD-115 shipped time-shifted scenarios, but two limits remained: a scenario
could only express *one* regime change ("income drops in 6 months"), and the
only event tile that ever ran scenario math was job-loss — bereavement,
disability, medical, new-child and university tiles stayed static copy.

## Solution

### Multi-step timelines (`scenarios/calculate.ts`)
`ScenarioChange.steps: ScenarioStep[]` — ordered regime changes with
cumulative income/expense deltas (`{ atMonth, monthlyIncomeDeltaMinor?,
monthlyExpenseDeltaMinor? }`). The engine walks each segment under whatever
regime is in force, accreting/draining the emergency fund (floored at 0),
and returns:

- `timeline`: one point per step — income, expenses, fund balance, runway
  under that regime.
- `fundDepletedAtMonth`: the month the fund hits zero mid-timeline — the
  case endpoint math alone hides ("income returns at month 12, but the fund
  ran out at month 7").
- The existing endpoint fields describe the *final* regime, so single-step
  consumers are untouched; `steps` takes precedence over the flat
  delta/horizon shorthand; `monthlyExtraSavingsMinor` still applies
  throughout (it's the family's decision today, not part of the event).

Schema bounds: ≤12 steps, atMonth 0–360 — same envelope as the existing
horizon.

### Event surfaces (`/events/[eventId]`)
The inline job-loss card became a template-driven `ScenarioCard` covering:

| Event | Template | Shape |
|---|---|---|
| job-loss | household income → 0 at N months | flat (existing) |
| bereavement | one earner's income stops | single step |
| disability | earner income stops now, returns at mo 12 | multi-step dip/recover |
| medical | +£X/mo costs for a year, then settle | multi-step expense |
| new-child | +£X/mo ongoing, starting at N months | step at horizon |
| university | save £X/mo toward a child's fund | education projection |

Earner selectors are built from the real roster + profile members; amount
chips are honest round numbers; every narrative runs through `MoneyText`
so Child mode never shows £.

## Boundaries
- Still pure deterministic math on profile data — no LLM calculates, no
  autonomous action, Tier 0. Saved scenarios recompute on read as before.
- Templates model *declared* inputs, not predictions — "if X's income
  stopped," never "when X dies."

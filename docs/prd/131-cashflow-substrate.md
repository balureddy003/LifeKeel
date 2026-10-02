# PRD-131 — Cash-flow substrate (manual ledger)

## Problem
Readiness runway and scenarios reason about "what comes in vs what goes out",
but the only substrate was the static annual-figure profile — stale the moment
it's saved. Live bank feeds are blocked on connector partnerships (gap 9's
hard half), so households had no way to keep the monthly picture current.

## Solution
A tenant-scoped manual cash-flow ledger — the interim substrate until live
feeds exist:

- `GET/POST /family/cashflow`, `PATCH/DELETE /family/cashflow/:id` — recurring
  income/expense entries (label, minor-unit amount, recurrence:
  weekly/monthly/yearly/once).
- `GET` returns a computed summary: monthly inflow, monthly outflow
  (non-monthly recurrences normalized), net, and runway = emergency savings ÷
  net burn (null when net ≥ 0 or no savings figure).
- `/cashflow` page: in/out/net strip, runway line, entry list with delete,
  add-entry form (money-in/out toggle, label, £, recurrence).
- Link card on `/financial-profile` so the ledger is discoverable beside the
  figures it complements.

## Boundaries
- Entries are declarations, not transactions — no bank connection, no
  categorization magic, no LLM. Tier 0 informational.
- Tenant-scoped collection (`family_cashflow_entries`); organizer OR any
  active adult can manage the shared household ledger.
- Live-feed integration (open banking etc.) is PRD-133 territory — this
  ledger is deliberately separate so a future connector *writes* into the
  same shape rather than replacing it.

# Intent 94: resilience engine loop ledger

Drives the verifier-first loop for intent 93. Status is machine-checked, not edited by hand: a row is
**done** when its `file` exists on main and its `verify` command passes there. Rows marked **blocked**
carry the owner question; the loop never guesses them. Engine changes are always a human merge (A4).

Scope the loop may build: pure per-household Tier 0 code in `apps/api/src/resilience/`, eval files,
source-cited data, docs. Never: MCP server, cross-tenant learning, business graph, second datastore, any
model call, any output showing one adult's figures to another, any action naming or steering to a product.

| Row | What | file | verify | Status |
|---|---|---|---|---|
| R1 | Monthly cash-flow model: months of runway from savings, spend, monthly inflows | `apps/api/src/resilience/cashflow.ts` | `pnpm --filter @lifekeel/api exec vitest run src/resilience/__tests__/cashflow.test.ts` | done (2026-11-14) |
| R2 | Event: income stops (an earner's pay ends; protection on file applies after a stated wait) | `apps/api/src/resilience/events.ts` | `... vitest run src/resilience/__tests__/events.test.ts` | done (2026-11-14) |
| R3 | Event: mortgage fix ends (payment rises by a stated figure) | `apps/api/src/resilience/events.ts` | same | done (2026-11-14) |
| R4 | Event: death of an earner (pay ends; cover payout on file arrives as a lump sum) | `apps/api/src/resilience/events.ts` | same | done (2026-11-14) |
| R5 | Events in combination, same month and staggered | `apps/api/src/resilience/combine.ts` | `... vitest run src/resilience/__tests__/combine.test.ts` | done (2026-11-14) |
| R6 | With-and-without ranking over informational action kinds only | `apps/api/src/resilience/rank.ts` | `... vitest run src/resilience/__tests__/rank.test.ts` | done (2026-11-14) |
| R7 | Range display: low and high runway, never a single point; states what is left out | `apps/api/src/resilience/range.ts` | `... vitest run src/resilience/__tests__/range.test.ts` | done (2026-11-14) |
| R8 | One verifier command that runs R1 to R7, the detector evals and the A1 tripwire | `scripts/engine-verify.sh` | `bash scripts/engine-verify.sh` | done (2026-11-14) |
| R9 | Mechanical extraction checks (dates real, totals add up, monthly times twelve, amounts whole) applied to a fixed per-document schema, before any user confirm | `apps/api/src/resilience/extraction-checks.ts` | `... vitest run src/resilience/__tests__/extraction-checks.test.ts` | todo |
| R10 | Event rates data file: each row has event, rate or duration, source (ONS or DWP), table, date and range; rows without a source are absent, never guessed | `apps/api/data/resilience/event-rates.json` | see B2 | todo |
| R11 | Visibility rule: adult family members see the household's engine output; every other role sees none until decided | `apps/api/src/resilience/visibility.ts` | see A5 | todo |
| B2 | Event frequency and duration table | `apps/api/data/resilience/event-rates.json` | `... vitest run src/resilience/__tests__/event-rates.test.ts` | decided 2026-11-14: ONS and DWP both approved; build row R10 |
| B3 | Two-date fact store and erasure (MongoDB, `valid_from` + `recorded_at`, allow-listed money figures only) | `apps/api/src/resilience/fact-store.ts` | `pnpm --filter @lifekeel/api exec vitest run src/resilience/__tests__/fact-store.test.ts` | done (2026-11-14) |
| B4 | Datastore | n/a | n/a | decided 2026-11-14: MongoDB, no second datastore |
| B6 | Document ingestion | n/a | n/a | decided 2026-11-14: upload or mailbox, either; rules in `docs/research/engine-ingestion-note-2026-11-14.md`. Build row R9 below |
| B7 | Benefits estimate (PolicyEngine UK) | n/a | n/a | blocked: owner will take a commercial licence. No integration until a signed licence is on file; question: from whom, and does it cover a hosted service? |
| B8 | Friction cap and cost ceiling | n/a | n/a | blocked: owner sets the per-household monthly cost ceiling |
| A5 | Visibility of engine output | `apps/api/src/resilience/visibility.ts` | `... vitest run src/resilience/__tests__/visibility.test.ts` | decided 2026-11-14 for adult family members (see intent 93); build row R11. Other roles and the safeguarding cases stay blocked |
| A6 | Business graph | n/a | n/a | blocked: segment decision |
| A7 | Patent secrecy rule | n/a | n/a | blocked: attorney |
| A8 | Activation path | n/a | n/a | blocked: owner |

Stop condition: every row done or blocked, and `bash scripts/engine-verify.sh` passes on main.

Checked 2026-11-14 on main: R1 to R8 files exist and `bash scripts/engine-verify.sh` passes. R9 to R11 are the next rows. Rows marked blocked wait on the owner decisions listed.

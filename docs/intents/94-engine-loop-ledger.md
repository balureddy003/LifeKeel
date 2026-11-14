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
| B2 | Event frequency and duration table | n/a | n/a | blocked: which sources (ONS, DWP tables) do you approve? Rows without a source stay absent |
| B3 | Two-date history store and erasure | n/a | n/a | blocked: needs B4 and a surface decision; build with the store |
| B4 | Datastore (MongoDB with `valid_from`/`recorded_at` vs Postgres) | n/a | n/a | blocked: owner decision |
| B6 | Document ingestion design | n/a | n/a | blocked: upload-first and Gmail Limited Use rule need your confirmation |
| B7 | Benefits estimate (PolicyEngine UK) | n/a | n/a | blocked: AGPL opinion from a solicitor |
| B8 | Friction cap and cost ceiling | n/a | n/a | blocked: owner sets the per-household monthly cost ceiling |
| A5 | Two-adult visibility of engine output | n/a | n/a | blocked: H23, H25, H26, H29 and PRD-229 decisions |
| A6 | Business graph | n/a | n/a | blocked: segment decision |
| A7 | Patent secrecy rule | n/a | n/a | blocked: attorney |
| A8 | Activation path | n/a | n/a | blocked: owner |

Stop condition: every row done or blocked, and `bash scripts/engine-verify.sh` passes on main.

Checked 2026-11-14 on main: R1 to R8 files exist and `bash scripts/engine-verify.sh` passes (48 resilience tests, 19 engine tests). Rows marked blocked wait on the owner decisions listed above.

# IMS objectives and KPIs

| Field | Value |
|---|---|
| Document ID | LK-IMS-070 |
| Version | 0.1 |
| Status | DRAFT — awaiting approval |
| Owner | IMS manager (role) |
| Approver | CEO / top management (role) |
| Approved | — |
| Next review | — |

ISO 9001 / 27001 / 42001 Clause 6.2 and 9.1. These are the objectives from
ISO_AUDITABLE.md §20. Each row records **where the number comes from today**. "Not
instrumented" means no source exists in the repository yet. That is an action, not a reason
to drop the objective. Targets are proposals until management approves them, and they must
be checked against real traffic first.

Reviewed monthly by the IMS manager. Results are recorded in the monthly KPI record (one
file per month under `docs/ims/management-reviews/kpi-YYYY-MM.md`) and reported to
management review.

| # | Objective | Metric | Target (proposed) | Source today | Owner (role) |
|---|---|---|---|---|---|
| O1 | Deterministic API availability | non-5xx ratio, 28 days | ≥ 99.9% | **Not instrumented.** `prom-client` is a dependency but no HTTP request metric is registered; use Cloud Run request metrics until one is | SRE / on-call lead |
| O2 | Interactive latency | p95 / p99 | < 500 ms / < 2 s | **Not instrumented** (as O1); Cloud Run latency metrics in the meantime | SRE / on-call lead |
| O3 | Ask Keel answers or falls back honestly within the deadline | share of calls with outcome recorded within `deadline_ms` | ≥ 99.5% | `ai_task_calls` (written by `apps/api/src/ai/task-gateway.ts`; alerting in `jobs/ai-health-alert.ts`) | AI governance lead |
| O4 | Cross-tenant or unauthorised-member disclosure | count | **0** | Incident records (`docs/runbooks/breach-response.md`); `keel_concerns` with category `privacy` | IMS manager |
| O5 | Regulated-advice escapes | confirmed escapes | **0** | `keel_concerns` category `advice` after triage (`docs/runbooks/ai-concerns.md`); `advice-rule.test.ts` in CI | AI governance lead |
| O6 | Unintended duplicate external actions | count | **0** | `action_receipts` (`apps/api/src/actions/action-executor.ts`) | Principal developer |
| O7 | Critical/High vulnerabilities past SLA | count | 0 | `security.yml` runs; issues labelled `security` (`docs/security/vulnerability-management.md`) | Principal developer |
| O8 | Restore drill succeeds within RTO | drills passed per year | 4 of 4 | Drill log (`scripts/ops/restore-drill.ts`, `docs/runbooks/backup-restore.md`) | SRE / on-call lead |
| O9 | Staff trained (security, privacy, AI literacy) | % | 100% annually | Training records: **external, system TBD** | CEO / HR |
| O10 | Access reviews completed on time | % | 100% quarterly | Access review records (`docs/ims/audits/evidence-pack.md`, GitHub export) | IMS manager |
| O11 | AI processors with a current review | % | 100% (a lapsed review blocks the processor) | `definitions/ai-processors.yaml` review dates | AI governance lead |
| O12 | AI tasks with a current impact assessment and passing evals | % | 100% | `docs/ims/ai-impact/assessments.yaml`; `eval_runs` (`apps/api/src/eval/eval-runs.ts`) | AI governance lead |
| O13 | Rights requests answered within one month | % | 100% | Rights request log (`docs/runbooks/rights-requests.md`) | Privacy lead / DPO |
| O14 | Customer satisfaction | CSAT / NPS | Set a baseline first, then a target | **Not instrumented** (G-QMS-01) | Product manager |
| O15 | Corrective actions closed on time | % | ≥ 90% | `docs/ims/nc-log.yaml` | IMS manager |

## Actions this table creates

- Register an HTTP request counter and duration histogram (O1, O2), or record that Cloud
  Run metrics are the approved source.
- Choose a CSAT/NPS instrument (O14, G-QMS-01).
- Name the system that holds training records (O9).

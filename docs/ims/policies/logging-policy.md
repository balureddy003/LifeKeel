# Logging and monitoring policy

| Field | Value |
|---|---|
| Document ID | LK-IMS-035 |
| Version | 0.1 |
| Status | DRAFT — awaiting approval |
| Owner | Architect (role) |
| Approver | CEO / top management (role) |
| Approved | — |
| Next review | — |

ISO/IEC 27001 A.8.15, A.8.16, A.8.17, A.5.28; ISO/IEC 42001 A.6.2.8.

## Statements

1. **Audit log** records security-relevant and consequential events (sign-in, approvals,
   deletions, operator actions); it is append-only by convention and kept 7 years.
2. **Metadata first.** Application and AI telemetry records task, model, cost and outcome, not
   prompts or completions; prompt/completion capture is off by default.
3. **No secrets or family content in logs.** URLs and secrets are scrubbed before logging.
4. Loss of an audit record raises an alert.
5. Logs are protected from alteration; a tamper-evident export is the target (G-SEC-03).
6. Security monitoring use-cases (auth anomalies, operator actions, mass export) alert to the
   on-call lead (A.8.16).
7. Clocks rely on cloud-provided time synchronisation (A.8.17).

## Enforced today

`apps/api/src/audit/audit-log.ts`, `apps/api/src/__tests__/audit-log.test.ts`,
`apps/api/src/observability/redact.ts`, `apps/api/src/operator/operator-audit.ts`,
`packages/platform/src/guard-event-sink.ts`, `packages/platform/src/cost-ledger.ts`;
retention windows in `docs/data-retention.md`.

## Not yet in place

Tamper-evident/WORM audit export and mandatory audit for consequential actions (G-SEC-03);
defined monitoring use-cases with alert routing (A.8.16); retention for AI eval captures
(G-OPS-04).

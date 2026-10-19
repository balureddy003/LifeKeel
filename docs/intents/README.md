# Intents

Intents are the lightweight precursors to PRDs, per `docs/templates/intent.md`
and CONTRIBUTING.md's loop. Each file here is a stub for one Stage A item in
[docs/reviews/architecture-remediation-plan-2026-10.md](../reviews/architecture-remediation-plan-2026-10.md)
(the gap-execution plan); when accepted, it becomes a numbered PRD in
`docs/prd/` or an amendment to an existing one.

| File | Stage A item | Overlaps existing PRD |
|---|---|---|
| `00-architecture-claims-fitness-tests.md` | Stage 0 conformance machinery | — |
| `01-mandatory-ai-task-gateway.md` | A1 AI gateway enforcement | PRD-142 (registry spec) |
| `02-signed-link-approval.md` | A2 signed-link strengthening | — |
| `03-unified-publish-policy.md` | A3 publish-policy conflict | — |
| `04-erasure-and-backup-reconciliation.md` | A4/A5 erasure + backup↔erasure | PRD-146 (deletion receipts) |
| `05-backup-restore-baseline.md` | A6 restore drill | — |
| `06-federated-warmstart-and-eval.md` | A7 rule-3 violation fix | — |
| `07-durable-required-queue.md` | A8 queue durability | — |
| `08-migration-deploy-gate.md` | A8 migration gate | — |
| `09-childrens-data-posture.md` | A9 children's data | — |
| `10-claim-drift-remediation.md` | A10 drift fixes | mostly fast-path PRs |

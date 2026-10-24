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
| `11-device-runtime-verification-and-eval-harness.md` | Device-first §8.4a — weakest-runtime eval gate | — |
| `15-per-post-tagging-and-weekly-table.md` | Marketing engine step 2 — post tag, features, visits-per-post table | PRD-210 |
| `16-minimal-content-studio.md` | Marketing engine step 3 — three formats in YAML, brand cards | PRD-210 |
| `17-invite-and-share-loop.md` | Marketing engine step 4 — partner invite prompt, emergency sheet, referral | PRD-110, PRD-112 |
| `18-distribution-playbook.md` | Marketing engine step 5 — founder-run distribution plan | — |
| `19-learner-and-weekly-brief.md` | Marketing engine step 6 — shadow learner and weekly brief (gated on traffic) | PRD-210 |

Shared build context for 15 to 19: [marketing-engine-build-notes.md](marketing-engine-build-notes.md).

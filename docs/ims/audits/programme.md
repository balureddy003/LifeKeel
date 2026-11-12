# Internal audit programme

| Field | Value |
|---|---|
| Document ID | LK-IMS-080 |
| Version | 0.1 |
| Status | DRAFT — awaiting approval |
| Owner | Internal auditor (role) |
| Approver | CEO / top management (role) |
| Approved | — |
| Next review | — |

ISO 9001 / 27001 / 42001 Clause 9.2; method per ISO 19011. Closes the *programme* half of
**G-MGT-07**. The gap closes only when one full cycle has run with records (§21 of
ISO_AUDITABLE.md).

## Independence

The auditor must not audit their own work (`docs/ims/roles.md`). On a small team that
means a contractor for any area the principal developer or IMS manager built. Each
audit report records how this was met.

## Programme (first 12 months)

| Audit | Scope | When (proposed) | Auditor | Method |
|---|---|---|---|---|
| IA-1 | Clauses 4–10, all three standards | Phase 3, at least 6–8 weeks before Stage 1 | Independent | Interviews, records sampling |
| IA-2 | ISO 27001 Annex A organizational and people controls | Split across two audits in the year | Independent | Records, interviews |
| IA-3 | ISO 27001 Annex A technological controls | Phase 3 | Independent, with technical skill | Config review, `evidence-pack.md` output, sampled PRs |
| IA-4 | ISO 42001 Annex A and the AI impact assessments | Phase 3 | Independent, with AI skill | `ai-tasks.yaml`, `ai-processors.yaml`, `eval_runs`, sampled outputs, `keel_concerns` |
| IA-5 | ISO 9001 Clause 8 (SDLC, suppliers, release) | Phase 3 | Independent | 10 PRs sampled end to end |
| Ad hoc | After a major incident or scope change | As needed | Independent | Targeted |

## Each audit produces

1. A plan (scope, criteria, sample, dates), using `checklist-template.md`.
2. Evidence notes, with every finding traced to a record, a file path, or an interview.
3. A report with findings graded S1–S4 and observations.
4. One `docs/ims/nc-log.yaml` entry for every nonconformity.
5. An input to the next management review.

Reports are stored as `docs/ims/audits/IA-<n>-<YYYY-MM>.md`. Interview notes that name
staff are kept outside the repository (see the records note in `docs/ims/README.md`).

## Sampling guide (ISO_AUDITABLE.md §21.1)

| Sample | What to ask for | Where the evidence is |
|---|---|---|
| 10 merged PRs | PRD or intent link, test that fails without the change, review approval, CI pass, deployment approval | `scripts/ims/evidence-pack.sh` → `merged-prs.json`; GitHub deployments |
| 3 AI tasks | registry entry, processor approval, impact assessment, `eval_runs`, guard events | `definitions/ai-tasks.yaml`, `definitions/ai-processors.yaml`, `docs/ims/ai-impact/assessments.yaml` |
| 2 deletion receipts | erasure completeness, replay | `deletion_receipts`, `jobs/erasure-replay.ts` |
| Audit-log integrity | last `audit-seal` run verified; anchor hashes match the log sink | `audit_anchors`, log entries `audit.anchor` |
| 1 restore drill, 1 tabletop, last access review | records with dates and names | drill log, tabletop record, `evidence-pack.sh` output |
| 3 suppliers | certificate, DPA, review date | supplier register (G-SUP-03) |
| 2 joiners/leavers | onboarding/offboarding checklist | HR records (external) |

# Stage 2 preparation

| Field | Value |
|---|---|
| Document ID | LK-IMS-102 |
| Version | 0.1 |
| Status | DRAFT — awaiting approval |
| Owner | IMS manager (role) |
| Approver | CEO / top management (role) |
| Approved | — |
| Next review | — |

ISO_AUDITABLE.md §16 Phase 4 step 24 and §22. Stage 2 tests whether the IMS **operates**:
the CB samples records, interviews role holders and observes controls working. Stage 2
follows a Stage 1 with no open blocking item (`stage1-readiness.md`) and about 12 weeks of
operating records (§16).

Nothing here is an audit result. It lists what will be asked for and where the answer lives.

## 1. Records the CB will sample

Policy-as-code controls (ISO_AUDITABLE.md §5.1). The CB samples the **operating record**,
not the test file; the test file shows the control exists, the record shows it ran.

| Control | Executable control | Operating record to show | How to produce it | Known weakness |
|---|---|---|---|---|
| Rule 1: no autonomous irreversible action without human approval | `apps/api/src/__tests__/trust-tier-gate.test.ts` | CI runs on sampled PRs; `action_receipts` with `approved_by` | `merged-prs.json` from `scripts/ims/evidence-pack.sh` (check results); receipts query on production by the SRE, shown on screen | — |
| Rule 2: no regulated advice | `packages/engine/src/__tests__/advice-rule.test.ts`, `scripts/hooks/advice-check.sh` | CI runs; PR template advice checkbox on sampled PRs | `merged-prs.json`; PR bodies | PR approval not recorded (NC-2026-005) |
| Rule 3: family content is not training data | `apps/api/src/ai/task-gateway.ts`, `definitions/ai-tasks.yaml`, `definitions/ai-processors.yaml`, `apps/api/src/__tests__/ai-task-gateway.test.ts` | Boot logs (`AI_POLICY_EXCEPTION`), `llm_usage`, processor-registry git history | Cloud logging export filtered to boot lines; `git log -- definitions/ai-processors.yaml` | DPAs not on file (G-SUP-01); xAI exception (G-SUP-02) |
| AI artifacts pinned and documented | `ai-bom.yaml`, `docs/models/`, `apps/api/src/__tests__/architecture-claims.test.ts` | BOM history; CI | `git log -- ai-bom.yaml` | BOM text out of date (NC-2026-002) |
| Adversarial AI testing | `red-team/guard-fixtures.yaml` in CI | CI runs; `eval_runs` | CI history; `eval_runs` query | Per-task eval gates not wired (G-AI-01) |
| Erasure complete and survives restore | `apps/api/src/erasure.ts`, `apps/api/src/jobs/erasure-replay.ts`, `scripts/ops/restore-drill.ts` | 2 deletion receipts; latest restore-drill log | Receipts query; drill log | PITR off, drills manual (G-OPS-01) |
| Production change is human-approved | `.github/workflows/deploy-api.yml`, `.github/workflows/require-ci.yml` | GitHub deployment history with approver | `deployments.json`, `environments.json`, `deploy-api-runs.json` | No environment reviewers (NC-2026-006) |

Repository-configuration records, all from `scripts/ims/evidence-pack.sh`
(`docs/ims/audits/evidence-pack.md` explains what conforming output looks like):

| Pack file | Stage 2 question it answers | Clause / control |
|---|---|---|
| `branch-protection.json`, `rulesets.json` | Is review enforced before merge? | A.8.32, 9001 8.3 |
| `environments.json`, `deployments.json`, `deploy-api-runs.json` | Who approved each production deploy? | A.8.32, 9001 8.6 |
| `merged-prs.json` | 10 PRs end to end: intent/PRD, test, review, CI, deploy | 9001 8.3, A.8.25 |
| `collaborators.json` | Access review: every login maps to a role | A.5.15, A.5.18 |
| `signed-commits.txt`, `signed-commits-summary.txt` | Are commits signed since the date it was required? | A.8.4 |
| `dependabot-alerts.json` | Are vulnerabilities tracked against SLAs? | A.8.8 |
| `MANIFEST.txt` | Has the pack been altered since collection? | 7.5.3 |

Records the CB will sample that the pack does not produce (ISO_AUDITABLE.md §21.1):

| Record | Where | Status today |
|---|---|---|
| 3 AI tasks: registry entry, processor approval, signed impact assessment, evals, guard events | `definitions/ai-tasks.yaml`, `docs/ims/ai-impact/assessments.yaml` | Assessments unsigned (G-MGT-06) |
| Restore drill and tabletop records | drill log; tabletop record | No tabletop held (G-OPS-02) |
| Last access review | `collaborators.json` plus review sign-off | Not yet performed |
| 3 suppliers: certificate, DPA, review date | supplier register | Non-AI register missing (G-SUP-03) |
| 2 joiners/leavers: onboarding/offboarding checklists | HR system (external) | Not chosen (G-PEO-01) |
| Internal audit report and corrective actions | `docs/ims/audits/` | No audit held (G-MGT-07) |
| Management review minutes, signed | `docs/ims/management-reviews/` | No review held (G-MGT-07) |
| Monthly KPI records | `docs/ims/objectives.md` | None yet |
| Risk acceptances, signed | `docs/ims/risk/risk-register.yaml` (`acceptance`) | Pending (G-MGT-04) |
| Penetration test report and retest | external | Not commissioned (G-SEC-05) |

## 2. Controls the CB may ask to observe

Demonstrate on staging with synthetic data, never on production household data.

| Observation | What to show | Owner role |
|---|---|---|
| A change from intent to production | Open PR → CI → review → `workflow_dispatch` deploy with approval | Principal developer, Release approver |
| AI processor refusal | A task routed to an unapproved processor is refused outside `dev` | AI governance lead |
| Advice-rule tripwire | Editing detector copy to a recommendation verb fails the test | Principal developer |
| Account erasure | Delete a staging account; show the receipt; replay after restore | SRE |
| Operator access | Operator console step-up and dual control (`apps/api/src/operator/`) | Operator |
| Incident start | Walk through `docs/runbooks/breach-response.md` from detection to the notification decision | Incident lead |

## 3. Interview preparation by role

Roles from `docs/ims/roles.md`. Every holder is still **TBD (CEO to appoint)**: no interview
can be prepared for a person until the CEO names them. Each holder should be able to answer
the questions below from records, not memory.

| Role | Expect to be asked | Bring / know where it is |
|---|---|---|
| CEO / top management | How do you know the IMS works? Which resources did you decide? Which risks did you accept and why? How do the policies reach staff? | Management review minutes; signed risk acceptances; policy approvals; objectives |
| IMS manager | How is a document approved and changed? How are gaps and NCs tracked to closure? What changed since Stage 1? | `docs/ims/document-control.md`; `docs/ims/gap-register.yaml`; `docs/ims/nc-log.yaml`; change log |
| AI governance lead | How is a new AI task or processor approved? Show an impact assessment and its re-assessment trigger. How are AI concerns handled? | `definitions/ai-processors.yaml` history; `docs/ims/ai-impact/assessments.yaml`; AI incident handling |
| Privacy lead / DPO | Lawful bases; how a rights request is handled; breach reportability; children's data | `docs/compliance/dpia.md`; `docs/ims/ropa.md`; `docs/runbooks/rights-requests.md`; `docs/runbooks/breach-response.md` |
| Incident lead | Last incident or tabletop; how roles are reached out of hours; AI incidents | Tabletop record; `docs/runbooks/breach-response.md` |
| Engineering on call / SRE | Backup schedule, last restore drill and its time against RTO; monitoring | `docs/runbooks/backup-restore.md`; drill log; dashboards |
| Principal developer | Secure SDLC, branch protection, vulnerability SLAs, secrets handling, signed commits | `docs/ai-native-sdlc-playbook.md`; evidence-pack output; `.github/workflows/security.yml` |
| Senior solutions architect | Trust boundaries, threat models, tenant isolation, audit-log integrity | ARCHITECTURE.md; threat models (G-SEC-04) |
| Product manager | How requirements are captured and reviewed; how user-facing copy stays inside rules 1–3; complaints and satisfaction | `docs/prd/`; `.github/pull_request_template.md`; complaints procedure (G-QMS-01) |
| Release approver | What you check before approving a deploy; can you approve your own change? | `.github/workflows/require-ci.yml`; `docs/ims/roles.md` §4 |
| Operator | Step-up and dual control; what you may not see | `apps/api/src/operator/operator-auth.ts`, `apps/api/src/operator/dual-control.ts` |
| Internal auditor | Independence; programme coverage; how findings were graded and verified | `docs/ims/audits/programme.md`; audit reports |
| Model owner (per task) | Intended use, evaluation thresholds, monitoring, what happens on drift | Assessment record for the task; `eval_runs` |

Interview rules for staff: answer what you do, show the record, say "I don't know, the
record is held by <role>" rather than guess. Do not describe a control as operating if the
record does not show it (ISO_AUDITABLE.md §22: "mitigated in code" is not "operating").

## 4. Week before Stage 2

1. Run `scripts/ims/evidence-pack.sh`; resolve or log in `docs/ims/nc-log.yaml` anything that
   does not conform.
2. Re-run `stage1-readiness.md` and confirm every Stage 1 finding is closed or has an agreed
   plan (`findings-closure.md`).
3. Re-verify every "Evidence" path in the SoAs against the deployed system, not only the
   repository (ISO_AUDITABLE.md header note).
4. Confirm every interviewee's availability and their deputy.
5. Check that CLAUDE.md, ARCHITECTURE.md, SECURITY.md, the privacy notice and the IMS do
   not contradict each other (§22; NC-2026-001, NC-2026-004 are examples).

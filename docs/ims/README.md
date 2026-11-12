# LifeKeel Integrated Management System (IMS) — document index

| Field | Value |
|---|---|
| Document ID | LK-IMS-001 |
| Version | 0.1 |
| Status | DRAFT — awaiting approval |
| Owner | IMS manager (role) |
| Approver | CEO / top management (role) |
| Approved | — |
| Next review | — |

One management system for ISO 9001:2026, ISO/IEC 27001:2022 and ISO/IEC 42001:2023
(ISO_AUDITABLE.md §5). The implementation plan is [ISO_AUDITABLE.md](../../ISO_AUDITABLE.md)
(LK-IMS-000). **Nothing under `docs/ims/` is approved.** A document becomes controlled
information only when its approver is recorded in its header.

Records that contain personal data (HR, screening, training records with names, incident
details) are **not** kept in this repository (ISO_AUDITABLE.md §19, last paragraph). This
index lists where they will live once that system is chosen.

## Status legend

| Status | Meaning |
|---|---|
| `planned` | Not written yet; path is where it will live |
| `draft` | Written, in this repository, not approved |
| `exists` | A repository document or control that already serves the purpose (may still need an owner/review header or approval) |
| `external` | Kept outside the repository (personal data or third-party system); location TBD |
| `approved` | Approved by the named approver role — **none yet** |

## Document hierarchy (ISO_AUDITABLE.md §5.1)

### Level 1 — Policies (approved by top management)

| Document | Path | Status |
|---|---|---|
| IMS scope | [`docs/ims/scope.md`](scope.md) | draft |
| Quality policy | [`docs/ims/policies/quality-policy.md`](policies/quality-policy.md) | draft |
| Information security policy | [`docs/ims/policies/information-security-policy.md`](policies/information-security-policy.md) | draft |
| AI policy | [`docs/ims/policies/ai-policy.md`](policies/ai-policy.md) | draft |
| Privacy policy (public notice) | `apps/web/src/app/privacy/page.tsx` — legal review open (G-PRIV-03) | exists (not legally reviewed) |

### Level 2 — Processes and standards

| Document | Path | Status |
|---|---|---|
| Context: issues and interested parties | [`docs/ims/context.md`](context.md) | draft |
| Roles, responsibilities and authorities | [`docs/ims/roles.md`](roles.md) | draft |
| Gap register | [`docs/ims/gap-register.yaml`](gap-register.yaml) | draft |
| Risk methodology | [`docs/ims/risk/methodology.md`](risk/methodology.md) | draft |
| Risk register and treatment plan | [`docs/ims/risk/risk-register.yaml`](risk/risk-register.yaml) | draft (63 risks, all acceptances pending) |
| Statement of Applicability — ISO/IEC 27001 | [`docs/ims/soa/iso27001-soa.yaml`](soa/iso27001-soa.yaml) | draft (93 controls) |
| Statement of Applicability — ISO/IEC 42001 | [`docs/ims/soa/iso42001-soa.yaml`](soa/iso42001-soa.yaml) | draft (38 controls) |
| AI system impact assessments | [`docs/ims/ai-impact/assessments.yaml`](ai-impact/assessments.yaml) | draft (one per task_id, none signed) |
| Record of Processing Activities | [`docs/ims/ropa.md`](ropa.md) | draft |
| Document-control procedure | [`docs/ims/document-control.md`](document-control.md) | draft |
| Topic-specific policies (access control, cryptography, supplier, acceptable use, secure development, remote working, classification, backup, logging, incident, AI acceptable use) | [`docs/ims/policies/`](policies/) | draft |
| Secure SDLC / change management | [`docs/ai-native-sdlc-playbook.md`](../ai-native-sdlc-playbook.md), [`docs/sdlc/`](../sdlc/) | exists |
| DPIA | [`docs/compliance/dpia.md`](../compliance/dpia.md) | exists (draft, unsigned — G-PRIV-01) |
| Supplier / processor register (AI) | [`definitions/ai-processors.yaml`](../../definitions/ai-processors.yaml) | exists (AI processors only — G-SUP-03) |
| Internal audit programme | `docs/ims/audits/` | planned (Phase 3) |
| Management review | `docs/ims/management-reviews/` | planned (Phase 3) |
| Objectives | `docs/ims/objectives.md` | planned (Phase 2/3) |

### Level 3 — Work instructions and runbooks

| Document | Path | Status |
|---|---|---|
| Runbooks | [`docs/runbooks/`](../runbooks/), `runbooks.yaml` | exists (owner/review header added; not approved) |
| SDLC how-tos | [`docs/sdlc/`](../sdlc/) | exists |
| Agent instructions | `CLAUDE.md`, `.devin/AGENTS.md`, `.claude/skills/*`, `.claude/settings.json` | exists |

### Level 4 — Records (evidence)

Git history, PR reviews, CI runs, `eval_runs`, `audit_log`, deletion receipts, drill logs,
risk register, NC log. Training and HR records: external.

## Mandatory documented information (ISO_AUDITABLE.md §19)

Every row of the §19 checklist, with where it lives here. Paths differ from the suggestions in
§19 where noted: this index is authoritative for paths.

| Documented information | 9001 | 27001 | 42001 | Path | Status |
|---|:-:|:-:|:-:|---|---|
| Scope of the management system | 4.3 | 4.3 | 4.3 | `docs/ims/scope.md` | draft |
| Quality policy | 5.2 | | | `docs/ims/policies/quality-policy.md` (§19 suggests `policies/quality.md`) | draft |
| Information security policy | | 5.2 | | `docs/ims/policies/information-security-policy.md` (§19 suggests `policies/information-security.md`) | draft |
| AI policy | | | 5.2 | `docs/ims/policies/ai-policy.md` (§19 suggests `policies/ai.md`) | draft |
| Risk assessment process | | 6.1.2 | 6.1.2 | `docs/ims/risk/methodology.md` (§19 suggests `risk-methodology.md`) | draft |
| Risk treatment process | | 6.1.3 | 6.1.3 | `docs/ims/risk/methodology.md` | draft |
| Statement of Applicability | | 6.1.3 d) | 6.1.3 | `docs/ims/soa/iso27001-soa.yaml`, `docs/ims/soa/iso42001-soa.yaml` (§19 suggests `.md`) | draft |
| Risk treatment plan | | 6.1.3 e) | 6.1.3 | `docs/ims/risk/risk-register.yaml` (`treatment` field) | draft |
| AI system impact assessment process | | | 6.1.4 | ISO_AUDITABLE.md §14; records in `docs/ims/ai-impact/` | draft (process in §14) |
| Objectives | 6.2 | 6.2 | 6.2 | `docs/ims/objectives.md` (from §20) | planned |
| Planning of changes | 6.3 | 6.3 | 6.3 | IMS change log (ISO_AUDITABLE.md §23.8; `docs/ims/document-control.md`) | draft (log in §23.8) |
| Evidence of competence | 7.2 | 7.2 | 7.2 | HR records system | external (TBD) |
| Monitoring/measuring resources fitness | 7.1.5 | | | `detector-evals/`, `red-team/guard-fixtures.yaml` | exists (partial) |
| Documented information required by the IMS | 7.5 | 7.5 | 7.5 | this index + `docs/ims/document-control.md` | draft |
| Operational planning and control | 8.1 | 8.1 | 8.1 | `docs/ai-native-sdlc-playbook.md` | exists |
| Customer requirements review | 8.2.3 | | | `docs/prd/` | exists (partial) |
| D&D records (inputs, controls, outputs, changes) | 8.3 | | | `docs/prd/`, PRs, CI runs | exists |
| External provider evaluation | 8.4 | | | supplier register (`definitions/ai-processors.yaml` + planned non-AI register, G-SUP-03) | exists (partial) |
| Traceability | 8.5.2 | | | Git SHA ↔ image digest (`.github/workflows/deploy-api.yml`, `ai-bom.yaml`) | exists |
| Release authorisation | 8.6 | | | GitHub environment approvals (`.github/workflows/deploy-*.yml`, `require-ci.yml`) | exists |
| Nonconforming outputs | 8.7 | | | NC log (template ISO_AUDITABLE.md §23.5) | planned (G-DOC-02) |
| Risk assessment results | | 8.2 | 8.2 | `docs/ims/risk/risk-register.yaml` | draft |
| Risk treatment results | | 8.3 | 8.3 | `docs/ims/risk/risk-register.yaml` | draft |
| AI impact assessment results | | | 8.4 | `docs/ims/ai-impact/assessments.yaml` | draft (unsigned) |
| Monitoring and measurement results | 9.1 | 9.1 | 9.1 | KPI pack (from §20) | planned |
| Internal audit programme and results | 9.2 | 9.2 | 9.2 | `docs/ims/audits/` | planned |
| Management review results | 9.3 | 9.3 | 9.3 | `docs/ims/management-reviews/` | planned |
| Nonconformities and corrective actions | 10.2 | 10.2 | 10.2 | NC log | planned (G-DOC-02) |
| Annex A documented procedures (incident, ops, etc.) | | A.5.37 | | `docs/runbooks/` | exists |

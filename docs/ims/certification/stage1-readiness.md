# Stage 1 readiness checklist

| Field | Value |
|---|---|
| Document ID | LK-IMS-101 |
| Version | 0.1 |
| Status | DRAFT — awaiting approval |
| Owner | IMS manager (role) |
| Approver | CEO / top management (role) |
| Approved | — |
| Next review | — |

ISO_AUDITABLE.md §16 Phase 4 step 22 and §19. Stage 1 is the certification body's review of
documented information and readiness: scope, policies, SoAs, risk and AI impact assessments,
internal audit and management review records, plus every item §19 marks mandatory.

## Verdict: NOT READY

Status taken from the files on this branch on 2026-11-12. **Stage 1 must not be booked.**
No IMS document is approved (every header reads `Approved | —`), no internal audit has been
performed and no management review has been held. A CB would raise these as major findings
or decline to proceed to Stage 2.

Blocking gaps (every S1 gap in `docs/ims/gap-register.yaml`, none closed):

| G-ID | Why it blocks Stage 1 | Register status |
|---|---|---|
| G-MGT-01 | Scope unapproved; the CB cannot fix the audit scope | in_progress |
| G-MGT-02 | Quality, information security and AI policies unapproved | in_progress |
| G-MGT-03 | No role holder named; no one to interview | in_progress |
| G-MGT-04 | Risk register unscored by owners; no acceptance signed | in_progress |
| G-MGT-05 | SoAs unapproved and unversioned | in_progress |
| G-MGT-06 | AI impact assessments drafted, none signed | in_progress |
| G-MGT-07 | No internal audit or management review performed | in_progress |
| G-PRIV-01 | DPIA unsigned; lawful bases undecided | in_progress |
| G-AI-05 | Stale federated artifact not quarantined | in_progress |

Stage 1 is ready when every row below reads `READY`. `apps/api/src/__tests__/ims-certification.test.ts`
fails CI if a row cites a path that does not exist, uses a status other than `READY` or
`NOT READY`, or reads `READY` while a cited document still records no approval or while
blocking gaps are listed.

## Checklist

Columns: Q = ISO 9001, S = ISO/IEC 27001, A = ISO/IEC 42001 clause. Paths are authoritative
(`docs/ims/README.md`). "Blocking gaps" names the G-IDs that must close first; `—` means none.

| ID | Documented information | Clauses (Q / S / A) | Path | Status | Blocking gaps |
|---|---|---|---|---|---|
| S1-01 | Scope of the management system | 4.3 / 4.3 / 4.3 | `docs/ims/scope.md` | NOT READY | G-MGT-01 |
| S1-02 | Quality policy | 5.2 / — / — | `docs/ims/policies/quality-policy.md` | NOT READY | G-MGT-02 |
| S1-03 | Information security policy | — / 5.2 / — | `docs/ims/policies/information-security-policy.md` | NOT READY | G-MGT-02 |
| S1-04 | AI policy | — / — / 5.2 | `docs/ims/policies/ai-policy.md` | NOT READY | G-MGT-02 |
| S1-05 | Risk assessment process | — / 6.1.2 / 6.1.2 | `docs/ims/risk/methodology.md` | NOT READY | G-MGT-04 |
| S1-06 | Risk treatment process | — / 6.1.3 / 6.1.3 | `docs/ims/risk/methodology.md` | NOT READY | G-MGT-04 |
| S1-07 | Statements of Applicability | — / 6.1.3 d) / 6.1.3 | `docs/ims/soa/iso27001-soa.yaml`, `docs/ims/soa/iso42001-soa.yaml` | NOT READY | G-MGT-05 |
| S1-08 | Risk treatment plan | — / 6.1.3 e) / 6.1.3 | `docs/ims/risk/risk-register.yaml` | NOT READY | G-MGT-04 |
| S1-09 | AI system impact assessment process | — / — / 6.1.4 | `ISO_AUDITABLE.md` (§14) | NOT READY | G-MGT-06 |
| S1-10 | Objectives | 6.2 / 6.2 / 6.2 | `docs/ims/objectives.md` | NOT READY | G-OPS-03 |
| S1-11 | Planning of changes (IMS change log) | 6.3 / 6.3 / 6.3 | `docs/ims/document-control.md` | NOT READY | G-DOC-01 |
| S1-12 | Evidence of competence | 7.2 / 7.2 / 7.2 | external — HR records system (not chosen) | NOT READY | G-PEO-01 |
| S1-13 | Monitoring and measuring resources | 7.1.5 / — / — | `detector-evals/`, `red-team/guard-fixtures.yaml` | NOT READY | G-AI-01 |
| S1-14 | Documented information required by the IMS | 7.5 / 7.5 / 7.5 | `docs/ims/README.md`, `docs/ims/document-control.md` | NOT READY | G-DOC-01 |
| S1-15 | Operational planning and control | 8.1 / 8.1 / 8.1 | `docs/ai-native-sdlc-playbook.md`, `docs/ims/policies/secure-development-policy.md` | NOT READY | G-SEC-01 |
| S1-16 | Customer requirements review | 8.2.3 / — / — | `docs/prd/` | NOT READY | G-QMS-01 |
| S1-17 | Design and development records | 8.3 / — / — | `docs/prd/`, `.github/pull_request_template.md`, `.github/workflows/ci.yml` | NOT READY | G-SEC-01 |
| S1-18 | External provider evaluation | 8.4 / A.5.19–A.5.22 / A.10.3 | `definitions/ai-processors.yaml`, `docs/ims/policies/supplier-policy.md` | NOT READY | G-SUP-01, G-SUP-03 |
| S1-19 | Traceability (SHA ↔ image digest, pinned AI artifacts) | 8.5.2 / — / — | `.github/workflows/deploy-api.yml`, `ai-bom.yaml` | READY | — |
| S1-20 | Release authorisation | 8.6 / A.8.32 / — | `.github/workflows/deploy-api.yml`, `.github/workflows/require-ci.yml` | NOT READY | G-SEC-01 |
| S1-21 | Nonconforming outputs | 8.7 / — / — | `docs/ims/nc-log.yaml` | NOT READY | G-DOC-02 |
| S1-22 | Risk assessment results | — / 8.2 / 8.2 | `docs/ims/risk/risk-register.yaml` | NOT READY | G-MGT-04 |
| S1-23 | Risk treatment results | — / 8.3 / 8.3 | `docs/ims/risk/risk-register.yaml` | NOT READY | G-MGT-04 |
| S1-24 | AI system impact assessment results | — / — / 8.4 | `docs/ims/ai-impact/assessments.yaml` | NOT READY | G-MGT-06 |
| S1-25 | Monitoring and measurement results | 9.1 / 9.1 / 9.1 | `docs/ims/objectives.md` | NOT READY | G-OPS-03 |
| S1-26 | Internal audit programme and results | 9.2 / 9.2 / 9.2 | `docs/ims/audits/programme.md` | NOT READY | G-MGT-07 |
| S1-27 | Management review results | 9.3 / 9.3 / 9.3 | `docs/ims/management-reviews/template.md` | NOT READY | G-MGT-07 |
| S1-28 | Nonconformities and corrective actions | 10.2 / 10.2 / 10.2 | `docs/ims/nc-log.yaml` | NOT READY | G-DOC-02 |
| S1-29 | Annex A documented operating procedures | — / A.5.37 / — | `docs/runbooks/` | NOT READY | G-OPS-02 |
| S1-30 | Context: issues and interested parties | 4.1–4.2 / 4.1–4.2 / 4.1–4.2 | `docs/ims/context.md` | NOT READY | G-MGT-01 |
| S1-31 | Roles, responsibilities and authorities | 5.3 / 5.3 / 5.3 | `docs/ims/roles.md` | NOT READY | G-MGT-03 |
| S1-32 | Topic-specific policies | — / A.5.1 / A.2.2 | `docs/ims/policies/` | NOT READY | G-MGT-02 |
| S1-33 | DPIA | — / A.5.34 / A.5.2 | `docs/compliance/dpia.md` | NOT READY | G-PRIV-01 |
| S1-34 | Record of processing activities | — / A.5.34 / — | `docs/ims/ropa.md` | NOT READY | G-PRIV-01 |
| S1-35 | Gap register with owners and risk acceptance | 6.1 / 6.1.3 / 6.1.3 | `docs/ims/gap-register.yaml` | NOT READY | G-MGT-04 |
| S1-36 | Legal, statutory, regulatory and contractual requirements | 4.2 / A.5.31 / 4.1 | `docs/ims/context.md`, `docs/compliance/fca-perimeter.md`, `docs/compliance/pci-scope.md` | NOT READY | G-LEG-01, G-LEG-02, G-PRIV-03 |
| S1-37 | AI system inventory and intended use | — / — / A.4.2, A.6.2.2 | `definitions/ai-tasks.yaml`, `docs/ims/ai-impact/assessments.yaml` | NOT READY | G-MGT-06 |

S1-19 is the only `READY` row: the deploy workflow ties the released image digest to the Git
SHA and `ai-bom.yaml` pins every model artifact; these are records, not documents needing
approval. Stage 2 still samples them (`stage2-preparation.md`).

## Notes for the approver

- **S1-12** — competence records stay outside the repository (`docs/ims/README.md`); this
  row stays `NOT READY` until the HR system is chosen and the first training cycle is recorded.
- **S1-26 / S1-27** — paths are the programme and the template. The rows become `READY` only
  when an audit report (`docs/ims/audits/IA-<n>-<YYYY-MM>.md`) and signed minutes
  (`docs/ims/management-reviews/<YYYY-MM>.md`) exist; update the path then.
- **S1-36** — there is no standalone legal register (ISO_AUDITABLE.md §22 suggests
  `docs/ims/legal-register.md`) and no G-ID in §15 tracks one. CEO decision: add a G-ID, or
  record that `docs/ims/context.md` with the compliance documents is the register.
- **S1-10 / S1-25** — no monthly KPI record exists yet; ISO_AUDITABLE.md §16 expects about
  12 weeks of operating records before Stage 2.
- The open nonconformities in `docs/ims/nc-log.yaml` (NC-2026-001 to NC-2026-007) are known
  findings a CB would also find. Close or show progress on them before Stage 1.
- Stage 2 dependencies that are not Stage 1 documents but will be asked about at Stage 1:
  external penetration test (G-SEC-05), supplier DPAs (G-SUP-01), xAI exit (G-SUP-02),
  tabletop record (G-OPS-02).

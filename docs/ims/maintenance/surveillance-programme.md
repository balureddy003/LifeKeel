# Surveillance programme and IMS calendar

| Field | Value |
|---|---|
| Document ID | LK-IMS-110 |
| Version | 0.1 |
| Status | DRAFT — awaiting approval |
| Owner | IMS manager (role) |
| Approver | CEO / top management (role) |
| Approved | — |
| Next review | — |

ISO_AUDITABLE.md §16 Phase 5 step 26, §21, §22. Applies from the certification decision,
which has not happened. Months below are relative: **M0** is the month of the certification
decision. No calendar date is set until the CB confirms the cycle.

## 1. Three-year certification cycle

| Visit | When (CB practice under ISO/IEC 17021-1) | What the CB samples | LifeKeel must have ready |
|---|---|---|---|
| Surveillance 1 | Within 12 months of M0 | Internal audit and management review since certification; closure of Stage 2 findings; complaints; objectives and KPI trend; changes to scope, processors and AI tasks; a rotating subset of Annex A controls (27001 and 42001); use of the certificate and marks | One full internal-audit programme (`docs/ims/audits/programme.md`), one management review, `docs/ims/nc-log.yaml` with Stage 2 minors closed and verified, a fresh `scripts/ims/evidence-pack.sh` run |
| Surveillance 2 | Within 24 months of M0 | As surveillance 1, with the controls not sampled in year 1; effectiveness of corrective actions from surveillance 1 | As above, for year 2 |
| Recertification | Before the certificate expires (end of year 3) | The whole IMS over the cycle: every clause, continued suitability of scope, SoAs and policies, three-year performance trend | Three years of records; re-approved policies and SoAs; a management review that evaluates the full cycle |

The CB may add a special audit after a major change or a complaint. LifeKeel tells the CB
about significant changes between visits (§3).

## 2. Annual IMS calendar

Each activity produces a record. Cadences are this draft's proposal and are minimums. SV is
the surveillance (or recertification) visit.

| Activity | Cadence | Timing | Owner role | Record | Objective / gap |
|---|---|---|---|---|---|
| KPI review | Monthly | Every month | IMS manager | Monthly KPI record (`docs/ims/objectives.md`) | O1–O15 |
| Evidence pack | Monthly | Before the KPI review; again within 7 days of SV | Principal developer | `scripts/ims/evidence-pack.sh` output (kept outside the repository) | O7, O10; G-SEC-01 |
| Management review | Annually at least | 1–3 months before SV | CEO | `docs/ims/management-reviews/<YYYY-MM>.md`, signed | G-MGT-07 |
| Internal audit (IA-1 to IA-5) | Every clause and applicable control each year | Complete by SV − 2 months | Internal auditor | `docs/ims/audits/IA-<n>-<YYYY-MM>.md` | G-MGT-07 |
| Risk review | Quarterly, and on every §3 trigger | Each quarter | IMS manager with risk owners | `docs/ims/risk/risk-register.yaml` history | G-MGT-04 |
| SoA review (27001 and 42001) | Annually, and when a control's applicability or status changes | Before management review | IMS manager; AI governance lead for 42001 | `docs/ims/soa/` history | G-MGT-05 |
| AI impact assessment review | Annually per task, and on every §3 trigger | Before management review | AI governance lead, model owners | `docs/ims/ai-impact/assessments.yaml` | O12; G-MGT-06 |
| AI processor review | Each processor's review date, at least annually | Rolling | AI governance lead | `definitions/ai-processors.yaml` history | O11; G-SUP-01 |
| Non-AI supplier review | Annually per supplier | Rolling | IMS manager | Supplier register | G-SUP-03 |
| Access review | Quarterly | Each quarter | IMS manager | `collaborators.json` plus sign-off; cloud IAM export | O10 |
| Training (security, privacy, AI literacy) | Annually per person and at onboarding | Complete by SV − 1 month | IMS manager | HR records (external) | O9; G-PEO-01 |
| Restore drill | Quarterly | Each quarter | Engineering on call / SRE | Drill log (`scripts/ops/restore-drill.ts`) | O8; G-OPS-01 |
| Incident tabletop (security, privacy, AI) | Annually at least | Before management review | Incident lead | Tabletop record | G-OPS-02 |
| Penetration test | Annually, and after a major architecture change | Report before SV | CEO (commissions) | External report; findings in `docs/ims/nc-log.yaml` | G-SEC-05 |
| Document review | Quarterly check of review dates (`docs/ims/document-control.md` §6) | Each quarter | IMS manager | Exceptions reported to management review | G-DOC-01 |
| Legal and regulatory review | Twice a year, and before entering a market | Each half-year | Privacy lead / DPO | `docs/ims/context.md`; ISO_AUDITABLE.md §18 launch gate | ISO_AUDITABLE.md §3.3 |

## 3. Change triggers: out-of-cycle re-assessment

A trigger forces the named re-assessment **before** the change reaches production, not at
the next scheduled review. ISO_AUDITABLE.md §17.3 Q9 is the PR-level form of the first row:
any change to an AI task's model, processor, prompt, budget or audience re-runs the §14
assessment, and the PR links the updated record.

| Trigger | Re-assess | Record | Tell the CB? |
|---|---|---|---|
| AI task changes model, processor, prompt, budget or audience (§17.3 Q9) | AI impact assessment for that task; related risks | `docs/ims/ai-impact/assessments.yaml`, `docs/ims/risk/risk-register.yaml` | If it changes LifeKeel's AI role or adds an AI system |
| New task in `definitions/ai-tasks.yaml` | New assessment before the task is enabled | Same | If it changes the 42001 scope |
| Processor added or removed, or its retention, training or ZDR terms change | Supplier risk; assessments of tasks using it; RoPA recipients | `definitions/ai-processors.yaml`, `docs/ims/ropa.md` | If it changes the outsourced processes declared to the CB |
| New data class, data source or connector; special-category intake change (§17.3 Q1–Q2) | Risk register; DPIA; RoPA | `docs/compliance/dpia.md`, `docs/ims/ropa.md` | Only if scope changes |
| New external side effect or trust-tier change (§17.3 Q4; CLAUDE.md rule 1) | Risk register; assessment for the acting task | As above; `apps/api/src/__tests__/trust-tier-gate.test.ts` allow-list | Yes |
| Copy or feature that could read as advice (§17.3 Q5; CLAUDE.md rule 2) | Legal and regulatory risk; perimeter assessment | `docs/compliance/fca-perimeter.md` | No |
| Children affected (§17.3 Q6) | Children's posture; DPIA | `docs/privacy/childrens-data-posture.md` | No |
| New market (§18) | Legal requirements; DPIA; transfers; children's flow | §18 launch-gate record in management review | If sites or scope change |
| S1 or S2 incident, or an AI concern confirmed as harm | Risk register; affected assessments and controls | Incident record; `docs/ims/nc-log.yaml` | If it materially affects the certified scope |
| Major architecture change (new region, datastore or hosting provider) | Risk register; SoA; continuity (A.5.29, A.5.30) | `docs/ims/risk/risk-register.yaml`, `docs/ims/soa/` | Yes |
| Regulatory change (e.g. EU AI Act application dates, a new privacy law in a served market) | Legal requirements; affected assessments | `docs/ims/context.md` | No |
| Role holder leaves, or roles are combined | Roles matrix; compensating controls | `docs/ims/roles.md` §4 | If top management or the IMS manager changes |
| Federated or other cross-tenant learning activated | Full rule-3 review (CLAUDE.md), privacy review, AI impact assessment | Assessment; management-review decision | Yes |
| CB finding | `docs/ims/certification/findings-closure.md` | `docs/ims/nc-log.yaml` | Already known |

## 4. Decisions the CEO must record

1. Confirm the cadences in §2 or set different minimums.
2. Which §3 changes the IMS manager reports to the CB, once the CB contract states its
   notification rules.

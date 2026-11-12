# Certification body selection and integrated audit request

| Field | Value |
|---|---|
| Document ID | LK-IMS-100 |
| Version | 0.1 |
| Status | DRAFT — awaiting approval |
| Owner | IMS manager (role) |
| Approver | CEO / top management (role) |
| Approved | — |
| Next review | — |

ISO_AUDITABLE.md §16 Phase 0 step 3 and Phase 4; §22. This document sets the criteria for
choosing a certification body (CB) and what to put in the request. It does **not** name or
recommend a CB. The choice, the contract and the audit dates are CEO decisions recorded in
management review; none has been made.

## 1. Selection criteria (all mandatory)

| # | Criterion | How to verify | Why |
|---|---|---|---|
| C1 | Accredited for **ISO 9001**, **ISO/IEC 27001** and **ISO/IEC 42001** under the same legal entity | Accreditation certificate and schedule from the accreditation body's public register (not the CB's marketing) | One CB, one integrated audit (§5: one IMS) |
| C2 | 42001 accreditation is **against ISO/IEC 42006** | Accreditation schedule names ISO/IEC 42006 as the CB requirement | §3.1: 42001 certificates without 42006-based accreditation carry less weight with partners |
| C3 | Accreditation body is a signatory of the **IAF MLA** for the relevant scope | IAF member register | §22 flow: recognition across markets for a global launch (§18) |
| C4 | Accreditation scope covers the technical area: software development, SaaS / information technology services | Technical-area / IAF code on the accreditation schedule | Auditor competence must match the scope in `docs/ims/scope.md` |
| C5 | Can audit to **ISO 9001:2026** and **ISO/IEC 27001:2022 + Amd 1:2024** now | Written confirmation in the quote | §3.1: certify directly to 9001:2026 to avoid a transition audit |
| C6 | Offers an **integrated audit** (combined Stage 1, Stage 2, surveillance and recertification) | Quote states integrated duration and method (IAF MD 11) | Fewer audit days; one finding log |
| C7 | Auditor competence in AI systems and in cloud-native SaaS for the 42001 and Annex A technological parts | CVs / competence statement for the proposed audit team | 42006 requires AI-specific competence |
| C8 | Independence: no consultancy to LifeKeel by the CB or its related bodies in the last 2 years | CB declaration | Impartiality (ISO/IEC 17021-1) |
| C9 | Remote audit capability for a remote team and cloud-only infrastructure | Written remote-audit method (IAF MD 4) | §4 below |
| C10 | Will sign a confidentiality agreement covering evidence that includes household-data handling | Draft NDA | Evidence samples may show how personal data is processed (no raw personal data is shared — §5) |
| C11 | Certificate and public register entry name the scope exactly as approved in `docs/ims/scope.md` | Sample certificate | Partners check scope wording |
| C12 | Optional: can add **ISO/IEC 27701:2025** later as a fourth standard on the same cycle | Quote option | §16 Phase 5 step 27; `docs/ims/maintenance/iso27701-extension.md` once written |

Preferred, not mandatory: a transparent fee schedule for surveillance and recertification; the
same lead auditor across the cycle; findings delivered in a structured format that maps to
`docs/ims/nc-log.yaml`.

Compare at least two CBs that meet C1–C11. Record the comparison and the decision (with
reasons) in the next management review (`docs/ims/management-reviews/template.md`, input 8).

## 2. Integrated audit request — what to send

The CB calculates audit days from the application (IAF MD 5 for duration, IAF MD 11 for the
integrated reduction). Send only facts that are true on the day of sending:

| Item | Source in the repository | Status today |
|---|---|---|
| Legal entity, address, sites | `docs/ims/scope.md` §1 — bracketed TBD | **Not available** — CEO to supply |
| Scope statement | `docs/ims/scope.md` | Draft (G-MGT-01) |
| Standards and editions | `docs/ims/scope.md` §2 | Draft |
| Effective headcount (staff + contractors working on the scope) | `docs/ims/roles.md` — no holder named | **Not available** (G-MGT-03) |
| Level of integration (one manual, one risk process, one audit programme, one management review) | `docs/ims/README.md`, `docs/ims/risk/methodology.md`, `docs/ims/audits/programme.md` | Draft |
| Outsourced processes and suppliers | `docs/ims/scope.md` §4, `definitions/ai-processors.yaml` | Partial (G-SUP-03) |
| AI systems in scope and LifeKeel's AI roles | `definitions/ai-tasks.yaml`, `docs/ims/scope.md` §1 | Exists |
| Exclusions | `docs/ims/scope.md` §5 | Draft |
| Target Stage 1 window | — | Not set; depends on Phase 3 exit (`stage1-readiness.md`) |

Ask for: integrated Stage 1 and Stage 2; whether Stage 1 can be remote; the gap expected between
Stage 1 and Stage 2; the CB's deadline for correcting major and minor nonconformities
(`findings-closure.md` assumes 90 days for minors); and the surveillance-day estimate for
years 1 and 2.

## 3. Audit-day considerations

- **Who must be available:** the holders (not deputies) of every role in `docs/ims/roles.md`
  that the audit plan samples, the CEO for the opening meeting, leadership interview and
  closing meeting, and the internal auditor. Interview preparation: `stage2-preparation.md` §3.
- **Systems access:** read-only screen-share of GitHub (PRs, Actions, environments), the cloud
  console and the operator console. Auditors do not receive credentials.
- **Evidence pack:** run `scripts/ims/evidence-pack.sh` within 7 days of each stage
  (`docs/ims/audits/evidence-pack.md`). The output names people: share it on screen or through
  the CB's controlled channel, not by committing it.
- **Personal data:** auditors see process evidence, never household content. Demonstrations
  use staging with synthetic data (`docs/runbooks/staging-environment.md`).
- **Findings channel:** one person (IMS manager) records every finding the CB raises, the same
  day, as a draft entry for `docs/ims/nc-log.yaml` (`findings-closure.md`).

## 4. Multi-site and remote notes

- LifeKeel has no recorded office or data centre in the repository. Physical data-centre
  controls are inherited from cloud suppliers (`docs/ims/scope.md` §5). Tell the CB this; it
  affects whether any site visit is needed.
- If the team works remotely from more than one location, each location is a **temporary or
  virtual site** in CB terms. Declare the locations (CEO to supply) and the remote-working
  policy (`docs/ims/policies/remote-working-policy.md`) so the CB can decide on sampling under
  IAF MD 1 / MD 4.
- If the CB requires an on-site element, it will usually be the registered office. Agree this in
  the contract, not on the day.
- Remote audit pre-requisites: tested video platform, stable screen-share of the systems above,
  and a recorded agreement that the CB will not record screens showing personal data.

## 5. Decisions the CEO must record

1. Shortlist and selected CB, with the C1–C11 evidence.
2. Whether 27701 is quoted as an option now (C12).
3. Locations and headcount to declare (§2).
4. Target Stage 1 window — only after `stage1-readiness.md` shows no blocking item.

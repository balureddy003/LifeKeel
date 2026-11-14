# ISO/IEC 27701:2025 privacy extension plan

| Field | Value |
|---|---|
| Document ID | LK-IMS-111 |
| Version | 0.1 |
| Status | DRAFT — awaiting approval |
| Owner | Privacy lead / DPO (role) |
| Approver | CEO / top management (role) |
| Approved | — |
| Next review | — |

ISO_AUDITABLE.md §3.2, §16 Phase 5 step 27, §18. Plan only: nothing here is implemented as a
privacy information management system (PIMS) yet, and the decision to pursue certification is
the CEO's. Control intent below is paraphrased; the standard's text is not reproduced.
**Confirm every control-area reference against the purchased 2025 edition** before using this
mapping as the 27701 Statement of Applicability.

## 1. How it builds on the existing IMS

ISO/IEC 27701:2025 is a standalone, certifiable management-system standard
(ISO_AUDITABLE.md §3.2). It shares the Harmonized Structure (Clauses 4–10) with the three
standards already in the IMS, so it is added as a fourth set of requirements to the same
system, not a parallel one:

| IMS element | Today | Add for 27701 |
|---|---|---|
| Scope (`docs/ims/scope.md`) | Household personal and financial information in scope | State LifeKeel's PII roles (§2) and the PII processing in scope |
| Context (`docs/ims/context.md`) | Interested parties include households and regulators | PII principals (adults, children, non-users named by a household), supervisory authorities per market |
| Risk (`docs/ims/risk/methodology.md`) | Security, quality and AI lenses | A privacy lens: risk **to the PII principal**, not only to LifeKeel |
| SoA (`docs/ims/soa/`) | 27001 and 42001 | A third SoA for the 27701 Annex A controls, same YAML shape and test |
| Objectives (`docs/ims/objectives.md`) | O4 disclosure, O13 rights requests | Keep; add any privacy objectives the privacy lead proposes |
| Internal audit and management review | Programme IA-1 to IA-5 | Add a privacy audit (controller and, where applicable, processor controls) and privacy inputs to management review |
| Certification | One CB for three standards | Same CB if accredited for 27701 (`docs/ims/certification/certification-body.md` C12) |

## 2. LifeKeel's PII roles

| Role | When | Evidence |
|---|---|---|
| **PII controller** | Processing household data for the LifeKeel service: accounts, family roster, financial profile, documents, connected mailboxes, Ask Keel | `docs/ims/ropa.md` §1, `docs/compliance/dpia.md` |
| **PII processor** | Not applicable today. Becomes applicable if a partner (B2B2C) contract makes LifeKeel process PII on the partner's instructions | No such contract in the repository; re-assess on any partner contract (`docs/ims/maintenance/surveillance-programme.md` §3) |
| Uses processors | Hosted AI processors, cloud, messaging, payments | `definitions/ai-processors.yaml`, `docs/ims/scope.md` §4 |

## 3. Control mapping — PII controller

Status: **evidenced** (repository evidence exists; needs owner, approval and operating
record), **partial**, **gap**. Area names paraphrase the controller control categories.

| Control area | Intent (paraphrased) | Repository evidence | Status | Gap |
|---|---|---|---|---|
| Conditions for collection and processing — purpose | Identify and document each processing purpose | `docs/ims/ropa.md`, `docs/compliance/dpia.md` | partial (draft, unsigned) | G-PRIV-01 |
| — lawful basis | Determine and record the lawful basis per purpose | `docs/compliance/dpia.md` | gap (bases undecided) | G-PRIV-01 |
| — consent | Decide when consent is needed; obtain and record it | `apps/web/src/lib/consent.ts` (cookies), `docs/privacy/childrens-data-posture.md` (consent model) | partial | G-PRIV-02 |
| — privacy impact assessment | Assess processing likely to be high risk | `docs/compliance/dpia.md`, `docs/privacy/dpia-sensitive-brief-facts.md`, `docs/ims/ai-impact/assessments.yaml` | partial (unsigned) | G-PRIV-01, G-MGT-06 |
| — contracts with processors | Bind processors to PII-protection terms | `definitions/ai-processors.yaml` | gap (DPAs not on file; non-AI register missing) | G-SUP-01, G-SUP-03 |
| — joint controllers | Allocate responsibilities with any joint controller | none | gap (not assessed) | — (proposed new G-ID, §6) |
| — records of processing | Keep records of processing | `docs/ims/ropa.md` | partial (draft) | G-PRIV-01 |
| Obligations to PII principals — information | Tell principals what is processed and why | `apps/web/src/app/privacy/page.tsx` | partial (not legally reviewed) | G-PRIV-03 |
| — withdraw consent / object | Let principals withdraw or object | `docs/runbooks/rights-requests.md` | partial (owner unnamed) | G-MGT-03 |
| — access, correction, erasure | Give access, correct and erase on request | `docs/runbooks/rights-requests.md`, `apps/api/src/routes/account.ts`, `apps/api/src/erasure.ts`, `apps/api/src/deletion/receipt.ts` | evidenced (code); procedure draft | G-MGT-03 |
| — tell third parties about corrections/erasure | Pass corrections and erasure on to recipients | `docs/runbooks/rights-requests.md` | gap (processor propagation not evidenced) | G-SUP-01 |
| — copy of PII (portability) | Provide a copy in a usable format | `apps/api/src/routes/account.ts` (export) | evidenced (code) | — |
| — automated decision-making | Address decisions made solely by automated means | `docs/ims/ai-impact/assessments.yaml`; detector output is informational (CLAUDE.md rule 2) | partial | G-MGT-06 |
| Privacy by design and default — limit collection and processing | Collect and process only what the purpose needs | `apps/api/src/privacy/special-category.ts`, `definitions/ai-tasks.yaml` (task-minimised context) | partial | G-PRIV-04 |
| — accuracy and quality | Keep PII accurate for its purpose | `docs/runbooks/rights-requests.md` (correction) | partial | — |
| — retention, de-identification and deletion at end of processing | Keep no longer than needed; dispose securely | `docs/data-retention.md`, `apps/api/src/jobs/retention-worker.ts`, `apps/api/src/jobs/erasure-replay.ts` | partial | G-OPS-04 |
| — transmission controls | Protect PII in transit | `docs/ims/policies/cryptography-policy.md` | partial (draft) | G-MGT-02 |
| Sharing, transfer and disclosure — cross-border transfer basis | Identify and document the basis for each transfer | `docs/ims/ropa.md` §3 (mechanism recorded per AI processor) | partial (non-AI recipients not recorded; DPAs not verified on file) | G-SUP-01, G-SUP-03 |
| — countries and recipients | Specify where PII may go and to whom | `docs/ims/ropa.md` §3, `definitions/ai-processors.yaml` | partial | G-SUP-03 |
| — records of disclosure | Record disclosures to third parties | `apps/api/src/audit/audit-log.ts`, `apps/api/src/routes/audit-log.ts` | partial | G-SEC-03 |
| Children | Extra protections for children's PII (market-specific, §18) | `docs/privacy/childrens-data-posture.md` | partial (counsel-led decisions open) | G-PRIV-02 |

## 4. Control mapping — PII processor

Not applicable while LifeKeel has no processor role (§2). If a partner contract creates one,
map before signing: processing only on documented customer instructions; assisting the
customer with its obligations (rights requests, breach notification, impact assessments);
returning or deleting PII at contract end; sub-processor disclosure and approval; transfer
basis per customer. The controller evidence above (erasure, export, breach runbook, processor
registry) is the starting point.

## 5. Security controls for PII (27001-based)

The 27701 security requirements extend the 27001 controls already in
`docs/ims/soa/iso27001-soa.yaml`. Privacy-specific additions to check there:

| Area | Repository evidence | Status | Gap |
|---|---|---|---|
| Breach handling including notification to authorities and principals | `docs/runbooks/breach-response.md` (ISO_AUDITABLE.md §18.3 clocks) | partial (roles unnamed, no tabletop) | G-OPS-02 |
| Logging of access to PII, including by operators | `apps/api/src/audit/audit-log.ts`, `apps/api/src/operator/operator-audit.ts` | partial (not tamper-evident on this branch; operator access not visible to households) | G-SEC-03, G-OFI-04 |
| Privacy awareness and training | HR records (external) | gap | G-PEO-01 |
| Secure disposal and erasure surviving restore | `apps/api/src/erasure.ts`, `scripts/ops/restore-drill.ts` | partial | G-OPS-01 |

## 6. Plan and decisions

1. **CEO decision:** pursue 27701 certification after the first three-standard certificate,
   or sooner if a launch market or partner requires it (ISO_AUDITABLE.md §16 places it after
   Stage 2).
2. Privacy lead turns §3–§5 into a new `docs/ims/soa/iso27701-soa.yaml` with the same structure and
   test as the other SoAs, after checking every control reference against the 2025 edition.
3. Add the privacy lens to `docs/ims/risk/methodology.md` and re-score affected risks.
4. Proposed new gap IDs for ISO_AUDITABLE.md §15 (not added here; §15 is the source of truth
   and the gap-register test mirrors it): joint-controller assessment; cross-border transfer
   records for non-AI recipients; propagation of corrections and erasure to recipients.
5. Close the S1/S2 privacy gaps first (G-PRIV-01 to G-PRIV-04, G-SUP-01): 27701 cannot be
   certified while they are open.

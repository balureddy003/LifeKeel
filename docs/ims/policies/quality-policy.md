# Quality policy

| Field | Value |
|---|---|
| Document ID | LK-IMS-020 |
| Version | 0.1 |
| Status | DRAFT — awaiting approval |
| Owner | IMS manager (role) |
| Approver | CEO / top management (role) |
| Approved | — |
| Next review | — |

ISO 9001 5.2. Text from ISO_AUDITABLE.md §23.1. Part of closing **G-MGT-02**.

## Policy

> LifeKeel exists to give every household a clear, sourced and trustworthy view of its
> resilience. We commit to: meeting the requirements of the families we serve and of
> applicable law; describing what is on file accurately and never presenting estimates as
> facts; measuring friction and value rather than assuming them; acting on a family's behalf
> only with their explicit approval; and continually improving our quality management system
> against measurable objectives reviewed by management.

## How the commitments are already put into practice

| Commitment | Existing practice | Evidence |
|---|---|---|
| Meet customer and legal requirements | PRD → plan → test → review → CI → human deploy | `CLAUDE.md` "PRD → production"; `docs/ai-native-sdlc-playbook.md`; `docs/prd/` |
| Describe what is on file; estimates are not facts | Detector copy describes what is on file and estimates a gap; deterministic authority for figures | `detectors/family/*.yaml`; `packages/engine/src/__tests__/advice-rule.test.ts`; `definitions/ai-tasks.yaml` (`authority: language_only`) |
| Measure rather than assume | Golden detector-eval datasets | `detector-evals/` |
| Act only with explicit approval | Trust tiers; `approvedBy` required | `apps/api/src/__tests__/trust-tier-gate.test.ts` |
| Continual improvement against objectives | Objectives proposed in ISO_AUDITABLE.md §20 | Objectives not yet approved (G-OPS-03); customer satisfaction not yet measured (G-QMS-01) |

## Communication and availability

Once approved: published in this repository, linked from `docs/README.md`, communicated to all
staff and contractors with an acknowledgement record (kept outside the repository), and made
available to interested parties on request.

## Approval

Signed: TBD (CEO to appoint) · Date: —

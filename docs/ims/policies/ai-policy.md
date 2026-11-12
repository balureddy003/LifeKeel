# AI policy

| Field | Value |
|---|---|
| Document ID | LK-IMS-022 |
| Version | 0.1 |
| Status | DRAFT — awaiting approval |
| Owner | AI governance lead (role) |
| Approver | CEO / top management (role) |
| Approved | — |
| Next review | — |

ISO/IEC 42001 5.2 and Annex A.2.2–A.2.4. Text from ISO_AUDITABLE.md §23.3; commitments 1–3
restate CLAUDE.md's three rules. Part of closing **G-MGT-02**.

## Policy

> LifeKeel uses AI to help families understand their records, never to replace their
> decisions. We commit that:
> 1. **No irreversible financial, legal, medical or similarly consequential action happens
>    without explicit human approval**, however confident a model is.
> 2. **LifeKeel stays informational.** Our AI describes what is on file and estimates gaps; it
>    never recommends products, providers, switching, investments or payment initiation.
> 3. **Family content is not training data** for shared or third-party foundation models.
>    Hosted AI is processing under approved terms, with task-minimised context; local and
>    on-device processing is preferred for sensitive tasks.
> 4. Every AI system has an owner, an intended-use statement, an impact assessment, evaluations
>    and monitoring before and after release.
> 5. People are told when they interact with AI, and can report concerns.
> 6. We keep these commitments in executable controls wherever possible and review this policy
>    at every management review.

## Executable controls behind each commitment

| # | Control | Evidence | Open gap |
|---|---|---|---|
| 1 | `ActionExecutor` caller allow-list; every `execute()` names `approvedBy` | `apps/api/src/__tests__/trust-tier-gate.test.ts` | — (tripwire, not proof) |
| 2 | Advice-rule test over detector/playbook copy; PostToolUse hook; informational system prompt | `packages/engine/src/__tests__/advice-rule.test.ts`, `scripts/hooks/advice-check.sh`, `apps/api/src/routes/assistant.ts` | G-LEG-01 (written perimeter opinion) |
| 3 | AI task gateway is the only door to a model; task registry; processor registry with `enforce` outside dev | `apps/api/src/ai/task-gateway.ts`, `definitions/ai-tasks.yaml`, `definitions/ai-processors.yaml`, `apps/api/src/__tests__/ai-task-gateway.test.ts` | G-SUP-01, G-SUP-02, G-AI-05 |
| 3 | Federated warm-start gated by `allowFederatedWarmStart` | `apps/api/src/__tests__/architecture-claims.test.ts` | G-AI-05 (stored artifact) |
| 4 | Impact assessment per task; model cards; pinned AI BOM | `docs/ims/ai-impact/assessments.yaml`, `docs/models/`, `ai-bom.yaml` | G-MGT-06, G-AI-01 (task eval suites) |
| 5 | Processor disclosure to families | `apps/api/src/ai/disclosure.ts`, `apps/web/src/app/ai-processing/page.tsx` | G-AI-02 (Art. 50 disclosure), G-AI-03 (concern channel) |

Rule 3 is **not** technically enforced by code alone: provider no-training and retention terms,
Gmail Limited Use exclusion from cross-tenant scorers and a consent flow for third-party AI
remain procedural (CLAUDE.md; ARCHITECTURE.md §8.15).

## Alignment with other policies (A.2.3)

| Policy | Link |
|---|---|
| Information security | Commitment 3 ↔ supplier and classification policies |
| Privacy (DPIA, RoPA) | Commitment 3 ↔ `docs/compliance/dpia.md`, `docs/ims/ropa.md` |
| Quality | Commitment 2 ↔ "never presenting estimates as facts" |
| AI acceptable use | [ai-acceptable-use-policy.md](ai-acceptable-use-policy.md) |

## Review (A.2.4)

Reviewed at every management review and whenever a processor, model, data class, audience or
autonomy level changes.

## Approval

Signed: TBD (CEO to appoint) · Date: —

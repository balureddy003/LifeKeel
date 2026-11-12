# AI acceptable use policy

| Field | Value |
|---|---|
| Document ID | LK-IMS-033 |
| Version | 0.1 |
| Status | DRAFT — awaiting approval |
| Owner | AI governance lead (role) |
| Approver | CEO / top management (role) |
| Approved | — |
| Next review | — |

ISO/IEC 42001 A.9.2–A.9.4, A.7.2. Implements the AI policy (`ai-policy.md`) for anyone building
or operating an AI feature in LifeKeel.

## Permitted

1. Model calls only through the AI task gateway, under a task registered in
   `definitions/ai-tasks.yaml`, to a processor allowed for that task in
   `definitions/ai-processors.yaml`.
2. Task-minimised context; the smallest data boundary that works
   (`device_only` → `lifekeel_infra_required` → `lifekeel_infra` → `approved_hosted_provider`).
3. AI output that describes what is on file, estimates a gap, and points to "a licensed
   professional" or to comparing quotes from multiple insurers.

## Prohibited

1. Constructing a raw model client outside the allow-listed factories, or calling an
   unregistered task (fails CI: `apps/api/src/__tests__/ai-task-gateway.test.ts`).
2. Output that recommends a product, names or steers to a provider, proposes a switch, an
   investment or a payment (CLAUDE.md rule 2) — including in Tier 0/1 drafts.
3. Autonomous execution of a financial, legal, medical or irreversible action without an
   explicit human approval gate (CLAUDE.md rule 1).
4. Using family content to train or fine-tune a shared or third-party model; provider-side
   memory, file or vector stores; batch or fine-tuning APIs; consumer/free endpoints; personal
   API keys (CLAUDE.md rule 3).
5. Semantic response caching of sensitive family content (`SECURITY.md`).
6. Enabling cross-tenant learning (federated code, warm-start) without explicit opt-in, privacy
   review and the controls in CLAUDE.md rule 3.
7. Re-proposing CPU-local serving for general interactive traffic
   (`docs/reviews/decision-local-interactive-closed-2026-10.md`).

## Before a new or changed AI task ships

Impact assessment entry in `docs/ims/ai-impact/assessments.yaml` (CI checks one exists per
task), evals and thresholds (G-AI-01), red-team fixtures where inputs are untrusted, and owner
sign-off recorded.

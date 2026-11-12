# Secure development policy

| Field | Value |
|---|---|
| Document ID | LK-IMS-027 |
| Version | 0.1 |
| Status | DRAFT — awaiting approval |
| Owner | Principal developer (role) |
| Approver | CEO / top management (role) |
| Approved | — |
| Next review | — |

ISO/IEC 27001 A.8.25–A.8.33, A.8.4, A.8.8; ISO 9001 8.3; ISO/IEC 42001 A.6.1.3, A.6.2.

## Statements

1. **Lifecycle:** intent/PRD (including trust tier when agentic) → plan sign-off for anything
   non-trivial → implement with tests → self-review → CI gate → human review and merge →
   manual, human-approved deploy (CLAUDE.md "PRD → production").
2. **Every change is reviewed by a human** other than an AI agent; production deploys need
   environment approval and a green CI run for the exact SHA.
3. **Tests travel with code:** new backend logic has a test that fails without it; detector
   changes run against `detector-evals/`.
4. **Product rules are tripwires in CI:** trust tiers, advice rule, AI gateway, architecture
   claims. Removing or weakening one is a reviewed decision.
5. **Supply chain:** actions pinned by SHA, images pinned by digest, AI artifacts pinned in
   `ai-bom.yaml`, dependency audit and code scanning.
6. **Vulnerabilities** are fixed within severity SLAs (ISO_AUDITABLE.md §17.4: S1 before next
   deploy, S2 30 days, S3 90 days); a formal SLA policy is being added (G-SEC-08).
7. **Separation of environments:** no production family data in development, tests or evals;
   boot guards refuse demo credentials outside dev.
8. **Threat modelling** for each domain, refreshed on material change (G-SEC-04).
9. **Signed commits** and conventional commit messages; never bypass hooks.

## Enforced today

| Statement | Evidence |
|---|---|
| 1–2 | `.github/pull_request_template.md`, `.github/workflows/require-ci.yml`, `.github/workflows/deploy-api.yml`, `docs/ai-native-sdlc-playbook.md`, `docs/sdlc/reviewing.md` |
| 3–4 | `.github/workflows/ci.yml`, `apps/api/src/__tests__/trust-tier-gate.test.ts`, `packages/engine/src/__tests__/advice-rule.test.ts`, `apps/api/src/__tests__/ai-task-gateway.test.ts`, `apps/api/src/__tests__/architecture-claims.test.ts`, `apps/api/src/__tests__/deploy-workflows.test.ts` |
| 5 | `.github/workflows/security.yml`, `.github/workflows/images.yml`, `.github/dependabot.yml`, `ai-bom.yaml` |

## Not yet in place

Branch protection / environment reviewer evidence (G-SEC-01); threat models (G-SEC-04);
vulnerability SLA policy (G-SEC-08); independent pentest (G-SEC-05); staging environment is
designed but not yet created (`docs/runbooks/staging-environment.md`).

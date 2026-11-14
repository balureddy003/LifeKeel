# Acceptable use policy (staff, contractors and AI coding agents)

| Field | Value |
|---|---|
| Document ID | LK-IMS-026 |
| Version | 0.1 |
| Status | DRAFT — awaiting approval |
| Owner | IMS manager (role) |
| Approver | CEO / top management (role) |
| Approved | — |
| Next review | — |

ISO/IEC 27001 A.5.10, A.8.30; ISO/IEC 42001 A.4.4. Source: ISO_AUDITABLE.md §17.5.

## People

1. Use LifeKeel systems and data only for your role. Never browse a household's data without a
   support or operational reason recorded through the operator console.
2. No production family data on personal devices, in personal cloud storage, in chat tools,
   or in tickets. Use synthetic fixtures for development and tests.
3. Never paste secrets, keys or family data into an AI tool, search engine or public service.
4. Report suspected incidents immediately (incident management policy).
5. Follow the remote-working, classification and access-control policies.

## AI coding agents

1. **Instructions are controls.** `CLAUDE.md`, `.devin/AGENTS.md`, `.claude/settings.json`
   hooks and `.claude/skills/*` are versioned policy artefacts; changes go through PR review.
2. **No production credentials** in agent sessions; agents have no deploy permission.
3. **A named human approves every merge and deploy.** The agent is never the approver.
4. **No family data in prompts** to coding agents (A.8.33).
5. Agents must not bypass hooks or checks (`--no-verify`, disabling signing, skipping tests)
   unless the accountable human explicitly asks.
6. The coding-agent vendor is a supplier (supplier policy, statement 6).

## Enforced today

PostToolUse advice-rule hook (`.claude/settings.json`, `scripts/hooks/advice-check.sh`);
tripwire tests run in CI (`apps/api/src/__tests__/trust-tier-gate.test.ts`,
`apps/api/src/__tests__/ai-task-gateway.test.ts`,
`packages/engine/src/__tests__/advice-rule.test.ts`); human-approved deploys
(`.github/workflows/deploy-api.yml`, `.github/workflows/require-ci.yml`).

## Not yet in place

Staff acknowledgement records; disciplinary process (A.6.4); coding-agent vendor in a supplier
register (G-SUP-03).

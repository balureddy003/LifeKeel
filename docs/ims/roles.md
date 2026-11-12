# IMS roles, responsibilities and authorities

| Field | Value |
|---|---|
| Document ID | LK-IMS-003 |
| Version | 0.1 |
| Status | DRAFT — awaiting approval |
| Owner | IMS manager (role) |
| Approver | CEO / top management (role) |
| Approved | — |
| Next review | — |

Closes, once approved and every name is filled: **G-MGT-03** (ISO 9001/27001/42001 Clause
5.3, ISO/IEC 27001 A.5.2, ISO/IEC 42001 A.3.2). Source: ISO_AUDITABLE.md §2 (RACI and
small-team note) and §16 Phase 0 step 1.

No person is named in this draft. Every "Holder" and "Deputy" cell stays **TBD (CEO to
appoint)** until the CEO records the appointment; an appointment is recorded by the CEO
approving this document with the names filled in (see `docs/ims/document-control.md` §3). Do not fill a name from memory or from commit history.

## 1. Roles matrix

| Role | Holder | Deputy | Responsibilities | Authority | Source of the duty |
|---|---|---|---|---|---|
| **CEO / top management** | TBD (CEO to appoint) | TBD (CEO to appoint) | Accountable for the IMS; approves scope, policies, SoAs, risk appetite and High-risk acceptance; chairs management review; provides resources | Final approval of Level-1 documents; accepts High residual risks; appoints every role below | ISO_AUDITABLE.md §2 RACI, §13.2 appetite, §23.1–23.3 |
| **IMS manager** | TBD (CEO to appoint) | TBD (CEO to appoint) | Runs the IMS day to day; keeps the gap register, risk register, SoAs, document index and change log current; prepares management-review inputs; owns document control and the NC/corrective-action log | Accepts Medium residual risks with a treatment plan; approves Level-2/3 document changes delegated by the CEO | §2 RACI, §13.2, §19 |
| **AI governance lead** | TBD (CEO to appoint) | TBD (CEO to appoint) | Owns the AI policy, AI risk assessment, AI system impact assessments, the AI SoA (42001), the processor registry review cadence and AI incident handling; names a model owner per task | Approves/refuses a processor entry in `definitions/ai-processors.yaml`; signs AI impact assessments | §2 RACI, §14, CLAUDE.md rule 3 |
| **Privacy lead / DPO** (or external DPO / privacy counsel) | TBD (CEO to appoint) | TBD (CEO to appoint) | Owns the DPIA, RoPA, lawful bases, rights requests, breach-reporting decisions and children's-data posture | Decides whether a breach is reportable; signs DPIA and impact assessments touching personal data | `docs/compliance/dpia.md` §5, `docs/runbooks/rights-requests.md`, `docs/runbooks/breach-response.md` |
| **Incident lead** | TBD (CEO to appoint) | TBD (CEO to appoint) | Runs security, privacy and AI incidents end to end per `docs/runbooks/breach-response.md`; opens the incident record; coordinates containment | Turns on maintenance mode, revokes sessions, starts key rotation during an incident | `docs/runbooks/breach-response.md` roles table |
| **Communications (incident)** | TBD (CEO to appoint) | TBD (CEO to appoint) | Drafts notices to affected people, processors and partners | Sends notices approved by the incident lead and privacy lead | `docs/runbooks/breach-response.md` roles table |
| **Engineering on call / SRE** | TBD (CEO to appoint) | TBD (CEO to appoint) | Backups, restore drills, availability, capacity, SLO dashboards | Runs `scripts/ops/backup.sh` / `restore.sh` / `restore-drill.ts` | `docs/runbooks/backup-restore.md` ("Owner: platform/on-call") |
| **Principal developer** | TBD (CEO to appoint) | TBD (CEO to appoint) | Secure SDLC evidence, CI gates, change management, code-level controls, fixing technical gaps | Code owner (`CODEOWNERS`); merges after review | §2, `CODEOWNERS` |
| **Senior solutions architect** | TBD (CEO to appoint) | TBD (CEO to appoint) | Architecture, trust boundaries, threat models, resilience, data flows, supplier architecture | Approves architecture decisions | §2 |
| **Product manager** | TBD (CEO to appoint) | TBD (CEO to appoint) | Intended use, customer requirements, interested parties, product objectives; keeps product copy inside CLAUDE.md rules 1–3 | Approves PRDs and user-facing copy | §2, CLAUDE.md "PRD → production" |
| **Release approver** | TBD (CEO to appoint) | TBD (CEO to appoint) | Approves each production deploy (`workflow_dispatch`, `environment: production`) after confirming `require-ci.yml` passed for the SHA | Approves or rejects the GitHub environment deployment | CLAUDE.md "PRD → production" steps 6–7; `.github/workflows/deploy-api.yml`, `.github/workflows/require-ci.yml` |
| **Action approver** (product) | The household member, never staff or an agent | — | Approves any Tier ≥ 1 action Keel prepares on the family's behalf | Recorded as `approvedBy` on `ActionExecutor.execute()` | CLAUDE.md rule 1; `apps/api/src/__tests__/trust-tier-gate.test.ts` |
| **Operator (platform console)** | TBD (CEO to appoint) | TBD (CEO to appoint) | Support and operations through the operator console | Step-up authentication; dual control for sensitive actions | `apps/api/src/operator/operator-auth.ts`, `apps/api/src/operator/dual-control.ts` |
| **Internal auditor** | TBD (CEO to appoint) — external contractor if the team cannot supply an independent person | — | Plans and runs the internal audit programme (§21); verifies corrective actions | Unrestricted read access to IMS records for the audit; reports to the CEO | §2 RACI, §21 |
| **Model owner (per AI task)** | TBD (AI governance lead to propose, CEO to appoint) | — | Owns one `task_id` in `definitions/ai-tasks.yaml`: its impact assessment, evals and monitoring | Proposes changes to the task policy | §14.2 "Accountability", §23.4 |

## 2. RACI

Copied from ISO_AUDITABLE.md §2. R = responsible, A = accountable, C = consulted, I = informed.

| Activity | CEO | IMS manager | AI governance lead | Privacy lead / DPO | Principal dev | Architect | Product manager | Internal auditor |
|---|---|---|---|---|---|---|---|---|
| Scope and policies | A | R | C | C | C | C | C | I |
| Risk assessment and treatment | A | R | R (AI) | R (privacy) | C | R (technical) | C | I |
| Statement of Applicability | A | R | R (42001) | C | C | C | I | I |
| AI system impact assessment | A | C | R | R | C | C | R | I |
| Supplier and processor review | A | R | R (AI processors) | R | C | C | I | I |
| Secure SDLC and change control | I | C | C | I | A/R | R | C | I |
| Incident and breach response | A | R | C | R | R | C | I | I |
| Internal audit | I | C | C | C | C | C | C | A/R |
| Management review | A/R | R | C | C | C | C | C | C |
| Corrective action | A | R | R | R | R | R | R | C (verifies) |

## 3. Deputies

Every role except the internal auditor and the household action approver has a deputy who
can act when the holder is unavailable. A deputy may not approve their own work in the
holder's place (for example, a deputy release approver may not approve a deploy of a change
they authored).

## 4. Combined roles, conflicts of interest and compensating controls

ISO_AUDITABLE.md §2 small-team note: when one person holds several roles, record it here and
add compensating controls. The repository currently lists a single code owner (`CODEOWNERS`:
`* @balureddy003`), so combinations are likely. Fill this table when roles are appointed.

| Combination | Conflict | Compensating control (required) |
|---|---|---|
| Principal developer + release approver | Author approves their own deploy | GitHub environment reviewers must exclude the author, or a second reviewer is required; until then record CEO risk acceptance (R-ORG-01) |
| IMS manager + internal auditor | Auditing own system | **Not permitted.** Use an external internal auditor (§2: "must be independent of the area audited") |
| AI governance lead + principal developer | Approves processor/tasks they implemented | Processor-registry and task-policy changes need a second reviewer; CI tripwire `apps/api/src/__tests__/ai-task-gateway.test.ts` stays mandatory |
| Privacy lead + incident lead | Decides reportability of an incident they ran | External privacy counsel consulted on every reportability decision; decision recorded with reasons |
| CEO + any risk owner | Accepts own High risks | Record the acceptance with rationale in management-review minutes; internal auditor samples it |
| Any human + AI coding agent | Agent output reviewed only by the person who prompted it | A named human approves every merge and deploy; the agent is never the approver (§17.5); CI tripwires (trust-tier, advice-rule, AI gateway) run on every PR |

## 5. AI coding agents

AI coding agents hold **no** role in this matrix and are never an approver. They are tools
operating under `CLAUDE.md`, `.devin/AGENTS.md`, `.claude/settings.json` and `.claude/skills/*`
(ISO_AUDITABLE.md §17.5). The person who merges an agent-authored change is accountable for it.

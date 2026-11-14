# IMS scope

| Field | Value |
|---|---|
| Document ID | LK-IMS-010 |
| Version | 0.1 |
| Status | DRAFT — awaiting approval |
| Owner | IMS manager (role) |
| Approver | CEO / top management (role) |
| Approved | — |
| Next review | — |

Satisfies, once approved: ISO 9001 / ISO/IEC 27001 / ISO/IEC 42001 Clause 4.3. Closes
**G-MGT-01** on approval. Source: ISO_AUDITABLE.md §6.

## 1. Scope statement (for top-management approval)

> The integrated quality, information security and AI management system of LifeKeel covering
> the design, development, operation, support and continual improvement of the LifeKeel
> household-intelligence service — web application, mobile shell, API, background jobs, AI
> task gateway and the AI systems it governs — delivered as software-as-a-service to
> households, including the processing of household personal and financial information,
> from **[registered office / remote team locations — TBD by CEO]**, in accordance with the
> Statement of Applicability version **[TBD]** dated **[TBD]**.
>
> LifeKeel's role under ISO/IEC 42001: **AI provider and AI developer** of the AI features
> embedded in the service, and **AI user** of third-party foundation models.

The bracketed values are deliberately left open: the registered office and team locations are
not recorded anywhere in the repository, and the SoA version/date exists only once the SoAs in
`docs/ims/soa/` are approved.

## 2. Standards and roles

| Standard | Edition | LifeKeel role |
|---|---|---|
| ISO 9001 | 2026 (per ISO_AUDITABLE.md §3.1) | Provider of a software service |
| ISO/IEC 27001 | 2022 (+ Amd 1:2024) | Organisation processing household information |
| ISO/IEC 42001 | 2023 | AI provider, AI developer, AI user (ISO_AUDITABLE.md §11) |

## 3. Boundaries (what LifeKeel controls)

| In scope | Repository evidence |
|---|---|
| Web application (Next.js, static export to Firebase Hosting) | `apps/web/` |
| Mobile shell (Capacitor) | `apps/mobile/` |
| API and jobs role (Fastify) | `apps/api/` |
| AI task gateway, task registry and processor registry | `apps/api/src/ai/task-gateway.ts`, `packages/platform/src/task-gateway.ts`, `definitions/ai-tasks.yaml`, `definitions/ai-processors.yaml` |
| Shared libraries (engine, platform, pipeline, runtime, specifications, workflows, mongodb-adapter) | `packages/*` |
| Runtime resources (detectors, connectors, definitions, verticals, detector evals, category table) | `detectors/`, `connectors/`, `definitions/`, `verticals/`, `detector-evals/`, `category-table.yaml` |
| Self-hosted model services | `infra/local-judge/`, `infra/encoder-service/`, `ai-bom.yaml` |
| Source control, CI/CD and release process | `.github/workflows/`, `CODEOWNERS`, `.github/pull_request_template.md` |
| Operations: on-call, backup/restore, incident response, operator console | `docs/runbooks/`, `scripts/ops/`, `apps/api/src/operator/` |
| People: staff, contractors and AI coding agents working on LifeKeel | `CLAUDE.md`, `.devin/AGENTS.md`, `.claude/` |

## 4. Interfaces (controlled by contract and monitoring, not by LifeKeel)

Each interface is a supplier under ISO/IEC 27001 A.5.19–A.5.23 and, for AI processors,
ISO/IEC 42001 A.10. Names come from ISO_AUDITABLE.md §6.1 and the repository; contract status
comes only from `definitions/ai-processors.yaml` (AI processors). Non-AI supplier contracts are
not recorded in the repository (G-SUP-03).

| Interface | Service | Repository reference |
|---|---|---|
| Google Cloud | Cloud Run, Secret Manager, Artifact Registry, Vertex AI | `.github/workflows/deploy-api.yml`, `docs/infra-provisioning.md`, `definitions/ai-processors.yaml` (`vertex`) |
| Firebase Hosting | Static web hosting | `.github/workflows/deploy-web.yml` |
| Cloudflare | Turnstile, R2 object storage | `CLOUDFLARE_INTEGRATION.md`, `docs/runbooks/cloudflare-integration.md` |
| MongoDB and Redis hosting provider | Primary datastore and queues | `docs/runbooks/backup-restore.md` |
| Hosted LLM processors | Azure OpenAI, Vertex AI, Groq (approved); xAI (pre-launch testing exception only); Anthropic, OpenAI (`unreviewed` — refused outside dev) | `definitions/ai-processors.yaml`, CLAUDE.md |
| Messaging | SendGrid, Twilio, Web Push | ISO_AUDITABLE.md §6.1 |
| Payments | Stripe (hosted Checkout) | `docs/compliance/pci-scope.md`, `docs/runbooks/stripe-setup.md`, `definitions/stripe-config.yaml` |
| Open Banking provider | Read-only account information, feature-flagged | `docs/compliance/fca-perimeter.md` |
| Mailbox providers | Gmail (read-only scope), IMAP | `docs/compliance/dpia.md` §1 |
| App stores | Apple App Store, Google Play | `docs/mobile-release.md`, `docs/mobile-store-listing.md` |
| AI coding-agent vendors | Tools used to write code (ISO_AUDITABLE.md §17.5) | `CLAUDE.md`, `.devin/AGENTS.md` |

xAI is approved only under the pre-launch testing exception recorded in CLAUDE.md (2026-10-31
owner decision); it must leave scope or reach enterprise ZDR before production launch
(G-SUP-02).

## 5. Exclusions and justifications

| Item | Decision | Justification |
|---|---|---|
| ISO 9001 7.1.5.2 Measurement traceability | Not applicable | No physical measuring equipment; software metrics are controlled under 7.1.5.1 |
| ISO/IEC 27001 A.7.1–A.7.14 (data-centre physical controls) | **Not excluded — inherited** | Applicable, but implemented by cloud suppliers and evidenced by their certificates under A.5.19–A.5.23. Office and home-working controls stay in scope |
| Health-records product domain | Out of product scope | Deliberately not implemented (ARCHITECTURE.md §11). Incidental special-category data arriving in uploads/email is still in scope for controls (G-PRIV-04; `apps/api/src/privacy/special-category.ts`) |
| Payment-card processing | Out of scope by design | Stripe-hosted Checkout; no card data touches LifeKeel (`docs/compliance/pci-scope.md`) |
| `kairos-ai` legacy monorepo | Out of scope | Separate system; what was removed is documented in `SECURITY.md` |
| Dormant federated-learning code | **In scope as a risk** | Present in `packages/engine`; read path gated by `allowFederatedWarmStart` (`apps/api/src/__tests__/architecture-claims.test.ts`); stored artifact quarantine is G-AI-05 |
| Regulated activity (personal recommendations on investments/insurance, arranging insurance, payment initiation) | Outside the business by policy, permanently | CLAUDE.md second rule; `packages/engine/src/__tests__/advice-rule.test.ts`; perimeter assessment open (G-LEG-01) |

No ISO/IEC 27001 Annex A or ISO/IEC 42001 Annex A control is excluded (see
`docs/ims/soa/`).

## 6. Approval

| Role | Name | Date |
|---|---|---|
| CEO / top management | TBD (CEO to appoint) | — |

# Context of the organization — issues and interested parties

| Field | Value |
|---|---|
| Document ID | LK-IMS-011 |
| Version | 0.1 |
| Status | DRAFT — awaiting approval |
| Owner | IMS manager (role) |
| Approver | CEO / top management (role) |
| Approved | — |
| Next review | — |

Satisfies, once approved: Clauses 4.1 and 4.2 (ISO 9001, ISO/IEC 27001, ISO/IEC 42001),
including the ISO Amd 1:2024 climate-change consideration. Source: ISO_AUDITABLE.md §7.
Reviewed at every management review and whenever a market, processor or regulatory perimeter
changes. Risk IDs refer to `docs/ims/risk/risk-register.yaml`.

## 1. Issues register (4.1)

| # | Issue | Type | Effect on the IMS | Linked risks | Monitored by |
|---|---|---|---|---|---|
| E1 | Global launch across jurisdictions with divergent privacy, AI and children's-data law | External / legal | Legal register per market; data-residency decisions (ISO_AUDITABLE.md §18) | R-LEG-01, R-PRIV-02 | Privacy lead |
| E2 | Rapid change in hosted-AI provider terms, models, retention and pricing | External / supplier | Processor review cadence; `review_due` in `definitions/ai-processors.yaml` blocks a lapsed processor | R-AI-02, R-SUP-02, R-SUP-03 | AI governance lead |
| E3 | Regulatory perimeter (FCA/SEC-style) for financial "advice" | External / legal | CLAUDE.md rule 2; perimeter assessment before live banking (`docs/compliance/fca-perimeter.md`) | R-AI-01, R-LEG-02 | CEO + counsel |
| E4 | Threat landscape: account takeover, prompt injection via documents/email, supply chain | External / technical | Annex A 8.x controls; red-team CI (`red-team/guard-fixtures.yaml`) | R-SEC-01 … R-SEC-05 | Principal developer |
| E5 | Consumer trust in AI with household data | External / market | Transparency (42001 A.8); rule 3 wording in `SECURITY.md` "Safe user-facing wording" | R-AI-07 | Product manager |
| E6 | Climate change (ISO Amd 1:2024 — must be considered) | External | Judged low direct relevance; record cloud-region energy profile and supplier climate posture; scale-to-zero reduces footprint | R-ORG-05 | IMS manager |
| I1 | Small team; one code owner (`CODEOWNERS`); AI coding agents write much of the code | Internal | Segregation of duties, independent review, agent governance (ISO_AUDITABLE.md §17.5; `docs/ims/roles.md` §4) | R-ORG-01, R-ORG-02 | CEO |
| I2 | Modular monolith with pooled multi-tenancy | Internal / technical | Tenant isolation is the top confidentiality risk | R-SEC-02 | Architect |
| I3 | Strong policy-as-code culture (tripwire tests, registries, hooks) | Internal / strength | Reuse executable controls as evidence (ISO_AUDITABLE.md §5.1) | — | IMS manager |
| I4 | Pre-launch, single region, scale-to-zero; one environment (production) per `docs/runbooks/staging-environment.md` | Internal | BC/DR, cold start, SLO definition, change testing | R-OPS-01, R-OPS-06 | SRE / on-call lead |
| I5 | CPU-local interactive generation closed; batch tasks moved to hosted processors 2026-10-24 when the GCP Ollama service was decommissioned (`definitions/ai-tasks.yaml` header) | Internal / technical | More family content reaches hosted processors; processor terms carry more weight | R-AI-02, R-AI-08 | AI governance lead |

## 2. Interested parties register (4.2)

| Interested party | Requirements relevant to the IMS | Which become IMS requirements | Where addressed |
|---|---|---|---|
| Household organizers (paying customers) | Accurate, sourced insights; availability; confidentiality; export/delete; no hidden selling or advice | All | ISO_AUDITABLE.md §10, §12; `docs/data-retention.md` |
| Other adult members (may not have signed up) | Notice, access rights, correct permissions | All | `docs/compliance/dpia.md` §3; G-PRIV-02 |
| Children / minors | Heightened protection, no marketing, age-out | All | `docs/privacy/childrens-data-posture.md` |
| Correspondents in connected mailboxes | Minimisation; finance-only retention | All | `docs/compliance/dpia.md` §4 (R38) |
| Regulators (ICO, EU DPAs, FCA, FTC, AI Act authorities) | Lawful processing, breach reporting, perimeter compliance, AI transparency | All | ISO_AUDITABLE.md §18; `docs/runbooks/breach-response.md` |
| AI processors and cloud suppliers | Contract terms, acceptable use | Contractual terms | `definitions/ai-processors.yaml`; supplier policy |
| Google (API policy), Apple / Google stores | Limited Use, CASA, store privacy labels | All | `docs/mobile-store-listing.md`; G-LEG-03 |
| Stripe / acquirer | PCI SAQ, webhook integrity | All | `docs/compliance/pci-scope.md`; G-LEG-02 |
| Investors / board | Risk posture, certification | Risk reporting | Management review |
| Employees, contractors, AI agents | Clear rules, tools, training | All | CLAUDE.md; ISO_AUDITABLE.md §17 |
| Licensed professionals families are referred to | No steering to a provider | All | CLAUDE.md rule 2 |
| Society | Non-discriminatory, explainable AI | All | ISO_AUDITABLE.md §14; `docs/ims/ai-impact/` |

## 3. Review

| Date | Change | Reviewed by |
|---|---|---|
| — | Initial draft from ISO_AUDITABLE.md §7 | — (pending) |

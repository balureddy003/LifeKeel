# Supplier and processor policy

| Field | Value |
|---|---|
| Document ID | LK-IMS-025 |
| Version | 0.1 |
| Status | DRAFT — awaiting approval |
| Owner | IMS manager (role); AI processors: AI governance lead (role) |
| Approver | CEO / top management (role) |
| Approved | — |
| Next review | — |

ISO/IEC 27001 A.5.19–A.5.23; ISO 9001 8.4; ISO/IEC 42001 A.10.2–A.10.3.

## Statements

1. **Register every supplier** that stores, processes or can reach LifeKeel information, using
   the ISO_AUDITABLE.md §23.6 row: service, data classes, region, certifications and expiry,
   DPA date, transfer mechanism, sub-processors, breach-notice SLA, exit plan, risk tier, review
   dates, owner.
2. **No family data to an unapproved processor.** AI processors are approved only in
   `definitions/ai-processors.yaml` with terms reference, no-training basis, retention class,
   transfer mechanism, DPA date, breach SLA and review dates. Outside dev the gateway refuses
   an unapproved processor.
3. **Review cadence:** annually and on any terms change. A processor past `review_due` is
   blocked.
4. **Conditional approvals are time-boxed.** xAI is approved only under the pre-launch testing
   exception recorded in CLAUDE.md (2026-10-31); before production launch serving must move to a
   processor approved without a ZDR condition, or enterprise ZDR must be in place (G-SUP-02).
5. **Cloud services** (A.5.23) have a shared-responsibility note and an exit/portability plan.
6. **AI coding-agent vendors** are suppliers and are registered with their data-use terms
   (ISO_AUDITABLE.md §17.5).
7. **No consumer/free AI endpoints or personal API keys** for family content (CLAUDE.md rule 3).

## What the repository records today

| Supplier group | Recorded in repo | Status |
|---|---|---|
| Azure OpenAI, Vertex AI, Groq | `definitions/ai-processors.yaml` — approved, DPA dates and review dates recorded | Contract copies not in repo (G-SUP-01) |
| xAI | `definitions/ai-processors.yaml` — approved under testing exception, `limited_abuse_log` | G-SUP-02 |
| Anthropic, OpenAI | `definitions/ai-processors.yaml` — `unreviewed`, refused outside dev | — |
| GCP, Firebase, Cloudflare, MongoDB/Redis host, SendGrid, Twilio, Stripe, Open Banking, app stores | Not recorded | G-SUP-03, G-SUP-04 |

Enforcement evidence: `packages/platform/src/ai-processors.ts`,
`apps/api/src/ai/task-gateway.ts`, `apps/api/src/__tests__/ai-task-gateway.test.ts`.

# Information classification and handling policy

| Field | Value |
|---|---|
| Document ID | LK-IMS-029 |
| Version | 0.1 |
| Status | DRAFT — awaiting approval |
| Owner | Architect (role) |
| Approver | CEO / top management (role) |
| Approved | — |
| Next review | — |

ISO/IEC 27001 A.5.9, A.5.12, A.5.13, A.5.14. Scheme from ISO_AUDITABLE.md §8.2.

## Scheme

| Class | Examples | Handling |
|---|---|---|
| **C4 Restricted** | Vault documents, connector credentials, MFA secrets, encryption keys, children's data | Envelope encryption; optional browser sealing for vault; secret manager for keys; crypto-shredding on deletion; never in logs, tests, tickets or prompts to coding agents; self-hosted-only AI processing where the task registry requires it |
| **C3 Confidential** | Financial profile, roster, uploaded documents, inbox items, insights, assistant context | Tenant scope; per-tenant DEK for sensitive fields; private R2 buckets with short-lived presigned URLs; AI processing only through the gateway with task-minimised context |
| **C2 Internal** | Audit log, metrics, redacted eval runs, operator notes, billing identifiers | Operator RBAC; audit retention 7 years; integrity is the priority for audit records |
| **C1 Public** | Marketing site, blog, published model cards | Change review before publishing |

## Rules

1. The owner of an information asset assigns its class; when unsure, use the higher class.
2. Exports and documents carry their class where practical (A.5.13); IMS documents carry the
   header block defined in `docs/ims/document-control.md`.
3. Transfer of C3/C4 outside LifeKeel happens only to an approved supplier under the supplier
   policy, over TLS, with a recorded transfer mechanism for international transfers.
4. Special-category data is not a product domain; incidental health terms are stripped before
   assistant model calls (`apps/api/src/privacy/special-category.ts`); the Art. 9 decision is
   open (G-PRIV-04).

## Enforced today

`packages/platform/src/tenant-scoped-collection.ts`, `apps/api/src/crypto/envelope.ts`,
`apps/api/src/documents/r2.ts`, `definitions/ai-tasks.yaml` (`data_boundary` per task).

## Not yet in place

Server-side disclosure classification parallel to trust tiers (G-SEC-06); a single asset
register with owners (A.5.9).

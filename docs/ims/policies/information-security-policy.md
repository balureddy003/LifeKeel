# Information security policy

| Field | Value |
|---|---|
| Document ID | LK-IMS-021 |
| Version | 0.1 |
| Status | DRAFT — awaiting approval |
| Owner | IMS manager (role) |
| Approver | CEO / top management (role) |
| Approved | — |
| Next review | — |

ISO/IEC 27001 5.2 and Annex A 5.1. Text from ISO_AUDITABLE.md §23.2. Part of closing
**G-MGT-02**.

## Policy

> LifeKeel protects the confidentiality, integrity and availability of household information
> as the core of its product. We commit to: assessing and treating information security risks
> against approved criteria; isolating every household's data and every member's permissions
> server-side; encrypting sensitive data and keys; giving external processors only the minimum
> data under approved terms; meeting legal, regulatory and contractual requirements in every
> market we serve; reporting and learning from incidents; and continually improving the
> information security management system. Topic-specific policies support this policy and are
> mandatory for all staff, contractors and AI agents working on LifeKeel.

## Information security objectives

Set and reviewed at management review. Proposed set: ISO_AUDITABLE.md §20 objectives O4, O7,
O8, O10, O13 (not yet approved — G-OPS-03).

## Topic-specific policies (mandatory)

| Topic | Document | Annex A |
|---|---|---|
| Access control | [access-control-policy.md](access-control-policy.md) | 5.15–5.18, 8.2–8.5 |
| Cryptography | [cryptography-policy.md](cryptography-policy.md) | 8.24 |
| Supplier relationships | [supplier-policy.md](supplier-policy.md) | 5.19–5.23 |
| Acceptable use (staff, contractors, AI coding agents) | [acceptable-use-policy.md](acceptable-use-policy.md) | 5.10, 8.30 |
| Secure development | [secure-development-policy.md](secure-development-policy.md) | 8.25–8.33 |
| Remote working and endpoints | [remote-working-policy.md](remote-working-policy.md) | 6.7, 7.7–7.9, 8.1 |
| Classification and handling | [classification-policy.md](classification-policy.md) | 5.12, 5.13 |
| Backup | [backup-policy.md](backup-policy.md) | 8.13 |
| Logging and monitoring | [logging-policy.md](logging-policy.md) | 8.15, 8.16 |
| Incident management | [incident-management-policy.md](incident-management-policy.md) | 5.24–5.28, 6.8 |
| AI (and AI acceptable use) | [ai-policy.md](ai-policy.md), [ai-acceptable-use-policy.md](ai-acceptable-use-policy.md) | 5.34; 42001 A.2, A.9 |

## Roles

Responsibilities and authorities: [`docs/ims/roles.md`](../roles.md). Risk method:
[`docs/ims/risk/methodology.md`](../risk/methodology.md). Controls selected:
[`docs/ims/soa/iso27001-soa.yaml`](../soa/iso27001-soa.yaml).

## Compliance

Non-compliance is handled through the disciplinary process (not yet documented — A.6.4,
G-PEO-01). Exceptions require a recorded risk acceptance by the role authorised in the risk
methodology §3.

## Approval

Signed: TBD (CEO to appoint) · Date: —

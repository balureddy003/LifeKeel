# Control of documented information

| Field | Value |
|---|---|
| Document ID | LK-IMS-004 |
| Version | 0.1 |
| Status | DRAFT — awaiting approval |
| Owner | IMS manager (role) |
| Approver | CEO / top management (role) |
| Approved | — |
| Next review | — |

ISO 9001 / ISO/IEC 27001 / ISO/IEC 42001 Clause 7.5; ISO/IEC 27001 A.5.13, A.5.33, A.5.37.
Closes **G-DOC-01** once approved and applied to every governed document.

## 1. What is governed

| Level (ISO_AUDITABLE.md §5.1) | Location | Approver role |
|---|---|---|
| 1 — Policies, scope | `docs/ims/scope.md`, `docs/ims/policies/{quality,information-security,ai}-policy.md` | CEO / top management |
| 2 — Processes, standards, registers | `docs/ims/**` (other files), including the risk register, SoAs, AI impact assessments, RoPA | CEO (SoAs, risk appetite, policies); IMS manager for the rest unless the document says otherwise |
| 3 — Work instructions and runbooks | `docs/runbooks/*.md` | IMS manager (delegated by the CEO) |
| 4 — Records | Git history, PRs, CI runs, `audit_log`, receipts, drill logs; HR/training/incident records **outside** the repository | Not approved; protected from change |

`CLAUDE.md`, `.devin/AGENTS.md`, `.claude/**` and `docs/sdlc/**` are Level-3 work instructions
already controlled by PR review; they do not carry the header block (their review evidence is
the PR).

## 2. Header block (mandatory for Levels 1–3)

Markdown documents start with this table directly under the title; YAML documents carry the
same fields under a top-level `document:` key (`id`, `version`, `status`, `owner`, `approver`,
`approved`, `next_review`).

```
| Field | Value |
|---|---|
| Document ID | LK-IMS-NNN (IMS) or LK-RB-NNN (runbooks) |
| Version | MAJOR.MINOR — 0.x while draft, 1.0 on first approval |
| Status | DRAFT — awaiting approval · APPROVED · SUPERSEDED · WITHDRAWN |
| Owner | <role> (role) |
| Approver | <role> (role) |
| Approved | — or <name>, <role>, <YYYY-MM-DD>, <PR link> |
| Next review | — or <YYYY-MM-DD> |
```

`apps/api/src/__tests__/ims-documents.test.ts` fails CI if a governed file under `docs/ims/` or
`docs/runbooks/` lacks any of these fields, or if two documents share an ID.

## 3. Creating and changing a document

1. Change it in a branch and open a PR; the PR description says what changed and why.
2. Bump the version (minor for edits, major for a change in intent or scope).
3. While unapproved, `Status` is `DRAFT — awaiting approval` and `Approved` is `—`.
4. **Approval** is recorded only by the approver themself: the approver reviews and approves
   the PR, and the `Approved` field names them, their role, the date and the PR. Nobody — and
   no AI agent — fills the `Approved` field on someone else's behalf.
5. On approval set `Status: APPROVED` and `Next review` (at most 12 months; Level-1 documents at
   every management review).
6. Record significant changes in the IMS change log (ISO_AUDITABLE.md §23.8).

## 4. Availability, distribution and protection

- The default branch of the repository is the single current version. Superseded versions stay
  in git history and are not used.
- Classification per `docs/ims/policies/classification-policy.md`; IMS documents are C2
  Internal unless marked otherwise.
- External documents (standards, supplier certificates, contracts, counsel opinions) are listed
  by reference in the relevant register and stored outside the repository when they contain
  personal data or are licensed material.

## 5. Retention of records

| Record | Kept | Where |
|---|---|---|
| IMS documents and their history | Life of the IMS + 3 years | Git |
| Internal audit and management-review records | 3 years minimum (one certification cycle) | `docs/ims/audits/`, `docs/ims/management-reviews/` |
| Risk acceptances, SoA approvals | Life of the IMS + 3 years | Git (register history) |
| Audit log, deletion receipts | 7 years (TTL) | Production database (`docs/data-retention.md`) |
| Training, screening, HR | Per HR/legal retention | Outside the repository (TBD) |

The 3-year figures are this draft's proposal for approval, not an existing commitment.

## 6. Review

The IMS manager runs a quarterly check that every governed document is within its review date
and reports exceptions to management review.

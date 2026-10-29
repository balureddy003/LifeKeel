# DPIA — Sensitive household-brief facts (Intent 79)

**Date:** 2026-10-28. **Scope:** `sensitive` catalogue handover briefs
(medical_contacts, school_handover, care_handover, bereavement) storing
health/care details in `household_briefs.facts`.

## Data and lawful basis

- **Data:** health and care facts typed by a household member — GP, allergies,
  medications, care notes; special-category data under UK GDPR Art 9.
- **Basis:** Art 6(1)(a) consent; Art 9(2)(a) **explicit consent** —
  `sensitive_consent` is required at create and the field copy states what is
  recorded and who sees it.
- **Third parties named in facts** (a parent receiving care, a deceased person):
  they have not consented. Facts record only what the household chooses to
  enter; the product asks for "what the household chooses to share", keeps
  entries minimal, and honours deletion requests from the household. A named
  third party can ask for removal via the household or support.

## Controls implemented

- **Encryption at rest:** facts are envelope-encrypted with the tenant DEK
  (`facts_encrypted`, dek: ciphertext); plaintext never stored for sensitive
  entries (tested).
- **Access:** decrypt only on the two permitted reads (creator, designated
  adult) after participant checks; a content-free `sensitive_access` log
  records who opened facts and when — the creator can see it.
- **Retention:** `facts_expire_at` hard-expires facts ~24 months after
  creation (lazy purge on read); earlier deletion on request by the creator
  or designated adult, via brief delete and the erasure path
  (`household_briefs` is in `DELETABLE`).
- **Secrets guard rail:** credential-shaped input is rejected with a plain
  message; a field hint ("record where it is, never the password or code")
  does the real work. The check is a guard rail, not a control.
- **Telemetry:** growth events carry `problem_type`/ids only — no fact
  content in logs, queues, or events.

## Residual risk

Free text can always carry more than intended (names of third parties,
identifiers). Mitigations: explicit-consent gate, minimal fields, encryption,
retention expiry, access log, delete-on-request. Acceptable for a Tier-0
informational record with no external action.

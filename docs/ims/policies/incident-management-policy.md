# Incident management policy

| Field | Value |
|---|---|
| Document ID | LK-IMS-032 |
| Version | 0.1 |
| Status | DRAFT — awaiting approval |
| Owner | Incident lead (role) |
| Approver | CEO / top management (role) |
| Approved | — |
| Next review | — |

ISO/IEC 27001 A.5.24–A.5.28, A.6.8; ISO/IEC 42001 A.8.4. Procedure:
`docs/runbooks/breach-response.md`.

## Scope

Security incidents, personal-data breaches, **and AI incidents**: harmful or advice-like
output, prompt-injection effects, an action taken without approval, data sent to an unapproved
processor, or a model behaving outside its intended use.

## Statements

1. Anyone who suspects an incident reports it at once to the incident lead (roles in
   `docs/ims/roles.md`). External reporters use the route in `SECURITY.md`.
2. Severity follows ISO_AUDITABLE.md §4; rule 1–3 violations, cross-tenant disclosure and child
   data exposure are always S1.
3. First hour: open an incident record, contain (revoke sessions, rotate secrets, maintenance
   mode), preserve evidence — never delete it.
4. Within 24 hours decide reportability with the privacy lead; within 72 hours of awareness
   report to the ICO where required; tell affected people without undue delay if risk is high.
5. Every incident is recorded whether or not reportable, and closes with a post-incident review
   linked to the nonconformity/corrective-action log.
6. A tabletop exercise runs before launch and annually, covering a breach and an AI incident.

## Not yet in place

Named roles (G-OPS-02, G-MGT-03); tabletop record; AI incident playbook (G-OPS-02);
per-market breach clocks beyond the UK (ISO_AUDITABLE.md §18.3); vulnerability disclosure
policy and security.txt (G-OFI-05); AI concern-reporting channel (G-AI-03).

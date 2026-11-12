# AI concern triage

| Field | Value |
|---|---|
| Document ID | LK-RB-009 |
| Version | 0.1 |
| Status | DRAFT — awaiting approval |
| Owner | AI governance lead (role) |
| Approver | CEO / top management (role) |
| Approved | — |
| Next review | — |

Closes **G-AI-03** (ISO/IEC 42001 A.3.3, A.8.3) once approved. Family members report a
Keel reply from the "Report a concern" control under any model-written answer.

## What arrives

- `POST /keel/concerns` stores a row in `keel_concerns` (tenant-scoped, note encrypted under
  the tenant's key, kept 365 days, erased with the account).
- An ops alert titled **AI concern reported** (fingerprint `ai-concern`) carries only the
  category and the answer route. `harmful` and `privacy` page as critical; the rest are warnings.
- `audit_log` gets `keel.concern_reported` with the category and route.

Operators never see the note or the reply text by default. Reading them is access to family
data and follows the operator access procedure with the family's consent.

## Triage within 2 working days (critical: same day)

| Category | First question | Typical outcome |
|---|---|---|
| `privacy` | Did a reply show data from another member or household? | Treat as a possible breach: `breach-response.md`. Check `keel.access_denied` and route audit records for the tenant. |
| `harmful` | Did the reply miss a safety route (emergency, self-harm, minor)? | Fix the guard or routing; add a test case to the task's eval set. |
| `advice` | Did the reply recommend a product, provider or switch (rule 2)? | Fix the prompt or guard; add the phrasing to the advice-rule checks. |
| `incorrect` | Is the source record wrong, or did the model misread it? | Data fix or eval-set case; no change if the record was wrong. |
| `other` | — | Classify into one of the above or close with a reason. |

## Record

Each concern gets a line in the nonconformity / corrective-action log (ISO_AUDITABLE.md
§23.5): date, category, route, root cause, action, and the date the fix was verified.
Repeated concerns on one AI task are an input to that task's AI system impact assessment
and to management review.

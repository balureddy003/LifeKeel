# Decision record: ISO 22301 business continuity certification

| Field | Value |
|---|---|
| Document ID | LK-IMS-112 |
| Version | 0.1 |
| Status | DRAFT — awaiting approval |
| Owner | IMS manager (role) |
| Approver | CEO / top management (role) |
| Approved | — |
| Next review | — |

ISO_AUDITABLE.md §3.2, §16 Phase 5 step 28. Proposed decision for the CEO; it takes effect
only when approved and minuted in a management review.

## Proposed decision

**Do not pursue ISO 22301 certification now.** Continuity is managed inside the existing IMS
through ISO/IEC 27001 controls, with ISO 22301 used as guidance only.

## Reasons

1. No customer, partner or regulator in the repository's record requires ISO 22301.
2. The continuity controls a CB would examine are already in the 27001 scope and not yet
   operating: information security during disruption and ICT readiness (A.5.29, A.5.30),
   backup (A.8.13), redundancy (A.8.14). Open gaps: G-OPS-01 (PITR, scheduled drills),
   G-OPS-03 (approved SLOs), G-OPS-05 (single region, DR not tied to RTO), G-OPS-06 (email
   fallback). A fourth certificate would add audit days without closing them.
3. Certifying four standards before the first three operate would dilute a small team's
   effort (ISO_AUDITABLE.md §16 orders 27701 before 22301 for a consumer launch).

## What continues meanwhile

| Control | Evidence | Gap |
|---|---|---|
| Backup and restore | `docs/ims/policies/backup-policy.md`, `docs/runbooks/backup-restore.md`, `scripts/ops/backup.sh`, `scripts/ops/restore-drill.ts` | G-OPS-01 |
| Incident and disruption response | `docs/ims/policies/incident-management-policy.md`, `docs/runbooks/breach-response.md` | G-OPS-02 |
| Availability objective | `docs/ims/objectives.md` (O1, O8) | G-OPS-03 |
| Regional resilience decision | ISO_AUDITABLE.md §15.3 | G-OPS-05 |
| Annual tabletop and quarterly restore drill | `docs/ims/maintenance/surveillance-programme.md` §2 | G-OPS-02, G-OPS-01 |

## Triggers to reconsider

Re-open this decision at the next management review if any of these occurs:

- A partner, distributor or enterprise customer requires ISO 22301 (or equivalent continuity
  assurance) in a contract or due-diligence questionnaire.
- LifeKeel commits to a contractual availability or recovery-time obligation.
- A served market brings LifeKeel under an operational-resilience regime.
- A disruption breaches the RTO or the O1 availability target, or two S1/S2 availability
  incidents occur in 12 months.
- Architecture moves to multiple regions or adds a critical single-supplier dependency.
- The 27001 continuity controls above are operating and the CEO wants external assurance of
  them.

## Record

| Decision | By | Date | Management review |
|---|---|---|---|
| Not pursued now (proposed) | CEO / top management (role), TBD (CEO to appoint) | — | — |

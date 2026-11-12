# Certification audit findings: closure procedure

| Field | Value |
|---|---|
| Document ID | LK-IMS-103 |
| Version | 0.1 |
| Status | DRAFT — awaiting approval |
| Owner | IMS manager (role) |
| Approver | CEO / top management (role) |
| Approved | — |
| Next review | — |

ISO_AUDITABLE.md §16 Phase 4 steps 23 and 25; Clause 10.2. How LifeKeel handles findings
the certification body (CB) raises at Stage 1, Stage 2, surveillance and recertification.
The CB's own rules and deadlines, once contracted, override the defaults here; record any
difference in this document.

## 1. Grades

| CB grade | Meaning (CB practice under ISO/IEC 17021-1) | `nc-log.yaml` severity | Effect on certification |
|---|---|---|---|
| **Major nonconformity** | A requirement is not met at all, or the system cannot be shown to achieve its intended results (for example: no management review held; a mandatory process absent; many minors in one area) | S1, or S2 where the CB agrees impact is contained | **Certification cannot be granted** until the correction and corrective action are accepted and verified by the CB (often by a follow-up visit or document review) |
| **Minor nonconformity** | A requirement is partly met; an isolated lapse that does not undermine the system | S3 | Certification can be granted on an accepted corrective-action plan; the CB verifies closure, usually at the next visit |
| **Observation / opportunity for improvement** | Not a nonconformity | S4 (if accepted for action) | None; review at management review |
| **Stage 1 concern** (area of concern) | Issue that could become a nonconformity at Stage 2 | Graded by the IMS manager as above | Stage 2 may be postponed until resolved |

The CB's grade is recorded as given. LifeKeel does not downgrade a CB finding; it may
challenge it once, in writing, through the CB's appeal process.

## 2. Timelines (defaults pending the CB contract)

| Finding | Correction and root-cause plan to CB | Closed and verified |
|---|---|---|
| Major | Within the CB's deadline (commonly about 30 days) | Before the certification decision; the CB verifies (ISO_AUDITABLE.md §16 step 25, §22) |
| Minor | Plan within 30 days | Within **90 days** of the closing meeting (ISO_AUDITABLE.md §16 step 25); the CB verifies at the next visit |
| Stage 1 concern | Before the Stage 2 date | Evidence shown at Stage 2 |
| Observation | — | Decided at the next management review |

## 3. Procedure

1. **Record the same day.** The IMS manager adds one `docs/ims/nc-log.yaml` entry per finding,
   in a PR, with `raised_by: certification-audit` and the CB's finding reference in
   `description`. Use the next free `NC-<YYYY>-<NNN>` number. Link the G-IDs and risk IDs it
   touches in `links`.
2. **Correct.** Fix the immediate symptom (`correction`). A correction alone never closes the
   entry.
3. **Root cause.** The owner role for the finding's area writes the root cause. Also ask why
   the internal audit and management review did not catch it.
4. **Corrective action.** Plan the change that stops recurrence, with an owner (role) and a
   `due` date inside §2. Update the risk register, SoA or gap register if the finding shows
   they were wrong.
5. **Respond to the CB** with the correction, root cause and plan within its deadline.
6. **Effectiveness check.** Define, before closing, which record will show the action worked
   (for example the next `scripts/ims/evidence-pack.sh` output). The internal auditor, not the
   owner, verifies it.
7. **Close** only after the effectiveness check is recorded (`status: closed`).
   `apps/api/src/__tests__/ims-documents.test.ts` refuses a closed entry with an empty root
   cause, corrective action or effectiveness check.
8. **Report** every certification finding and its status at the next management review
   (`docs/ims/management-reviews/template.md`, input 4).

CB report pages or interview notes that name staff are kept outside the repository; the
`nc-log.yaml` entry names roles only.

## 4. Entry template

```yaml
  - id: NC-<YYYY>-<NNN>
    raised: '<YYYY-MM-DD>'
    raised_by: certification-audit
    clause: ['<clause or control the CB cited>']
    severity: S1 | S2 | S3 | S4
    description: >-
      <Stage 1 | Stage 2 | Surveillance | Recertification> finding <CB reference>, graded
      <major | minor | observation> by the CB: <what the CB found>.
    correction: —
    root_cause: —
    corrective_action: —
    owner: <Role> (role)
    due: —
    effectiveness_check: —
    status: open
    links: [<G-ID or R-ID>]
```

## 5. Escalation

- A major finding is reported to the CEO the same day.
- A minor at risk of missing its 90-day window is escalated to the CEO at least 14 days before
  the deadline; only the CB can extend it.
- A repeat finding (same clause at two consecutive audits) is treated internally as major,
  whatever the CB grade.

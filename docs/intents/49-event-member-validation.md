# Intent 49: Life-event member existence validation

**Problem** — QA pass 2: POST /family/life-events accepted affected_member_id for a member that does not exist (201). The id is schema-validated only.

**Done looks like**
- POST /family/life-events returns 404 when affected_member_id names no roster member
- Existing events unaffected; test covers the phantom-member case

**Constraints**
- Tier 0 — request validation.

**Out of scope** — new features beyond the listed fix.

**Becomes** — PRD in docs/prd/ on acceptance.

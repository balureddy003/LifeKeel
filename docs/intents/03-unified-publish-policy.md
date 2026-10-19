# Intent: one authoritative public-publish policy

**Problem** — two systems make opposite decisions about the same irreversible
public act: autopilot `NEVER_AUTONOMOUS` code-rejects publishing automation,
while `autoPublishEligible` (trust_level ≥ 5) auto-publishes social posts with
`approved_by: 'auto-trust'`. Both live.
Evidence: `operator/autopilot.ts:376-382`, `routes/marketing-posts.ts:145-150,1102-1116`.

**Done looks like** — one reviewed decision, enforced in one place:
- Either auto-publish joins `NEVER_AUTONOMOUS` (trust ladder caps at
  "queue for one-click approve"), or it becomes a formally approved Tier-3
  path with per-channel consent, exact preview, revocation, and an incident
  story — and `NEVER_AUTONOMOUS` names the exception explicitly.
- Stage-0 fitness test asserts the two systems cannot disagree.
- Generated (AI) drafts remain review-only in all cases.

**Constraints**
- Trust tier touched: 3 — this decides what automation is permitted for
  public effects; approval gate: operator-level decision recorded in the PR.
- Regulated-advice check: auto-published copy still passes the deterministic
  advice/content guard.
- Data/privacy limits: none new.

**Out of scope** — new social channels; engagement metrics; campaign engine.

**Becomes** — PRD number once accepted: docs/prd/NNN-*.md

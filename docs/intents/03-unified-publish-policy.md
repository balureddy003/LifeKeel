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

---

## Implementation record (2026-10)

**Shipped — option A: auto-publish joins `NEVER_AUTONOMOUS`.** Operator-level
decision: earned trust never buys an external, effectively-irreversible
public action. The Tier-3 alternative (per-channel consent, exact preview,
revocation, incident story) was rejected — social publishing fails the
Tier-3 definition on two of three counts (it is not reversible, and the
stakes are public). Removing the weaker system is smaller, matches the
autopilot policy that already code-rejects `marketing.publish`/`social.post`,
and keeps the trust ladder's meaning honest: a display of earned
confidence, never a licence.

**Changes:**

- `routes/marketing-posts.ts` — `autoPublishEligible` and the `auto-trust`
  claim/dispatch block deleted; every `POST /marketing/posts` lands 'draft'.
  `incrementTrustScope` kept: the counter still increments on human approve
  as an earned-confidence display — it unlocks nothing. `auto_published`
  remains on the doc type for historical records.
- `operator/autopilot.ts` — `NEVER_AUTONOMOUS` comment records that this is
  now the single publish-policy door.
- Web operator marketing page — the "at 5, Keel publishes new drafts here
  itself" banner replaced with "every publish stays a human tap".
- `trust-tier-gate.test.ts` — publishPost call-site count 3→2; new
  no-disagreement tripwire fails if an auto-approval path returns or
  `NEVER_AUTONOMOUS` drops the publish entries.
- `marketing-posts.test.ts` — auto-publish test replaced with a
  draft-at-full-trust assertion; scheduled-post tests now approve via the
  human route.

**Deliberately unchanged:** `daily_marketing_drafts_enabled` (draft
generation is Tier 1, review-only — unaffected); `auto_execute_enabled` and
`jobs/auto-execute-trusted.ts` (insight `log_only` scopes only — marketing
scopes never matched an insight workflow so nothing else spent the
counter); the `marketing.post_auto_publish` audit event vocabulary
(historical records keep it).

## Amendment (intent 46, standing approvals)

Intent 03's rule is unchanged: a human approves every public text and `NEVER_AUTONOMOUS` names publishing.
Intent 46 changes *when* that approval is given, not whether: a human approves exact texts into a content
bank (by content hash), then sets a limited, expiring policy. The scheduler may then schedule those approved
texts within the policy. It records the bank entry's human approver as `approved_by`, never publishes itself,
and cannot enable itself. The tripwire in `trust-tier-gate.test.ts` pins this second door to the approved
state. Unattended publishing of model-written text remains rejected here.

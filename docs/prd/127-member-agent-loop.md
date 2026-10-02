# PRD-127: Member agent loop — persisted, scheduled nudges

**Status:** Implemented
**Depends on:** PRD-117 (member twin), PRD-126 (agent persona)
**Trust tier:** 0 — informational only; the loop writes state, it never notifies or acts.

## Problem

The PRD-126 agent persona computes nudges fresh on every `GET /family/members/:id/agent` — a pure read with no memory. A real agent loop needs three things a stateless render can't provide:

- **Proactivity**: gaps discovered without anyone opening the page.
- **Memory**: a dismissed nudge stays dismissed; the same gap doesn't re-announce itself.
- **Self-healing**: a nudge whose evidence disappears resolves itself rather than lingering.

## What shipped

### `member_nudges` collection + reconcile (`src/member-nudges.ts`)

Each nudge persists with a stable `dedupe_key` (member + kind + subject — the readiness component or source insight, deliberately *not* the wording, so copy tweaks don't resurrect dismissed rows). `reconcileMemberNudges()` implements:

- produced + no row → insert as `open`
- produced + `open` → refresh wording and `last_seen_at`
- produced + `dismissed` → refresh but stay dismissed (intent respected while evidence stands)
- produced + `resolved` → reopen (the gap returned — a new occurrence)
- open + not produced → `resolved`

### `GET /family/members/:id/agent` — now stateful

Same computed persona, reconciled against the store on read: returned nudges carry their persisted `id` + `first_seen_at`, dismissed/resolved rows are filtered.

### `POST /family/members/:id/agent/nudges/:nudgeId/dismiss`

Member-scoped dismissal — a nudge id can't silence another member's row.

### `runMemberAgentLoop` (`src/jobs/member-agent-loop.ts`)

Daily cron (07:15, under the `member-agent-loop` cron lock) iterating every roster member of every family: rebuild the twin → `buildMemberAgent` → reconcile. Estate detail uses the organizer's viewer standing (nudges are read by adults on the member page); per-member failures are logged and isolated. No delivery — notification is a separate trust-tier decision.

### Web

The member-page agent card gains per-nudge dismiss (optimistic removal + API call); `MemberAgent.nudges` carry `id`/`first_seen_at`.

## Not in scope

- Nudge *delivery* (push/email) — Tier 1+ decision; the loop writes state only.
- LLM-generated nudge copy — stays deterministic inside the informational boundary.

## Tests

`member-twin.test.ts` (+4): stable dedupe across reads, dismissal persists, evidence-gone self-resolution, cross-member dismiss 404. Job exercised via the shared reconcile path.

# PRD-111: Unreported life-change nudge — notice before it's declared

## Problem

PRD-108's life-event playbooks only ever personalize once a family
explicitly opens `/life-events` and picks a type. Nothing today notices
when the family's *own* profile data already carries the signature of a
major change. Verified live: `POST /family/financial-profile` in
[family-financial-profile.ts](../../apps/api/src/routes/family-financial-profile.ts)
`$set`s the whole document on every save and returns — there is no
comparison against what was there before. A household whose
`monthly_salary_minor` drops to 0, or whose `employment_status` flips
from `employed` to `unemployed`, gets exactly the same silent
save-confirmation as a household that changed nothing. The gap this PRD
closes isn't "we don't have a playbook for this" (PRD-108 does) — it's
the mental leap between something happening and a family thinking to go
report it, which is exactly the leap someone mid-crisis is least
equipped to make unprompted.

## Market bar

Lenders and insurers already run transaction-pattern AI to detect
financial distress in a *borrower*, defensively, to protect their own
exposure — see the research in
[competitive-differentiation-deep-dive-2026.md](../reviews/competitive-differentiation-deep-dive-2026.md#angle-3--datadetection-moat-distress-signals-for-the-family-not-against-them).
No consumer product found turns that same instinct around to help the
household itself. That research assumed the signal source was a bank
transaction feed. **LifeKeel has no such feed, and this PRD deliberately
doesn't build one.** A live bank/transaction connection (Plaid, TrueLayer,
direct Open Banking) means either becoming an FCA-authorized AISP or
routing through one — exactly the regulatory-authorization territory
CLAUDE.md's "second rule" (added 2026-09-19) commits LifeKeel to staying
out of, permanently, as a business decision. This PRD gets the same
differentiated outcome — noticing before being told — from a source
already fully inside the trust boundary: **the family's own self-reported
profile data, which they already typed in.** Nothing here is surveillance
of an external account; it's noticing a change in data LifeKeel already
holds because the family gave it directly.

## Who it's for

A family whose situation has already changed but hasn't yet made the
jump to "I should tell Keel" — most likely in the same window PRD-108's
playbooks are built for (job loss, disability), just earlier, before
they've framed it as a reportable "event" at all.

## What "done" looks like

On a successful profile save, the previous saved values for a small,
named set of fields (per-earner `employment_status`, per-earner
`monthly_salary_minor`, `emergency_fund.emergency_savings_minor`) are
compared against the new values. If a defined move crosses a threshold —
an earner's `employment_status` moves away from `employed`/
`self_employed`, an earner's salary drops to 0, or emergency savings
drops by more than 40% in one save — **and** no life event of any type
was reported for that household in the last 30 days, a single dismissible
prompt appears: *"It looks like something changed in your profile — want
to tell Keel what's going on?"* Tapping it opens the existing
`/life-events` flow (undetermined type — the family picks, Keel never
guesses or names what it thinks happened). Dismissing it records that
choice so the same detected change never re-prompts.

## Trust tier

**Tier 0 — Observe/Understand/Predict.** A prompt to provide information,
nothing else. No claim about what happened, no action taken, no product
mentioned. Two hard constraints carried over from CLAUDE.md directly:

- **Trust-tier rule:** never auto-files a life event or takes any action
  on the family's behalf — the family always completes the report
  themselves through the existing, unmodified `/life-events` flow.
- **Second rule (regulated advice/arranging):** the prompt is
  information-gathering only, word-for-word close to "tell Keel what
  happened" — it must never be paired with, or followed by, a product or
  coverage suggestion in the same surface. That pairing is the one
  combination CLAUDE.md explicitly calls out as crossing from "helpful
  nudge" into "unsolicited personal recommendation."

## Scope

1. **Minimal change history.** Before applying the `$set` in `POST
   /family/financial-profile`, read the current document's values for the
   named fields only (not a full snapshot store) and diff against the
   incoming values. No new collection required for v1 — this is a
   read-before-write on the same document, not a history table.
2. **Detection function** (e.g. `detectUnreportedLifeChange(previous,
   next, recentLifeEvents)` in a new small module, unit-tested in
   isolation) implementing the three threshold rules above, returning
   `null` or a single generic `{ reason: 'profile_change_detected' }` —
   deliberately not a specific event-type guess.
3. **Recent-life-event check** — reuse the existing `family_life_events`
   collection (already queried by `GET /life-events`) filtered to the
   last 30 days, so a family who already reported doesn't get double-
   prompted for the same real event.
4. **Persistence for the dismiss state** — a small per-tenant flag (e.g.
   `last_nudge_dismissed_at` or a dedicated single-document collection)
   so a dismissed nudge doesn't reappear on the next unrelated save.
5. **Frontend surface** — a dismissible card on Home (same visual language
   as the existing "existingSameType already reported" notice in
   `life-events/page.tsx`), linking to `/life-events` with no type
   pre-filled.
6. **Audit log entry** (`AuditAction` addition, e.g.
   `'life_event.nudge_shown'` / `'life_event.nudge_dismissed'`) — matches
   the existing convention (`audit-log.ts`) and gives a real signal for
   the false-positive-rate metric below.

Out of scope:
- Any external bank/transaction data source of any kind — ruled out
  permanently per CLAUDE.md's second rule, not deferred.
- Naming or guessing the specific event ("it looks like you lost your
  job") — the prompt only ever says something changed, never what.
- Any product, coverage, or policy suggestion anywhere in this flow.
- Auto-creating a life-event record — the family always completes
  `/life-events` themselves.
- Re-prompting for the same dismissed change, or prompting more than once
  per save (a family editing their profile across several fields in one
  session gets at most one nudge, not one per field).

## Success metrics

- **Nudge → report rate**: of nudges shown, what fraction lead to an
  actual `/life-events` report within the session. Validates the prompt
  is catching real, actionable moments rather than noise.
- **False-positive rate**: dismiss-without-reporting rate, tracked via
  the audit log entries above — a family correcting a typo (e.g. fixing
  a salary field they'd mis-entered) triggering the same threshold as a
  real job loss is the main expected false-positive source; a high rate
  here should tighten the thresholds, not remove the feature.
- **Zero occurrences** of the nudge appearing alongside or immediately
  before any product/coverage copy on the same screen — a regression
  test enforcing the Tier-0/second-rule boundary directly.

## Acceptance criteria

- Given a profile save where an earner's `employment_status` moves from
  `employed` to `unemployed` and no life event was reported in the last
  30 days, the next `GET` surfaces the nudge; given the same save with a
  life event already on file for that window, it does not.
- Given a save where `monthly_salary_minor` or `emergency_savings_minor`
  moves by less than the defined threshold, no nudge fires — a threshold
  test with values just above and just below the line.
- Dismissing the nudge persists across a page reload and does not
  re-appear on a subsequent, unrelated profile save.
- The nudge's copy and every code path reachable from it contain no
  product name, provider name, or coverage-amount suggestion — grep-
  able in a test, not just a manual read.
- No new external data source (network call to any bank/transaction API)
  is introduced anywhere in this PRD's diff.

## Implementation status — 2026-09-19

Shipped, matching this PRD's scope exactly. `detectUnreportedLifeChange`
in
[detect-unreported-change.ts](../../apps/api/src/life-events/detect-unreported-change.ts)
is pure and unit-tested in isolation (12 tests: each threshold, member
matching, first-save no-op). Wired into `POST /family/financial-profile`
on final submits only (`generate_insights: true`), reading the previous
saved doc before the write — the existing optimistic-concurrency version
filter is untouched. `GET /family/life-events/nudge` returns `{active}`
only; a test asserts the response JSON never contains the internal
reason string. Reporting any life event auto-clears an active nudge
(`life_event.nudge_acted_on`, distinct from a silent dismiss) — the
success-metric signal this PRD's own metrics section calls for. A
grep-based guardrail test enforces CLAUDE.md's "second rule" mechanically:
no product/provider name or guessed event type anywhere in the nudge code
path. Full gate clean: typecheck 24/24, lint clean, web 61/61, API 418
passed (only the pre-existing, environment-dependent
`ml-tenant-isolation` failures, unrelated).

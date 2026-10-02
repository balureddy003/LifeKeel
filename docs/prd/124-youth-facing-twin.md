# PRD-124: youth-facing twin surface

## Problem

The member twin (PRD-117) renders the same payload for a 10-year-old as
for the organizer — household amounts, policy premiums, open-insight
copy. The app's global "Child" display mode redacts £ in the *renderer*
(`Money`/`MoneyText`), but the data still arrives in the response: a
phone handed to a kid, or a curious teen with devtools, sees everything.
The vision's youth twins also deserve genuinely different content —
savings progress a child can read, not an adult's financial picture with
the numbers blanked.

## Who it's for

A parent who wants to show a child their own twin — "here's how your
savings are growing" — without exposing household finances.

## What "done" looks like

- `GET /family/members/:id/twin?mode=youth` returns a **server-side
  redacted projection** when the member is a minor (role `child`, or
  DOB-derived age < 18 — DOB wins over a stale role):
  - `youth`: `age_band` (`younger` <13 / `teen` 13–17), an
    age-appropriate headline, and `savings_goals` — education funds
    expressed as `progress_pct` (0–100) + `years_until_goal`, **never a
    minor-unit amount**.
  - `financial` is emptied (`earner: null`, `policies: []`,
    `education_funds: []`, `insights: []`) and `readiness` is `null` —
    for a child it only ever scored education, which the savings goals
    already express. Redaction happens at the API boundary, not the UI.
- `mode=youth` on an adult member → 400 rather than silently returning
  the full payload (a quiet fallback would be a redaction hole
  pretending to work).
- Web: a child's member page gains a **"Kid view"** toggle
  (auto-engaged when the app is already in Child mode) that swaps the
  whole stack — twin card, pending-invite card, DOB editor, Ask Oak,
  links — for the youth view: savings goals as progress bars with
  "% there" / "about X years to go", plus a closing "grown-ups take care
  of the rest" line. Ask Oak is deliberately hidden: assistant prose can
  reference figures even with text redaction.

## Acceptance criteria

- [x] Youth twin for a child carries zero minor-unit fields and zero raw
      savings figures (asserted on the serialized payload).
- [x] 400 for youth mode on an adult member.
- [x] An `adult`-roled member under 18 still gets youth treatment.
- [x] Web member page: kid-view toggle on minors' pages, youth cards
      render progress without amounts.
- [x] 14 tests green in `member-twin.test.ts`; web typecheck clean.

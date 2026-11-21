# 5-star UX iteration 1 (2026-11-21)

Method: walked the new-household home and the policy-add flow at phone width (375px) against the seven
narratives, using Apple HIG and Apple Health's first-run Summary as the benchmark (Health was run in the
iOS Simulator: its empty Summary shows "No Data", one-action setup cards, and invents no figure).

## Findings (new household home, before)
- Three overlapping "starts" on one page: "Start here", "Where to start" (three doors) and "Add what you have
  on file" (four cards). The page ran 2253px with no single primary move.
- The setup list asked for the long financial profile ("finish it to generate your score") and for a
  connected email/bank/insurer. Both break "no long forms or accounts before the first result".
- "Get your first answer" duplicated the first door.
- The 2-minute policy form (/policies/new) was not offered anywhere on home.
- On the policy form the monthly and yearly labels wrapped differently at 375px, so the two inputs sat at
  different heights.

## Changed
- Setup list is now a registry (`lib/setup-steps.ts`): Add a policy, Upload a document. Same card anatomy
  as every other entry (title, one line, one action, dismiss). A new service adds a row, not a section.
- Dropped from the new-household list: the long profile and Connect a service (still reachable from Family and
  Settings) and the duplicate first-answer card.
- Premium labels shortened so both inputs align; test covers the £42 / £500 mismatch appearing as you type.
- Home height for a new household: 2253px to 1720px.

## Remaining friction, next
1. Emergency entry: with SOS no longer floating, Emergency mode is Home, Family, Emergency (two taps). Consider a
   single always-visible row on home.
2. Partner join: invite link, partner confirms, parent sees "seen" state. Not yet walked end to end.
3. "Change one thing and see the impact": no before/after line on edit.
4. Pinned tiles (#552) and the one-action Start here card need to merge to judge the whole first screen.
5. Empty single-parent household (no income, no policies): confirm no nonsense number.

## Iteration 5: change one thing and see the impact (narrative 4)
Finding: a premium could be added in one short form but not edited. The only way to change one was the long
financial-profile wizard ("Some of this comes from your financial profile. Change it there."), and nothing said what
had changed or what had not.

Changed:
- API: `PATCH /family/policies/:id` changes cover, monthly premium or yearly premium on a policy on the list (household
  editors only, strict body, nothing else editable) and answers with the saved policy, the monthly-versus-yearly check
  re-run on the new figures, and `changes`: what changed (before, after) and what stayed the same. An edit that changes
  nothing writes nothing and does not stale the briefs. Version bumps once per real change.
- Web: "Update figures" on each policy row opens an inline form pre-filled with today's figures; the mismatch check
  re-runs as you type; on save the row updates at once and says "Updated. Monthly premium was £42, now £45. Cover and
  yearly premium stay the same." On failure the form stays open with the reason.
Checked: red-then-green mutation on the change comparison (5 tests failed with it flipped); live at phone width against
the stand-in API.

Still open: income edits (still the long wizard); the line "Change it there" on the domain page still points at the
wizard for non-policy fields; the home score does not yet show a before/after when a figure moves.

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

## Iteration 6: single parent, almost no savings, low or no income (narrative 6)
Method: ran the runway brief on four household shapes (no savings with no income, no savings with low income,
a little savings with low income, income above spending with no savings).

Finding: the brief handled zero cleanly in the numbers but read as nonsense in words when savings were zero from
the start. It said "there are no savings to draw on" three times (before, at the change, after the change) and then
"savings would run out around October 2026 (about month 0.0 from the calculation date)", a run-out date for money
that was never there.

Changed: when there are no savings at any stage, the brief says it once, with the two figures the household entered:
"No savings are entered, so there is nothing to draw on, before or after the change. Income entered is £1,200.00 a
month against £1,500.00 of spending." No run-out date in that case. A household that has savings keeps the
three-stage wording. The web headline mirrors the plain sentence. One existing test's wording was updated on purpose
(it pinned the old repeated phrase); four new tests cover the four shapes.

Not changed, still to check: how the home score and detectors read an all-zero saved profile; the pinned tile for
savings shows "No data yet" for a deliberate zero (reads slightly wrong for a household that entered 0); the
emergency-fund detector at zero monthly spending was not exercised.

Local note: one API test fails only without a real MongoDB (users-email-index integration), as CLAUDE.md says.

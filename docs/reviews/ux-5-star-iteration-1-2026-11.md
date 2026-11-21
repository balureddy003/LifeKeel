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

## Iteration 4: the steps page leads with the policy and who to call (narrative 5)
Finding: the scenario steps page started with a generic intro; the family's own policy and phone number only
appeared inside individual steps further down.

Changed: "Your cover on file" is now the first block under the safety notice. It lists the policies that bear on
what happened (bereavement: life cover; medical and disability: critical illness and income protection; job
loss: income protection) with provider, cover on file, policy number if given, and a full-width Call button
(tel: link, one tap by the person; nothing dials itself). A policy with no phone says so instead of showing a
dead button. If none is on file: a plain line and "Add a policy". Not shown for car, property or travel events,
which these policy types do not cover. Viewed at phone width with both states.

Still open: car, home and travel events have no policy source yet (the list holds life-type policies only), so
those pages still lead with the generic intro; a "who is named" line and the partner confirmation state on
this page are not added.

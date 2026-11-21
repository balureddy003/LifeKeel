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

## Iteration 3: emergency in one tap (narrative 5)
Finding: with SOS no longer floating, Emergency mode was Home, Family, Emergency row: two taps before the
first choice, and not where a panicking person looks.

Changed: a "Something has happened" row, first thing under the header on Home. One tap opens "What
happened?" (five plain tiles plus the 999 notice); one more tap on the tile reaches that scenario's steps.
Home to steps in two taps. Viewed at phone width. Hidden only where a mode hides emergency entry.

Still open: Emergency mode lists scenarios, not the family's own policy and contact. The scenario page should
lead with "your policy, who to call" from the list (the narrative asks for the relevant policy and contact in
two taps); that is the next change here and needs the policy list on that page checked first.

## Iteration 8: landing and first value (narrative 1)
Walked at 375px: landing, signup, the road to the first number.
- Landing: headline "Know where to look.", one primary button "Start your family's list", free-to-start line, three
  promises. Works. The sub-headline is a five-line paragraph; it carries deliberate "estimate from the figures you
  enter" wording, so it was NOT rewritten here (marketing copy and claims are the owner's).
- Signup: name, email, password, or Google. Three fields. Lands straight on Home. Works.
- Home to first number: "Answer a money question" opens Household briefs. Finding: for a first-time solo parent the
  page opened with two notes ("This one is just for you", with a Go to Family button, then "Your first brief is
  free") above the choice, so the first thing was text to read and a button that pulls away from the first result.

Changed: the choice ("What is changing?") now comes first; the two notes sit under it. While a form or result is
showing they keep their old place. Test fails on the old order and passes on the new.

Open: the landing sub-headline length (owner decision on copy); a live look at the briefs page against the real API;
timing the whole path on a real phone.

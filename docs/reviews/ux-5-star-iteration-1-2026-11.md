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

## Iteration 7: zero profile through the score and detectors (narrative 6, continued)
Method: ran the readiness score on four zero-shaped profiles and read the detector conditions against zeros.

Findings
1. A single parent who had only added a child (no mortgage, no living expenses, no education target) produced a
   NaN protection score and a NaN composite: the life-cover check divided by a household need of zero. The
   member-level score already guarded this (`need > 0`); the household one did not.
2. The no_income_protection insight fired for an employed household with no salary entered, and its text read "the
   estimated impact ... could be 0 to 0 of lost income".
3. The protection component and that insight are meant to agree (the code says so), so the subscore needed the same
   no-salary gate or the two would contradict each other.

Changed
- score.ts: the household life-cover check applies only when a need figure exists; the composite ignores any
  non-finite component (counts as no data); an earner with no salary entered is not "protectable" yet.
- protection-gap.yaml: no_income_protection also requires monthly_salary_minor > 0. Golden case added
  (employed-but-no-income-entered, expected silent); red first, green after.
- Tests updated on purpose: two engine detector tests (their fixtures had no salary, which now rightly means silent;
  a new test pins that) and one Ask Keel verified-answer test whose premise was the NaN composite itself (it now expects
  the score shown from the sections that can be scored, and "not scored yet" for the rest).

Left alone, noted: the all-zero profile still scores protection as null and estate as 0 (an empty vault is a real gap);
the savings tile on home shows "No data yet" for a deliberate zero; no screen-level view of the zero profile on staging.

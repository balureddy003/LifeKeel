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

## Iteration 2: partner join (narrative 3)
Walked from code: Add the other adult (Settings), then an invite link, then the partner opens /invite/<token>, sets a
password and is signed in, and the roster entry goes active.

Finding: after adding an adult the only guidance was a toast ("tap Invite next to their name"). The link itself lived on
the member profile page (Family, then the person, then Share link): three places to hunt in the moment that matters.

Changed (#554): right after adding an adult, a card "Sam is on the list" with one button, "Send Sam the link". It makes
the link and opens the phone's share sheet (copy if there is none). Cancelling the sheet changes nothing. No email
address is required and no email-verify step is in the path.

Not yet walked: the partner's side on a real phone, the organizer seeing "Sam has looked" on Home, and the join-code
request path (name, email, password, captcha, then waiting for approval), which is heavier than the emailed link.

## Iteration 4: the steps page leads with the policy and who to call (narrative 5)
Finding: the scenario steps page started with a generic intro; the family's own policy and phone number only appeared
inside individual steps further down.

Changed (#556): "Your cover on file" is the first block under the safety notice. It lists the policies that bear on what
happened (bereavement: life cover; medical and disability: critical illness and income protection; job loss: income
protection) with provider, cover on file, policy number if given, and a full-width Call button (a tel: link the person
taps; nothing dials itself). A policy with no phone says so. If none is on file: a plain line and "Add a policy". Not shown
for car, property or travel events.

Still open: car, home and travel events have no policy source yet; "who is named" and the partner confirmation state are
not on this page.

## Iteration 5: change one thing and see the impact (narrative 4)
Finding: a premium could be added in one short form but not edited. The only way to change one was the long
financial-profile wizard, and nothing said what had changed or what had not.

Changed (#557): `PATCH /family/policies/:id` changes cover, monthly premium or yearly premium (household editors only,
strict body) and answers with the saved policy, the premium check re-run, and what changed (before, after) versus what
stayed the same. A no-op edit writes nothing. On the web, "Update figures" on each policy row opens an inline pre-filled
form with a live mismatch check; on save the row updates at once: "Updated. Monthly premium was £42, now £45. Cover and
yearly premium stay the same."

Still open: income edits (still the long wizard); the domain page line "Change it there"; a before/after on the home
score when a figure moves; no staging-sim scenario for the edit yet.

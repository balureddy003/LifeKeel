# LifeKeel end to end: one family, the whole journey

Date: 2026-11-08. Built from the brief catalogue (41 entries in
`apps/api/src/briefs/catalogue-entries.ts`), the seven life-event playbooks in
`playbooks/family/`, and the claims registry (`apps/web/src/components/landing/claims.ts`).
Every beat below names the claim that makes it true. Beats marked **planned** are not built and must
not reach the public site (`NoRoadmap.test.tsx`).

**Rules this story keeps.** It describes what is on file and what is coming; it never says what a
family should buy, never names an insurer, never judges whether cover is enough (CLAUDE.md rule 2).
Nothing leaves LifeKeel unless an adult approves it (`approval-first`). The cast is made up: Dev,
Marcia and their child Asha, who is a simple shape, never named in a scene that shows a record about
her.

## The idea in one line

Know where to look. A family list that every adult has looked at, that shows what is coming, and that
gives the first steps from what is actually on it when something happens.

## Chapter 1: Tonight (set up, ten minutes)

Marcia adds one thing: the car (`family-list`). She adds the car policy and its recovery contact
(`recovery-contact`, `who-to-call`). She sends Dev an invite; Dev joins with a code and Marcia
approves him (`join-with-code`). Dev opens the list and confirms he has seen it
(`every-adult-confirms`). Nothing else is needed tonight.

Catalogue: `handover_gap` ("the other adult does not know"), `vehicle_handover`.

## Chapter 2: This month (the list fills in, a little at a time)

They add the life policies, the employer cover Dev has through work (`employer-cover`), and where the
will is kept (`papers-on-file`, catalogue `key_documents`). Papers sit in the vault, openable by both
adults (`vault`). A passphrase is optional; if it is lost, it cannot be recovered, and the page says so.

LifeKeel shows what is on file: a life policy held by Dev that covers Marcia, and one held by Marcia
that covers Dev (`cover-on-file`). It can compare cover on file with a rough household estimate
(`cover-estimate`) and says plainly that it is an estimate, not advice.

Two checks run on what they entered, and both only say what the records show:
- A nomination that predates a child on the family record is flagged (`nomination-check`). It never
  says who to name.
- The same policy listed twice is flagged (`renewals-duplicates`).

**Planned, not built:** overlap between two partners' different policies (`partner-overlap`) and a
person-by-policy matrix of who is covered.

## Chapter 3: The year ahead (dates, not surprises)

The list shows what is coming next (`dates-coming-up`): MOT due 14 March, the renewal, the nursery
fee start. For each money moment LifeKeel prepares a brief with a date and a runway in months, and
shows how the number was worked out (`runway`, `what-if`). Both adults see the same number and open it
(`household-brief`).

Catalogue moments, in the family's words:
- "Our fix is ending." `mortgage_fix`, `renewal`, `rent_rise`, `tenancy_end`, `moving_home`.
- "Fees are starting." `pregnancy`, `nursery`, `school_start`, `primary`, `secondary`, `college`,
  `university`, `fees_start`, `fees_end`, `child_leaving`, `child_returning`.
- "Something changes at work." `income_stops`, `earning_less`, `job_change`, `hours_cut`,
  `unpaid_leave`, `retiring`, `self_employed`.
- "A bill landed." `energy_council_tax`, `car_repair`, `windfall`, `debt_payoff`, `joint_bill`,
  `rental_change`, `supporting_relative`.

Each month a short note says what changed, and says so when nothing did (`monthly-letter`). Alerts go
by push or email, whichever works on the phone (`alert-channels`).

## Chapter 4: The practical handover (so one person is not the only one who knows)

Facts only, no calculation. `medical_contacts`, `school_handover`, `home_emergency`, `digital_access`
(no passwords are ever stored), `care_handover`, `pet_care`, `vehicle_handover`, `household_plan`.
Who each recurring bill and account depends on is entered by the household and shown back
(`obligations-map`). A bill in one name is a flagged fact, not a verdict (`joint_bill`).

## Chapter 5: The day it happens

Dev has an accident on holiday. Marcia opens the list on her phone.

1. **First steps from what is on the list** (`first-steps-from-list`, `emergency-mode`). The travel
   playbook (`playbooks/family/travel.yaml`) opens: check which cover may apply, call the insurer's
   assistance line before paying for treatment, keep every receipt, and for lost documents the
   embassy or consulate. Steps that need a number show the number from the family's own papers
   (`who-to-call`).
2. **The papers are already there.** Policy numbers, the insurer's line as printed on the paper, the
   school pickup details, the medical contacts. Nobody searches an inbox.
3. **Telling the insurer.** LifeKeel can draft a message to her own insurer (`draft-insurer`). She
   edits and sends it herself. Nothing is sent for her (`approval-first`, `no-money-moved`).
4. **Telling people.** She chooses who to tell. People she named in advance can receive an email, if
   she turned it on, that points them to papers they can already open (`continuity-emails`).

The same shape covers the other six bad days: medical, disability or critical illness, job loss, car,
property, bereavement (`bad-day-steps`, `playbooks/family/*.yaml`).

## Chapter 6: If the worst happens (bereavement)

Marcia is the surviving adult. The bereavement plan lists whom to notify: insurers, employer for
survivor benefits, the pension provider, and the mortgage protection on file. She starts from the
claim packet for a life policy: the contact as printed, the policy number, what the insurer usually
asks for (`claim-pack`). She already knows which drawer and which number. Steps that point to a
professional (an adviser) say so and do not recommend one.

Records held by a person who has gone stay on the list, shown as held by someone no longer in the
family. A person removed or who leaves is cut off at once (`leave-and-removal`).

**Planned, not built:** a "how to claim" guide for each kind of policy (`how-to-claim`), a way to mark
someone as deceased, and a takeover route when the only organizer has died.

## Chapter 7: After (the list copes)

People come and go. Anyone can leave; a removed person gets no email about it. A child cannot leave
alone; the account owner hands over first. A child on two homes' lists is not visible across them.
A person's own export holds only their own data (`export-data`, `delete-account`).

**Planned, not built:** limited view for a lodger or helper, access for a named person outside the
family (`named-person-access`, blocked on safeguarding review), a dedicated view for caring for a
parent (`carer-view`).

## The honest edges (what this story must never say)

| Never say | Because |
|---|---|
| "It tells you if your family is covered / you have a gap" | There is no person-by-policy matrix, and judging need is advice |
| "You should buy / switch / add X" | Rule 2, and `no-policy-picks` |
| "It contacts your insurer / friends for you" | Rule 1 and `approval-first`; drafts only, you send |
| "Always watching" | Blocked claim `always-on` |
| "Family data is never used for training" as a technical guarantee | Blocked claim `no-training` (procedural) |
| "Proof you have both looked" | It is a recorded confirmation; an adult can be excused |

## From this story to the page

1. Landing: keep "Marcia's Tuesday" as chapter 1, then three short cards after it: the nomination,
   the school fees number, the quiet renewal (all `live`).
2. Blog or guide: the bereavement and the holiday accident chapters, worded as "knew which drawer".
3. Build next, in this order, so the strongest story becomes true: the person-by-policy matrix
   (domain-packs plan, phase 2), the claim playbook that pulls the relevant policies (phase 4), a
   travel pack so "no travel policy on file" is a fact the list can show.

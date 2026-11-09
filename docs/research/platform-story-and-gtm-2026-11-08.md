# LifeKeel as a platform: story, narrative and go-to-market (rebuilt)

Date: 2026-11-08. Supersedes the go-to-market section of `gtm-story-review-2026-11-08.md` (#451) and
extends `end-to-end-story-2026-11-08.md` (#448). Simulated expert perspectives, not sign-off; claims
rest on `apps/web/src/components/landing/claims.ts`; advertising rules need a qualified human.

**Decision carried in:** the public word stays **list** (owner, 2026-11-08). "Platform" is how we
describe LifeKeel to partners, employers and ourselves. To a family it is the list, and the map is what
the list shows. Nothing below changes that.

## 1. Positioning

| | |
|---|---|
| **Category** | The family record: one place a whole household keeps what it would look for, and every adult has looked at it. |
| **For** | Two-adult (and one-adult) UK households with children, a home and work-provided cover. |
| **The problem** | Family life runs on one person's memory: money, home, car, health, travel, children, care, papers. |
| **Unlike** | Notes apps and spreadsheets (nobody is asked to look), insurer or bank apps (one provider each), finance apps (they tell you what to do). |
| **Because** | One shared record, every adult asked to confirm, dates and checks that run on it, first steps ready when something happens. |
| **Proof** | 41 money and handover briefs, 7 first-steps plans, checks on what is on file, an invite loop that gets a second adult to look. |
| **Promises** | No commissions. Never moves money. Details not sold. Information, not advice. |
| **Internal job line** | If one of us can't answer, the other shouldn't start from nothing. |

## 2. The narrative, in three layers

1. **The brand story (why):** the enemy is "everything lives in one head". The hero is the other
   adult. Stakes are everyday dignity, not disaster. Line: **Know where to look.**
2. **The platform story (what, across life):** one record, many areas, one loop. A new area adds
   records, dates and first steps to the same record; the family never re-enters anything.
3. **The proof (does it work):** three ordinary moments (nomination, nursery number, renewal), the
   six-beat Tuesday, and honest limits.

### The platform story, as the page tells it

> **Most families run on one person's memory.** The car insurance is in one email, the school pickup
> in one head, the will in one drawer.
>
> **LifeKeel is where it lives once.** A shared list your whole family knows where to find. Every adult
> is asked to look, so it is not one person's notes.
>
> **It works across the year.** The car and its MOT. The trip and who to ring. The nursery fees and a
> number you both opened. The mortgage fix, months before it ends.
>
> **And on the day something happens, you are not starting from nothing.** First steps from what is
> on your list, the policy numbers, who to call, a message to your own insurer that you send.
>
> No commissions. Never moves money. Your details are not sold. Information, not advice.

Every line maps to a live claim (`family-list`, `every-adult-confirms`, `dates-coming-up`,
`household-brief`, `first-steps-from-list`, `who-to-call`, `draft-insurer`, `no-commissions`,
`no-money-moved`, `no-selling`).

## 3. Message house

**Umbrella:** Know where to look.

| Pillar | Says | Proof (live) | Never says |
|---|---|---|---|
| **One record** | Everything the family would look for, once. | `family-list`, `vault`, `papers-on-file`, `obligations-map` | "All your finances", "complete picture" |
| **Everyone looks** | Every adult is asked to confirm, and a change asks everyone to look again. | `every-adult-confirms`, `join-with-code`, `edit-access`, `leave-and-removal` | "Proof they've seen it", "both sides covered" |
| **Ready when it happens** | First steps from what is on your list. | `first-steps-from-list`, `emergency-mode`, `claim-pack`, `draft-insurer`, `continuity-emails` | "It handles it for you", "we contact your insurer" |

### Area messages (the platform in the family's words)

| Area | What the family says | Entry message | Status |
|---|---|---|---|
| Money and income | "What if we…?" | One question, one number, shared with the other adult. | Live: 41 briefs |
| Protection | "Do you know what we have?" | Who each policy covers, and what is on file, as you entered it. | Live; person-by-policy matrix planned |
| Car | "Whose name is it in?" | The car, the policy and who to call, on one list. | Live |
| Home and mortgage | "When does the fix end?" | The date, months ahead, with the number. | Live as brief |
| Travel | "Who do we ring?" | The policy, the assistance line, the dates, before you go. | First steps live; dedicated area planned |
| Health | "Who is the GP, what are the meds?" | Medical contacts on the list for whoever needs them. | Live as handover brief |
| Children and education | "When do the fees start?" | Dates and fees in one brief. | Live as briefs |
| Care for a parent or partner | "Who is looking after Mum?" | Care handover facts. | Brief live; dedicated view planned |
| Papers | "Where is the will?" | Where it is kept, and the papers adults can open. | Live |
| A named person outside the family | "Can my friend see it?" | Not yet. | Planned, blocked on safeguarding review |

## 4. Page and product arc (rebuilt)

1. **Hero:** Know where to look. Sub: the problem in one email and one head, then "a shared list your
   whole family knows where to find". Under the button: free, no card, no commissions.
2. **The cost, calm:** most families have one person who remembers; that is fine until they are away.
3. **Marcia's Tuesday:** kept (one cast, #444).
4. **Across the year:** one household, four areas (car, trip, nursery fees, mortgage fix), one
   record. New; replaces the dense card wall as the platform proof. The cards stay behind "more" (#445).
5. **Three ordinary moments:** proof (#449).
6. **When something happens:** first steps and the claim packet, calm, no disaster imagery.
7. **Why trust it:** promises as a headline row; "what it does not do" moved up.
8. **Start your family's list.**

Build order: (a) hero sub and cost section, (b) "across the year" section, (c) move trust up.
The invite page for the second adult is already open (#452).

## 5. Go-to-market, rebuilt

**Strategy.** Product-led, invite-driven, moment-timed. Land with one item and one invite; expand
into more areas as life events arrive. Land is the car or a policy; expansion is the next moment.

### Who, and when
- **Segment A (lead):** two-adult UK households, a child under 10, a mortgage, work-provided cover.
- **Segment B:** one-adult households (single parents, carers), where "every adult" is one person
  and the value is the person they name to call. Needs the named-person access, so wait.
- **Segment C:** households with a parent they care for.
- **Triggers (the entry points):** new baby or pregnancy, nursery or school start, mortgage fix
  ending, moving home, a scare (illness, accident), a death in the wider family, a trip abroad.

### Funnel and what to measure
Visit → start a list → first item → invite sent → second adult looked → both confirmed within 7 days
→ second area added within 30 days. Primary metric: **both adults have looked within 7 days.**
Secondary: invite-to-look rate, items on the list at day 7, return in 30 days. Use the existing
content-free `growth-events`; add no personal data. No targets are invented here: run 30 days, then
set targets from what we see.

### Channels, sequenced
| Order | Channel | What it is | Guardrail |
|---|---|---|---|
| 1 | Invite loop | The invite email and page (#452), made excellent | No pressure copy; an adult can be excused |
| 2 | Moment content | One page per trigger: "What to have ready before nursery starts", "A mortgage fix is ending", "Who to ring if your partner can't answer" | Information only; each page ends in one action on the list |
| 3 | Community | Antenatal groups, parent forums, school PTAs, local groups, carers' networks | Be useful, say it is ours, no astroturf |
| 4 | Partners | Employers and HR benefits newsletters, family charities, perinatal and carers' organisations | Free for families, no commissions, no data sharing |
| 5 | PR | "How we test": 40 made-up households, what it got wrong and fixed | Only after the lodger limit is fixed and a human checks it; label households as made-up |
| 6 | Paid | Retargeting to people who visited and did not start | Only after human review for advertising standards and safeguarding |

### Pricing and packaging
Free to start covers the loop. One optional paid plan adds more (reading uploaded policies, inbox
summaries, unlimited briefs). Show the price in the pricing section only. Do not rename Keel Plus here;
it is an open decision.

### What not to do
Affiliate or lead-gen deals, fear-led creative, "is your family covered?" quizzes, any copy that says
what to buy or that cover is enough, invented testimonials, publishing "136 of 137".

## 6. 90 days

| Weeks | Do | Done when |
|---|---|---|
| 1 to 2 | Merge the copy PRs; ship the hero sub, cost section and trust row; deploy staging web and re-test at 375px | Staging shows the new arc; the checklist in the staging runbook passes |
| 3 to 4 | Build "across the year"; improve the invite email (owner call on naming the family, H37); instrument the funnel with `growth-events` | Both-adults-looked is measured end to end |
| 5 to 8 | Five moment pages; one community post per week; recruit 10 real households to test with, each told it is pre-launch | 10 households through to a second adult looking |
| 9 to 12 | Read the funnel; fix the biggest drop; decide on Segment B and a partner pilot | A written decision on what to double down on |

**Stop or change course if:** after 30 days fewer than half of invited second adults look, the
invite page and email are the fix before any acquisition spend.

## 7. Risks and guardrails

- **Overclaiming "platform" or "map".** Keep to live claims; the matrix and named-person access are planned.
- **Advice by implication.** Gaps are "what is on file, and where it looks light as an estimate". Never what to buy.
- **Trust before growth.** The Trust page shows unreviewed processors as "not yet reviewed"; resolve
  before any paid push.
- **Safeguarding.** A link can reach the wrong person; never put list content or a family name on a public step.
- **The word "platform" on the public site.** Consumers hear "list"; partners hear "platform".

## 8. Decisions for the owner

1. Approve the positioning table and the internal job line.
2. Approve the platform story paragraph as the hero and cost-section copy.
3. Build "across the year" as the platform proof section?
4. Replace the generic blog and guides with moment pages (and who writes and reviews them)?
5. Segment B (single adults and carers) after named-person access, or earlier?
6. Partner pilot: employer or family charity first?
7. Founder story: yes or no.
8. Keel versus LifeKeel, and Keel Plus (open).

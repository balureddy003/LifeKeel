# Go-to-market review of the LifeKeel story

Date: 2026-11-08. Builds on `brand-and-story-guide-2026-11-08.md` and `end-to-end-story-2026-11-08.md`.

**What this is.** Five simulated go-to-market reviewers read the live landing page on staging (hero,
"Marcia's Tuesday", the six-questions cards, the trust and pricing sections), the end-to-end story,
and the claims registry. They are AI-simulated perspectives, not credentialed people, and not
sign-off. Advertising standards, the `.si` site and any paid use still need a qualified human.

Lenses: positioning strategist, growth and activation lead, category and channel lead, trust and
compliance marketer (regulated-adjacent consumer products), brand storyteller.

## 1. What the panel says about the story today

| # | Lens | Finding | Why it matters |
|---|---|---|---|
| 1 | Positioning | The page never names a **job** a stranger already has. "Know where to look" is a brand line; the buyer's sentence is "if one of us can't answer, the other shouldn't start from nothing." | A line that needs explaining loses on a 5-second read. |
| 2 | Positioning | **Three categories at once:** shared list, map of gaps, and finance explainers (blog and guides). A visitor cannot tell if this is notes, insurance, or a budgeting app. | Category confusion is the biggest conversion leak for a new product. |
| 3 | Growth | The product is **two-sided**: it only works when a second adult looks. The page sells the first adult only. Nothing speaks to the person who gets the invite. | The invite is the growth loop and the page ignores it. |
| 4 | Growth | The first action is "start your family's list": a blank list is an empty-room problem. The strongest activation is **one item plus one invite plus one confirm**. | Time to the first "I didn't know that" is the metric that predicts retention. |
| 5 | Category | The **buying moments are already known** (new baby, mortgage fix ending, nursery or school start, moving home, a scare). The page speaks to none of them; the blog is generic ("Now what?"). | Moment-based pages and content are how this category is found. |
| 6 | Trust | The strongest differentiators (no commissions, never moves money, details not sold, information not advice) sit in a small row under the CTA and in a long cards section. | In a category where trust is the product, trust is a headline, not a footnote. |
| 7 | Trust | **No proof.** Everything is a made-up family, correctly labelled. Nothing says who built it, how it was tested, or what it has not got right. | Pre-launch products need honest proof, not borrowed proof. |
| 8 | Brand | The story is calm and well-made, but the **stakes are invisible**: a reader sees no cost of not having the list. The pasted drafts (A&E, signed off) show real stakes, and the brand guide says everyday dignity, not disaster. | The page needs one honest cost line without death imagery. |
| 9 | Brand | "Keel" (the assistant) and "LifeKeel" (the product) blur, and "Keel Plus" is an open naming decision. | Two names for one thing costs trust and search. |
| 10 | All | The three "ordinary moments" are the best new asset: specific, calm, backed by claims. | Make them the proof section, not an add-on. |

## 2. Where the reviewers disagreed

| Question | One view | Another view | Call (for the owner) |
|---|---|---|---|
| Lead with the crisis (A&E) or the ordinary? | Growth: a crisis opener converts better. | Brand and compliance: fear framing breaks the guide and invites an advice read. | Lead with the ordinary cost ("one person remembers"); keep the crisis for the SOS page and paid retargeting that a human has reviewed. |
| Lead with "map and gaps"? | Positioning: gaps are the most differentiated promise. | Trust: gaps are the first thing a regulator reads as advice. | Say "where it looks light, as an estimate from the figures you enter". Never name a gap in the hero. |
| Free vs Plus on the page | Growth: show the price early. | Brand: "optional paid plan" is enough above the fold. | Free first, price in the pricing section only. |
| Founder story | Storyteller: very powerful. | Trust: only if true and approved. | Owner decision. Not drafted here. |

## 3. Refined story

### The one-line job (internal)

If one of us can't answer, the other shouldn't have to start from nothing.

### Message hierarchy (what a visitor should take away, in order)

1. **The problem, ordinary:** one person in every family remembers everything.
2. **The idea:** a shared list the whole family knows where to find.
3. **The difference:** every adult is asked to look, so it is not one person's notes.
4. **The proof:** three ordinary moments, backed by what the product does today.
5. **The safety:** no commissions, never moves money, details not sold, information not advice.
6. **The first step:** add one thing tonight, send the invite, they confirm.

### Hero (copy for review, each line on a live claim)

- **Headline:** Know where to look.
- **Sub:** The car insurance is in one email. The school pickup is in one head. LifeKeel is a shared
  list your whole family knows where to find. *(claims: family-list, every-adult-confirms)*
- **Second line:** It shows what is on file, what is coming next, and where it looks light, as an
  estimate from the figures you enter. *(claims: dates-coming-up, cover-estimate)*
- **Primary button:** Start your family's list. **Under it:** Free to start. No card. No commissions.
  Never moves money.

### The page arc (six scenes, one idea each)

1. **Hero:** the idea and the first step (above).
2. **The cost, calm:** "Most families have one person who just remembers." Two or three ordinary
   examples, no disaster. Then: "That is fine, until that person is away, busy or unwell."
3. **Marcia's Tuesday:** the six-beat story, kept as it is (one cast, per #444).
4. **Three ordinary moments:** the nomination, the nursery number, the renewal (#449). These are the
   proof section.
5. **How it works:** three steps, one evening: add one thing, send the invite, they confirm.
6. **Why trust it:** the promises as a headline row, then the detail. Close on "Start your family's
   list".

### The invite page (new, for the second adult)

The person who gets the invite is the real second user, and today nothing speaks to them.
- **Subject line:** "<Name> started a list for your family and wants you to look at it."
- **Page:** "Here is what is on it. Take two minutes to look. You can confirm you have seen it, or
  say it needs changing." Then the three promises again.
- **No pressure copy.** No "or else". An adult can be excused, and the page says so.

### Proof, honestly (no invented testimonials)

- Say what it is: a made-up family, labelled.
- Say how it was tested: "Tested against 40 made-up UK households" only once a human has checked
  the claim and the lodger limit is fixed (the guide already says never publish a "136 of 137").
- Say what it does not do: the "Six things Keel does not do" section is a strength. Move it up.

## 4. Go-to-market plan (first 90 days, small and honest)

**Who first.** Two-adult UK households with a child under 10, a mortgage, and work-provided life
cover. The wedge is the moment: new baby, nursery or school start, mortgage fix ending, house move.

**Activation metric.** Both adults have looked within 7 days of the first item. Everything else is
secondary. Measure with the existing `growth-events` allow-list; do not add personal data to events.

**Channels, in order**
1. **The invite loop.** Make the invite page and email excellent. This is the cheapest growth.
2. **Moment content, not generic finance.** Replace generic explainers with the moments: "Who to
   call if your partner can't answer", "What to have ready before the nursery starts", "A mortgage
   fix is ending: what is on your list". Information only, per the advice rule.
3. **Community, not ads.** Antenatal groups, parent forums, school PTAs, local Facebook groups,
   relevant charities. Be useful, label it as ours.
4. **Employer benefits and HR newsletters.** Later, free for the first adult, no commissions kept.
5. **Paid, only after human review.** Advertising standards and the safeguarding red-team apply.

**What not to do:** affiliate or lead-gen deals (breaks "no commissions"), fear-led creative, or
"is your family covered?" quizzes (that is advice by implication).

## 5. Decisions this review needs from the owner

1. Approve the job line "if one of us can't answer, the other shouldn't start from nothing" as the
   internal positioning, and the sub line in the hero.
2. Lead the page with the ordinary cost, and keep the crisis opener for SOS only?
3. Build the invite page for the second adult (not built; new route and email copy).
4. Replace the generic blog and guides with moment-based content?
5. Founder story: yes or no, and who approves it.
6. Keel vs LifeKeel, and Keel Plus (still open).

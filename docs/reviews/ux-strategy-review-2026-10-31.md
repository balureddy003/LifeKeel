# LifeKeel UX and value-proposition review, 31 Oct 2026

Method: I walked the product myself at phone width on `main` (signup, first brief, home, map, employer
cover, claim packet, family, partner invite and join, share link, life events, Emergency Mode, financial
profile), once on seeded data and once, read-only, on the owner's own account. Screens: `ux-flows-2026-10-31/`.
Everything below is tied to something I saw. Where I am inferring, I say so. I did not run user tests, so the
behavioural claims are hypotheses to test, not findings.

Rules this review keeps: copy describes what is on file and never says what to buy, switch or name (CLAUDE.md rule 2);
nothing here moves money or acts for the family (rule 1).

---

## 1. Onboarding and input friction

**What I measured.** First brief, solo, on the current build: 3 signup fields, 4 money fields plus a date (one
of them now prefilled), about 6 taps from the landing card to the first number. The API answers in a few
milliseconds. So the wall of effort is not in the form. It is in what surrounds it.

Where a user hits a wall before value, in the order they meet it:

1. **Signup before any number.** The landing page promises "one problem, one evening, one number", then asks for an
   account. The brief preview already works without a connection or upload; the account is the only gate left.
2. **The intro carousel** (`/welcome`, 5 slides) and, until this week, a family-setup quiz between signup and the
   brief. The quiz is now skipped on the brief path.
3. **Home after signup** offered upload, profile and connect, all high-effort. A first-answer step is now at the top.
4. **The financial profile** is five steps. It is the right depth for the score, and the wrong first ask.
5. **Home itself** stacks about seven sections (setup card, greeting, score, confidence question, checklist, partner
   card, family, health, timeline, memory, life events, tip). No one of them is the next move.

**Progressive disclosure: an aha inside 60 seconds.** Order the asks by how little they cost and how much they show:

| Beat | Ask | What the user gets back | Today |
|---|---|---|---|
| 0 s | Pick the worry (one tap) | The form opens on that worry | Done (#353) |
| 15 s | Income, spending, savings, one date | "Savings last until June 2027" and a line chart | Done, behind signup |
| 45 s | (nothing) | One sentence on what moves it most | Missing |
| later | Cover, debts, wills, roster | A sharper answer, each with a visible "this changed your answer" | Scattered |

The single biggest strategic change is **showing the first number before the account** and asking for the account
to *save* it (strategic redesign, section 4). The API's preview path means the engineering is small; the cost is a
decision about abuse limits and about what an anonymous result may say.

**Upload-to-value loop.** I did not test ingestion end to end, so I will not grade it. What I can say from the
product: upload sits third in the home checklist behind a generic "Upload a document" row. A single drop zone that
says what happens next ("We'll read the provider, policy number and renewal date. You confirm each one.") and shows
the three extracted fields beside the document within seconds would turn it from a chore into the product's best
demonstration. The checklist should offer exactly one document type first (the annual insurance summary), not
"insurance policy, will, or bank statement".

---

## 2. Output clarity and meaning-making

**Metric translation.** "5.1 months of savings after the change" is the right number and a half-finished
sentence. Three gaps:

- It has no anchor. 5.1 months of what? Say it in the user's own terms: "Your spending is £2,500 a month, so £9,000
  lasts until about June 2027." The date is already computed; make it the headline and the months the support.
- It risks anxiety without a path. The page then offers "Try a what-if", which is a tool, not a next move. The
  what-if should open pre-set on the lever that changes the date most (the engine knows which), phrased as a
  question the user can answer, not a recommendation.
- Life cover totals ("£180,000 on file") are inert. Pair each with the thing it can be set against that the user
  already told us (their spending, their mortgage) as a fact, not a verdict: "£180,000 on file. Your mortgage on
  file is £200,000." The reader draws the conclusion, which is also the compliant version.

**Actionable synthesis.** "What Keel noticed" currently lists findings (a stopped payment, no retirement savings, an
ex-partner nomination, and so on) as peers, each with five feedback chips (Useful, Not relevant, Handled, Later,
Wrong data). On the seeded account that was eight things, all the same size. The user cannot tell the ex-partner
nomination (rare, high stakes, quick to check) from "no retirement savings" (common, slow, generic).

**Avoiding the dashboard trap.** Today the home page is a dashboard: sections competing for attention, a score of 19
with the reason behind a "Why this score?" fold, and on a real account a headline of 85 with two of four areas
showing a dash. A score built on missing data reads as false precision. Replace the dashboard with one question the
page answers each visit: **"What is the most important thing to check today?"**, chosen by a visible, boring rule:

1. anything with a date inside 14 days (renewal, due obligation), then
2. a stopped payment or a nomination mismatch (low effort, high stakes), then
3. the missing fact that would sharpen the biggest number.

One card, one action, a "why this one" line, and the rest of the findings below it, collapsed. The other six home
sections move behind it. This is a prioritisation rule, not a recommendation engine, so it stays on the information
side of the advice line.

---

## 3. Emergency Mode and trust

**Stress-state usability.** The entry is good. The first screen is sparse: a danger line ("If anyone is in immediate
danger, call 112 or 911") above "What happened?" and large, single-line rows. That is the right shape.

What breaks the promise:

- After one tap the user leaves Emergency Mode and lands on the ordinary "Report a life event" page: the full header,
  the SOS and assistant buttons, a "Who does this affect? (optional)" select, a free-text box, a "Get my plan"
  button, an explanation paragraph and the legal footer. That is five decisions and four distractions for someone who
  may be standing in a hospital corridor.
- The select had no accessible name until this week (fixed).
- Emergency Mode lists five paths (bereavement, medical emergency, car accident, home damage, travel), read from
  `EmergencyMode.tsx`. The landing page promises "seven kinds of bad day". Job loss and disability, the two most common
  ones, are only on the ordinary life-events page. That is a defensible call (they are not minutes-matter events), but
  the page should say "seven" only where seven are offered, or Emergency Mode should say where the others live.
- The plan arrives as a checklist with a "Get Keel's help with this" button on every row, which is five equal buttons.

Recommendation: in Emergency Mode, **skip the form entirely.** One tap must produce the first three steps, with who
it affects and notes offered *after* ("Add detail" at the end, not before). Keep the chrome off. Keep one phone number
(the claims contact on file, if there is one) as the biggest button on the screen.

**Trust architecture.** What works: the landing trust strip (no commissions, never moves money, details never sold),
"Keel never sends it" next to the draft, and the organiser approval step for a joining adult ("They cannot see
anything until you approve"). What is missing at the moment of data entry:

- The sensitive asks (savings, nomination, health) carry no local reassurance. Put one line under each: where it is
  kept, who in the household can see it, and that it can be deleted from Settings.
- "Sample" cards on a real account were quietly corrosive: they looked like findings about the person. Hidden now.
- The join page cannot say whose family you are joining. A short code should not be enough to learn a family name,
  so the sender's name should ride in the link (`/invite/<code>?from=Jo`), which is shown to a person who already
  holds the link.

---

## 4. Prioritised recommendations

### High impact, low effort (do first)

| # | Change | Why | Effort |
|---|---|---|---|
| 1 | Lead the brief result with the date, then the months | Meaning before magnitude | Copy and layout |
| 2 | Emergency Mode: one tap to steps, details after | Stress-state ergonomics | Small |
| 3 | Home: one "check this today" card above everything, rest collapsed | Ends the dashboard trap | Medium |
| 4 | Remove the confidence question from the top of home; ask it after the first brief | It asks for an opinion before giving anything | Trivial |
| 5 | Hide the overall score when any pillar is blank | False precision on a real account | Small |
| 6 | One-line privacy note under each sensitive field | Trust at the point of risk | Copy |
| 7 | Sender name in the invite link | Removes the "who is this" pause | Small |
| 8 | Make the what-if open on the lever that moves the date most | Turns a tool into a next move | Small to medium |

### Strategic redesigns

| # | Change | Why | Risk to manage |
|---|---|---|---|
| A | Show the first number before signup; ask for an account to save it | Aha before commitment | Abuse limits; what an anonymous result may say |
| B | One-document onboarding (drop the annual insurance summary, confirm three fields) | Best demonstration of the product | Extraction accuracy; confirm-each-field is the safety |
| C | Ranked "today" engine with a visible rule | The antidote to the dashboard | Must stay a prioritisation rule, not advice |
| D | A "handover" mode: Emergency Mode opened by a trusted person | The product's emotional core | Blocked on the PRD-229 safeguarding review |

I would not do anything under D before the review, and I would not describe it on the landing page until it exists.

---

## 5. Copy rewrites (informational, no recommendations)

**Landing headline.** Now: "Your family's money, cover and papers. One bright place."
Try: **"If one of you stopped earning tomorrow, how long could your household cope?"**
Support: "Answer with three numbers. See the month your savings would run out. Nothing to connect, nothing to upload."
Button: **"Show me my number"** (below it, small: "Free. About a minute.")

**Signup header, shown after the first number.** Now: "Create your account."
Try: **"Save your answer."** Support: "So you can come back to it, update it, or share it with someone you trust."

**Brief result.** Now: "5.1 months of savings after the change. Savings would run out around June 2027."
Try: **"Your savings would last until about June 2027."**
Support: "That is £9,000 against £2,500 a month, once the pay stops on 15 Jan 2027. These are your own figures; nothing
else is counted."

**Home, first card.** Now: "Good evening, Alex. A few things need attention. Your score has the details."
Try: **"One thing worth checking today."** Then the thing, one line on why it is first, and one button.
Example for a stopped payment: "No payment on file for your life policy since 23 Jul 2026. Check with your provider
that cover is in force."

**Emergency Mode entry.** Now: "What happened? Tap one and I'll guide you through it."
Try: **"We'll take this one step at a time."** Support: "Tap what happened. You can add details later."

**Join page.** Now: "Join your family on Keel."
Try: **"Jo invited you to see your family's plan."** Support: "Jo has to approve you first. Until then you won't see
anything."

**Empty state, claim packet.** Now: "No life policies on file."
Try: **"Add a life policy and your claim checklist will be ready here."**

---

## What I did not test

Document upload and extraction, Safari, a real screen reader, the other seven briefs, and any of this with real
users. Every behavioural claim above (drop-off, anxiety, comprehension) is a hypothesis. The cheapest way to test the
two biggest ones is a five-person walkthrough of the landing-to-first-number path with and without the account gate.

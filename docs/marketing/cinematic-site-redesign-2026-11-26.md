# LifeKeel — public site, cinematic rewrite

**Date:** 2026-11-26 (revised; visual system and brand spec added)
**Status:** Proposal for the owner. Extends
[`docs/research/brand-and-story-guide-2026-11-08.md`](../research/brand-and-story-guide-2026-11-08.md);
does not contradict it. Anything in the brand guide that disagrees with
this brief wins.

> **Amended 2026-11-27 (owner).** Families and small businesses are two
> separate verticals, at `family.lifekeel.com` and `business.lifekeel.com`.
> The second audience is a **small business owner**, never "a small team",
> co-founders, staff or payroll. Wherever this brief says "team", read
> "small business", and treat it as that vertical's own story, not the
> family story with the nouns swapped.
>
> `business.lifekeel.com` is not open for sign-ups yet, and the public site
> shows only what is available today (`NoRoadmap.test.tsx`). So the business
> door is built but hidden behind `NEXT_PUBLIC_BUSINESS_DOOR`
> (`apps/web/src/components/landing/verticals.ts`). Turn it on only when that
> vertical is live and its features are `live` rows in `claims.ts`. Until then
> the home page and `/pricing` tell and price the family story only.

## 0. What this brief is, and what it isn't

This brief repositions the public site as **a cinematic page** that
reads as one quiet story rather than a brochure. It does four things:

1. Sets a **single narrative spine** — the human arc from private
   memory to a shared, confirmed list — that holds for both households
   and small teams, so the brand is not split into two products.
2. Rewrites the **hero and first three scrolls** in concrete copy a
   designer can paste into `LandingHero.tsx`, `FamilyStory.tsx` (or a
   replacement) and a section that introduces the list itself.
3. Sets **craft rules** for the rest of the page (sample-list props,
   "who has looked," continuity mode, visual, motion) so future
   sections feel like the same film.
4. Adds a **visual system and brand spec** (palette hex, type scale,
   logo rules, imagery manifesto, motion checklist) so the marketing
   site looks as disciplined as it reads.

**Fidelity rule (non-negotiable).** Every prop shown on the marketing
site — the sample list, the "who has looked" state, the Continuity
Mode steps — **must be implementable with the current product
language and behaviour.** No aspirational UI. Every claim on the page
maps to a `live` row in `apps/web/src/components/landing/claims.ts` or
is a brand-voice line drawn from
`docs/research/brand-and-story-guide-2026-11-08.md`. Anything that
isn't in those sources is not allowed on the page until it ships.

This brief does not implement the design. It does not extend the API
or claims registry to cover a team vertical. The team-thread is
**roadmap, not shipped** — see §7 and §9.

**Audience responsibilities.** The brand guide's voice rules
(calm, plain, "no wit and no brand name in a bad week"; small stakes;
no melodrama; never "always watching"; no hospital/siren imagery)
are unchanged and apply to every line below.

## 1. Two structural truths that hold the design together

These are non-negotiable. Every visual, headline and section has to
honour both.

- **The list is the quiet hero.** The page is not about a product, a
  dashboard, a score or an AI. It is about a plain list, with names
  ticked beside it, that more than one person can see.
- **The audience is unified by one human problem.** "Everything
  important lives in one head" is true of a parent and of a small
  business owner. We do not address two audiences; we show one
  problem from two camera angles.

If a section can't be told with both camera angles, it is the wrong
section.

## 2. The narrative spine (one film, two cameras)

Seven scrolls. Each scroll = one shot or one scene in the film.
Approximate scroll depth on a phone is given in brackets; on desktop
a scroll is up to two screens of generous whitespace.

| # | Shot | Beat | Cinematic intent |
|---|---|---|---|
| 0 | Hero — opening shot | Set the world | Three calm lines. Singular primary CTA. Sample list as prop. |
| 1 | The ordinary cost | Act 1: same quiet cost in two cameras | Kitchen drawer / founder's desk. |
| 2 | The list as character | The saving grace | Real names, real ticks. *"Asked to confirm,"* never *"has seen it."* |
| 3 | A difficult ordinary day | Quiet resolution | Numbered *next three things*. Family + team, identical shape. |
| 4 | Through the year | Vignettes | The list being useful on an ordinary week. |
| 5 | It belongs to everyone | Trust act | What Keel doesn't do. Consent + pricing. |
| 6 | Begin | Closing breath | Two open invitations. A last line, not a button. |

The contents of scrolls 0–3 are written below. Scrolls 4–6 are sketched
for direction; full copy is a fast-follow once the owner signs off on
this brief.

**Shot rules.**

- Never show a screen that watches a person (no live-update ticks on
  a person, no "Sara viewed 3 minutes ago"). Ticks belong to the list,
  not to people.
- Never use Apollo 13, Thai Life or John Lewis montage references.
  Show restraint, not costume.
- The list prop is always present when the page is talking about the
  list. It is the actor; the text is the description.
- Calm scales, paper-stock textures, monospace or near-monospace
  labels for the list itself. Big serif for headlines.
- No pictograms of families or teams. The list is the image.

## 3. Information architecture

The site is one page, plus quiet supporting pages. No "for families /
for teams" toggle in the nav.

```
Public site (one page, seven scrolls above)
├── /trust                  What Keel does not do, in plain language.
├── /pricing                Family free. Team plans, clearly priced.
├── /stories                One FAQ-shaped page; one chapter per fold.
├── /sign-in                Quiet way back; same chrome as the page.
└── /sign-up                Households: free. Teams: a single short form.
```

**Why no /for-households + /for-teams.** The brand guide is clear:
splitting the brand reads as two products. Two landing pages dilute
the single human truth and lose the cinematic arc. Teams learn
everything they need from the same page; a single line on /pricing is
the only place the word "team" appears explicitly.

**Pricing chrome.** Family side: "free". Team side: a single number
per month, an explicit "no commissions" line, the cancellation
language the team already has in `apps/api/src/billing/billing-constants.ts`.
Don't invent new pricing tiers in marketing copy. Quote what the
constants file says and what `claims.ts` `free-plan` and `plus-price`
let you say.

## 4. The deliverable — the complete short film

The full copy the designer can paste. **Seven scrolls** in the order
of the spine in §2: hero (opening shot), the ordinary cost (Act 1),
the list as character (introducing the saving grace), a difficult
ordinary day (Continuity Mode as quiet resolution), through the year
(vignettes), it belongs to everyone (the trust act), and begin (the
closing breath). The first three are the spine of the film; the next
three restate the truth at a slower pace; the last is the breath.

Throughout, "eyebrow" / "hero" / "support" / "body" / "microcopy" /
"caption" / prop-name labels are typography hints for the designer,
not part of the visible copy. `…` indicates an intentional line break
inside the same paragraph; a blank line indicates a new paragraph.

---

### Scroll 0 — Hero (opening shot)

The hero is **three calm lines** that together state the problem and
the quiet promise in one breath. No eyebrow, no body paragraph, no
list of features. The whole upper third of the page reads as a single
quiet thought.

> **Line 1, display, very large, calm:**
> The important things usually live in one head.
>
> **Line 2, body weight, slightly lower:**
> One list. The people who need to know can see it.
>
> **Line 3, italic serif or display variant, slightly smaller, set
> apart with generous space:**
> Know where to look.
>
> **Single primary CTA:**
> Start a free list →
>
> **Secondary path for teams — text link, not a second button (set
> below or beside primary as type only):**
> For a small team — see plans →
>
> **Microcopy directly under the CTAs (single line):**
> Free for a household. Honest plans for a team. Information only —
> never moves money, never gives advice.
>
> **Sample list (right column on desktop, full-width below on mobile):**
> A still, paper-textured. Quiet, hand-set rules. Almost no chrome.
> Real names, real ticks. **Must look like a prop that has been
> handled** (slight paper texture, a hairline dog-ear, no polish), never
> like a UI component. Items as the user actually sees them in
> `SeenByCard.tsx`. Treat it as the actor; the page text is the
> description.
>
> ‐  Car insurance — renewal 14 March          ✓ Mara  ✓ Tom
> ‐  School pickup — emergency contact on file ✓ Mara  ✓ Tom
> ‐  Life policy — held by the underwriter     ✓ Mara  ✓ Tom
> ‐  Will — upstairs desk drawer               ✓ Mara  ○ Tom
>
> *Changed 9 days ago — looked again:  ✓ Mara  ✓ Tom*
>
> **Margin caption under the sample list (eyebrow-style):**
> An example list of one family. Yours begins empty and stays yours.

The reader understands in two seconds: this is a list, more than one
person has looked at it, and the page invites them to start one — for
a household or for a team — without ever naming a feature.

**Singular primary CTA, by design.** Two parallel CTAs of equal
weight split the reader's attention on a phone, where this page is
most often read. The hero carries one calm invitation. The team path
sits as a quiet text link — never a second button — so the page does
not feel like two products. The team list is described, not teased,
in `/pricing` (§3).

**Cut from this scroll.** The current hero has a savings-runway
simulator, "Life gets busy. Stay one step ready." in display, and a
strip reading "Less searching. More living." These all move out of the
hero (and the runway simulator moves out of the page entirely; the
team has already decided runway belongs in the in-app dashboard, not
the marketing site). Do not repurpose them as a separate scroll — the
cinematic arc replaces them.

---

### Scroll 1 — The ordinary cost (Act 1)

> **Headline (display serif):**
> The ordinary cost of holding it alone.
>
> **Body, two paragraphs:**
> Most households and small teams already have everything they need
> to keep going. The policies are filed. The contacts exist. The
> renewals have dates.
>
> What's missing is not information. It's **who else knows it's
> there**.

Two scenes side by side on desktop, stacked on mobile. Each is a
short, slow moment. They share the same beat: a person who carries
it, and the person who has to ask them.

> **Scene A — a household**
>
> *Setting (a single line of body, italic small caps):*
> A kitchen. A drawer. A partner on the phone.
>
> *Narrative beat (two short lines):*
> One adult has always been the one they ask. The other adult has
> always had to ask back.
>
> *The texture:* It sounds like small talk. It feels like being a
> passenger, not a partner.

> **Scene B — a small team**
>
> *Setting:*
> A founder's laptop. A signed document on a password-protected drive.
> A client renewal next Tuesday.
>
> *Beat:*
> When the founder is away, the business doesn't know whose inbox
> holds the renewal, where the originals live, who to call.
>
> *The texture:* The co-founder has to ask the founder. Often, the
> founder isn't the one to answer.

> **Closing line of the scroll, centred, calm:**
> Same problem. Different unit.

This scroll is the inciting incident. The cost is emotional and
small — leaving the partner or the co-founder as a passenger. Not a
funeral. Not a missed deadline. Just *being the one who has to ask*,
every week, until it isn't.

**For the writer.** Both scenes must end on the **same quiet cost**:
time lost, an assumption broken, or a moment of not knowing who
holds the answer. Specificity over abstraction — name the object in
the drawer, name the inbox the founder keeps, name the contact the
co-founder has to ask about. The two scenes are written so a reader
will finish one, glance at the other, and **recognise themselves in
the second one rather than the first.** Do not name an industry. Do
not name a product. Do not name an emotion harder than "it feels like
being a passenger." The two-camera consistency the visual system
requires (§6.5) follows from this — the kitchen-drawer scene and the
founder's-desk scene must read as the same *kind* of shot.

---

### Scroll 2 — The list as character (introducing the saving grace)

> **Headline (display serif):**
> The list is the quiet hero.
>
> **Body, three short lines:**
> It doesn't move money. It doesn't pick a product. It doesn't give
> advice.
>
> It holds what's already on file and gives every adult the same
> thing to look at.
>
> **Lead-in to the prop (a single line, italic):**
> They look. They confirm. The next time something needs to be found,
> they already know where to look.

This is the climax of the cinematic arc. The visual prop is the
actual list, populated with one fictitious family, ticking real
names. It is **not** a dashboard. It is **not** a "score." It is a
piece of paper, an itemised list, with names beside ticks.

> **Real prop — a sample list view ("who has looked" mechanic shown
> in plain language):**
>
> **The Ellis family** · *Illustrative*
>
> Items
> ‐  Car insurance — renewal in 35 days           ✓ Mara  ✓ Tom
> ‐  School emergency contact                    ✓ Mara  ✓ Tom
> ‐  Will — kept upstairs                        ✓ Mara  ○ Tom
> ‐  Tenant deposit — refunded 18 April          ✓ Mara  ✓ Tom
> ‐  Household bills — direct debits             ✓ Mara  ✓ Tom
>
> A small **"seen last on"** line at the foot, body-text small:
> *Mara last looked 9 days ago. Tom last looked 21 days ago.*
>
> A caption directly under the list (smaller still, body text):
> *The list never lies. "I've seen this" means the adult said so.
> A change asks everyone to look again.*

**The honest line.** Brand guide rule: never claim "every adult has
seen it." The honest phrasing is *asked to confirm*. Use it. This
is the section that earns trust by being precise.

---

### Scroll 3 — A difficult ordinary day (the rising action / quiet climax)

**Title — deliberately not "a crisis".** The brand guide forbids
hospitals, sirens and emergency imagery. Continuity Mode reads best
when the **difficulty is ordinary**: a Tuesday that doesn't go to
plan. The page calls this scroll *A difficult ordinary day*, never
*A crisis*. On a phone, the title stays cool; visually it does not
trigger the user to look for a red button.

**Sister section to:** *Family on a difficult ordinary day* and *A
team on a difficult ordinary day*. Two parallel panels, identical
shape, identical feel.

> **Headline (display, calm):**
> A difficult ordinary day.
>
> **Body, two paragraphs:**
> A car fails the MOT the morning of a school run. A renewal date
> arrives the day the founder is in court. A partner is travelling.
>
> The list has the next three things on it. Nothing else.

This is the first place **Continuity Mode** appears on the page. It is
*not* introduced as a feature. It is introduced as the natural
behaviour of the list on a hard day. The product behaviour is in
`apps/web/src/components/CrisisMode.tsx`: render only the top three
pending playbook steps, the emergency fund figure, and a path back to
the list. The page uses the same restraint. Continuity Mode is shown
**twice** — once for a family panel, once for a team panel — at the
same width, in the same typeface, with the same number of lines. The
shape is the selling point; it proves the same product works for
both.

> **Two parallel panels, each shaped identically:**
>
> **Family panel — *A difficult morning*:**
> ‐  School run — bus passes are in the kitchen drawer. *(next)*
> ‐  MOT — call the garage on the policy card. *(next)*
> ‐  Insurer — the number is on the policy in the file. *(next)*
>
> *Open the family's plan →*
>
> **Team panel — *A difficult morning*:**
> ‐  Renewal — client contact on the file; reply by 11. *(next)*
> ‐  Court bundle — key document in shared list. *(next)*
> ‐  Customer message — draft is ready in Inbox. *(next)*
>
> *Open the team's plan →*

> **Closing line of the scroll, single, calm:**
> Keel Plus does not become your insurer or your solicitor on a
> difficult day. It is the place the family or the team already
> knows to look.

**Don't.** No sirens. No red. No hospital. No meltdown. No button
labelled *"Activate"*. The brand guide rule stands. The difficulty
shown here is **ordinary** — a car, a renewal, a school — and the
resolving motion is that everyone already knows where to look. The
panel's visual restraint is what conveys "calm under pressure"; the
content does it.

### Scroll 4 — Through the year (vignettes)

The pacing of the film relaxes here. After the climax of *a difficult
ordinary day*, the page moves into three small observed moments — one
from a household, two from a small team — that show the list doing
what it does on an ordinary week. No heroics. No drama. The point of
this scroll is to say, quietly, **this is the same product all year
round**, not only on a hard day.

> **Headline (display, calm):**
> Through the year.

> **Body, observed, unmanipulated (three small vignettes, each set as
> a short paragraph):**
>
> *A renewal in February.*
> The car insurance email arrives. It goes onto the list. The partner
> looks; they have seen it. The renewal happens on schedule, while the
> four-year-old is unwell and the founder is travelling and the kitchen
> is, briefly, only a kitchen.
>
> *A trip deposit in spring.*
> The deposit reference lands between two other emails. It goes onto
> the list. Two names tick it. Six months later, it is the answer to a
> question that did not have to be asked out loud.
>
> *A staff change in autumn.*
> A co-founder leaves. The list does not. The new co-founder looks at
> the same list, ticks what they need, and the question — *whose
> inbox holds the renewal, where is the signed copy?* — stops being a
> question.

> **Closing line, single, calm, set as a quiet one-sentence pull:**
> The list is rarely the right answer to a hard day. It is more often
> the right answer to a Tuesday.

Each vignette is rendered with **the same prop grammar** as the hero
sample list: paper texture, real names, ticks as ink. The vignettes
do not get dashboards, charts, or green-arrow "growth" indicators.
The animations are limited to a single tick drawing on for the item
that "lands" in the vignette's scene — the prop settles in, the
relevant tick appears, the reader moves on.

**Don't** introduce a fourth vignette to make the scroll longer; three
is the right number. **Don't** add percentages, paragraphs of
platform claims, or any "and you can do this too" CTA in this scroll.

### Scroll 5 — It belongs to everyone (the trust act)

The trust act is the audience's *last chance to lose trust*. It has to
be the simplest, most literal section on the page. It is **a list of
plain-language promises**, each anchored by a `live` row in
`apps/web/src/components/landing/claims.ts`. No copy here is invented;
every line is checked against the registry.

> **Headline (display, calm):**
> It belongs to everyone.

> **Body, the brand's promises in plain words, each on its own line
> with a short italic gloss beneath it:**
>
> *Subscriptions only.* No commissions, no ads, no payouts to Keel
> when you act on a Keel insight.
> *(claim: `no-commissions`, `live`.)*

> *Never moves money.* A draft message is drafted, not sent. A claim
> packet is prepared, not filed.
> *(claim: `no-money-moved`, `live`; mirrors `apps/api/src/__tests__/trust-tier-gate.test.ts`.)*

> *Never gives advice.* Keel names no insurer, ranks no policy and
> never tells you to switch. The list holds what is on file. The
> advice comes from a licensed professional, when you want one.
> *(claim: `no-policy-picks`, `live`; mirrors `packages/engine/src/__tests__/advice-rule.test.ts`.)*

> *Details not sold.* What your family puts in stays in your account.
> It does not go to advertising networks or to anyone off the team.
> *(claim: `no-selling`, `live`; mirrors `apps/web/src/app/privacy/page.tsx`.)*

> *Nothing acts for you without you turning it on.* A drafted message
> is yours to send. A planned action is yours to approve.
> *(claim: `approval-first`, `live`; mirrors `apps/api/src/__tests__/trust-tier-gate.test.ts`.)*

> *Any adult can leave.* A person removed is cut off at once. You can
> export your data and delete your account from Settings.
> *(claims: `leave-and-removal`, `export-data`, `delete-account`; all `live`.)*

> *Encrypted before it reaches our servers.* Connector passwords and
> access tokens are encrypted before they are stored.
> *(claim: `encrypted-at-rest`, `live`; mirrors `packages/platform/src/crypto.ts`.)*

> **Quiet footnote (smaller body, italic):**
> Information-only. Never underwriting. Never advice.

What is **not** in this scroll — and why:

- **"Family data is never used for training"** is policy-or-procedural,
  not a code-enforced claim. It is forbidden on the landing page
  (`claims.ts` `no-training`, `blocked`). The trust act does not say
  *"we never train on your data"* — the trust act says what the product
  can do, which is what the registry proves.
- **"Always watching / 24/7 / always on"** is forbidden (claims.ts
  `always-on`, `blocked`). The trust act does not claim continuous
  monitoring; it claims reliable confirmation, which is what the
  product does.
- **A trust-score, a security badge programme, or "trusted by 10,000
  families" claims** are not present because none are present in the
  registry. The act must not over-claim.

### Scroll 6 — Begin (closing breath)

The closing of a calm film is not a big button. It is one breath.

> **Headline (display, calm):**
> Begin.

> **Body, two short lines, the three-line hero's promise made quietly
> into one sentence:**
> One list. The people who need to know. Confirmations, not
> notifications.

> **Closing line (single, body, centred):**
> Free for a household. Honest plans for a team. Information only.

> **Two invitations at the bottom of the scroll, in the same
> restraint as the hero (primary calm, secondary as a quiet text
> link):**
>
> Start your free list →   *(primary, calm)*
>
> For a small team — see plans →   *(text link, quiet)*

The reader has now gone from *"The important things usually live in
one head"* at the top of the page to **Begin.** at the foot. The
story ends because a quiet action has been offered, not because a
button has been shouted at. The CTA's weight throughout the page
must be consistent — never larger than the actual proposition.

The secondary path ("for a small team — see plans") does **not** push
the reader to the team product. It points at `/pricing`, where the
team thread is described on its own terms. The closing can hold the
same restraint the hero holds; nothing more is needed.

## 5. The sample list, "who has looked" and Continuity Mode as story props

Each is both a UI element and a piece of the narrative. Below: how
it should look and how it should behave so it reads as cinema, not
SaaS.

### 5.1 The sample list

The list is the visual *hero* of the page wherever it appears. It is
a single still object — like a piece of paper pinned in soft morning
light — not an interactive widget.

- **Treatment.** Paper texture (a hand-drawn cross-hatch behind a
  card; never a glow), narrow monospace or near-monospace labels for
  the list items, hand-drawn-style ticks beside each item. No shadows
  larger than the page's own depth. No 3D, no parallax.
- **Item labels.** Two short parts: what the thing *is* (e.g. *Car
  insurance*), then a plain-language annotation after an em dash (e.g.
  *— renewal 14 March*). Items are items; they are not "fields"
  or "properties."
- **Honesty.** A small caption marks the list as illustrative. *An
  example list of one family. Yours begins empty and stays yours.*
  This caption appears on every instance of the sample list, not just
  the hero one. It is the only piece of microcopy that persists.
- **Behaviour.** The prop is fully inert. No hover. No tab-to-focus.
  No drag. No copy button. The list is showing, not doing.

### 5.2 "Who has looked"

This is the most distinctive product mechanic on the page. It must
visually look like *names, ticked*, not like *a notification feed*.

- **Treatment.** Each item row has the same shape as the sample list
  row, with two or three names set in plain text on the right. A tick
  is a small mono glyph beside a name (`✓`). An un-ticked name uses
  an unfilled circle (`○`). No avatars, no avatars' first letters
  in coloured discs, no relative-time stamps beside a person's tick.
- **Relative time.** A small footer under the list, in body text,
  reads "Mara last looked 9 days ago. Tom last looked 21 days ago."
  — sentence case, plain. Relative time belongs to *the list*, not
  to the person.
- **The honest line.** Always paired with the prop, the small line
  *"The list never lies. 'I've seen this' means the adult said so."*
  This is the trust-act's seed. It earns the right to be repeated in
  §scroll 5 / /trust.

**Implementation cues.**

- The prop maps to the same data shape the dashboard's
  `SeenByCard.tsx` already returns — list `domains.view.confirmation`.
  The marketing page never re-renders that card; it uses the same
  contract that `getDomainView()` returns, so any visual change here
  is mirrored in-app.
- Front-end behaviour for the marketing site: visual replication,
  not interactive. Confirmation happens in the signed-in app.

### 5.3 Continuity Mode (the *next three things*)

Introduced in §scroll 3 as the natural behaviour of the list on a hard
day, not as a feature.

- **Treatment.** Numbered list, plain serif numerals, no chrome. Three
  items, never four, with the third always being the phone number
  from a paper on file (the brand's "Who to call from your policy
  papers" — `claims.ts` `who-to-call`, `live`).
- **The footer line.** A small italic line: *Calendar of who to call
  and what to read first, drawn from what's already on file. Nothing
  moves money, nothing is decided for you.*
- **CTA.** A single, plain link: *Open the family's plan →* or
  *Open the team's plan →*. No "Activate Continuity" button, no
  red. Calm.
- **Behaviour.** Numbered, not bullet. The first item is the
  emotional one (*School run — bus passes are in the kitchen drawer*).
  The third is the practical one (*Insurer — the number is on the
  policy in the file*). This is the brand's `bad-day-steps`
  (`claims.ts` `live`, `apps/api/src/life-events/render-playbook.ts`),
  shown in plain words.

## 6. Visual system and brand spec

The marketing site should look and feel like **a quiet, well-made
short film about ordinary continuity.** The brand is paper, type and
specific objects rather than illustrations or lifestyle photography.
The voice extends visually — **specificity over abstraction**, **object
before person**, **paper before dashboard.**

This section locks the building blocks: typography, palette, layout,
motion, imagery, photography, and the logo. Every line below is
implementable with assets the team already has access to or that are
specified here. None of it requires stock-photo licensing for
generic smiling families or teams.

### 6.1 Type

Direction from the panel — *"the film-title voice"* — accepted. The
display face renders the three calm lines in the hero and the seven
`Headline` lines in §4. The choice between an **arithmetic sans**
(recommended brand direction: large, confident, highly readable) and
the **calm display serif** the codebase currently loads (Instrument
Serif, `--font-display`, 400) is an **owner call** recorded in §9.

**Type scale.** Mobile first; desktop is set generously above it.

| Role | Mobile size / line-height | Desktop size / line-height | Note |
|---|---|---|---|
| Display (hero line 1) | 40 / 48 | 64 / 72 | One line on phone, may break to two on desktop at the narrowest viewport. |
| Display (hero lines 2–3, scroll titles) | 28 / 36 | 40 / 48 | Quiet hierarchy below line 1. |
| Body | 17 / 26 | 18 / 30 | Measure: 36–42 characters on phone, 58–66 on desktop. |
| Body-small | 14 / 22 | 15 / 24 | The "kicker" line under the hero. |
| Mono / prop labels | 14 / 22 | 14 / 22 | Dates, ticks, list-item labels. |
| Caption | 12 / 18 | 13 / 20 | The "yours begins empty and stays yours" line under the sample list. |

**Faces in use (current).**

- **Body.** Inter (loaded as `--font-sans`). Generous line-height as
  in the table. The workhorse.
- **Display (current).** Instrument Serif (loaded as
  `--font-display`, weight 400). Already used. **Considered but not
  locked** — §9 records the call.
- **Wordmark.** Fraunces 600 (loaded as `--font-wordmark`). Calm.
  Used in `/logo` files and the navigation lockup, never as
  display copy.
- **Mono.** IBM Plex Mono (loaded as `--font-mono`). Used for
  list-item labels, ticks, dates and the four micro lines beside
  the prop.

**Hierarchy rule.** One dominant line per scroll, then supporting
lines that never fight it. The hero's design contract: a phone reader
glances once and reads the three lines, in order, in two seconds.

### 6.2 Palette — *Paper-mode A locked*

The visual-system direction accepts **Palette A — gradual, marketing-only.**
The brand guide's direction (oat, linen, paper) leads; the current
site's blue/violet gradient stays in the in-app change and does not
appear on the marketing site.

**Paper-mode swatches (locked).**

| Token | Hex | Use |
|---|---|---|
| `--paper` | `#fdfcf9` | Page background. Warm off-white; not pure white, not cold grey. |
| `--linen`  | `#f5efe6` | Cards, sample-list interiors, paper prop. |
| `--rule`   | `#d8cfc1` | Hairline rules around and within the prop. |
| `--ink`    | `#17231f` | Primary text. Near-black, slightly warm. |
| `--ink-muted` | `#5e564c` | Body-small and secondary text. |
| `--ink-faint` | `#8a8276` | Captions, the *"An example list…"* line. |
| **Accent (default — owner call)** | `#2a4a3c` | Deep forest green. Used **only** for confirmation-tick completion, primary links, and one or two small interactive states. |
| Accent alt 1 | `#3d5862` | Slate blue. Quiet, cooler. |
| Accent alt 2 | `#3d3933` | Warm charcoal. Even quieter. |
| Tick ink     | `#17231f` | All ticks are ink-coloured, never accent. |

**Usage rules.**

- Backgrounds: `--paper` page, `--linen` for any prop or card that
  needs to read as paper. No dark-mode on the marketing site (the
  in-app dark mode is untouched).
- Text: `--ink` for everything that must be read; `--ink-muted` for
  supporting body-small; `--ink-faint` for the prop caption only.
- Accent: pick **one** from the three swatches — the owner call in
  §9 — and use it **sparingly**: ticks (only when indicating *new*
  confirmation), date highlights on the sample list (`renewal 14
  March`), and the primary link inside the body. **No accent in the
  logo lockup, no accent as a CTA background, no accent as a status
  badge.** The whole palette should feel closer to a well-lit desk
  than a SaaS dashboard.
- Forbidden: bright "fintech teal," high-saturation success greens,
  violet-tinted blue gradients (the current site is heavy on these
  and must lose them on the marketing-route pages). No shadows
  beyond a 1-pixel hairline and a soft, paper-fibre shadow on the
  prop.
- The accent applies to the **marketing site only**. The in-app
  palette (which the dashboard, the family vertical, and
  Continuity Mode components live in) is unchanged.

### 6.3 Layout

- **One column** at <= 720px (phone and tablet portrait). Two columns
  at >= 1024px (desktop). No three-column on marketing pages.
- **Whitespace.** Generous on desktop. Each scroll is allowed one
  screen of air around the prop. No scroll-jacking. No sticky media.
  (A sticky CTA at the bottom of the viewport is permitted — see
  `StickyCta.tsx`, already in the codebase.)
- **Margins.** 24–32px on mobile, 56–72px on desktop. The prop's inner
  padding is wider than other cards (32px+) so the paper feel reads.
- **Mobile-first verifiable.** Every scroll must be readable on a
  phone screen with no scroll-jacking and no horizontal scroll. The
  brand guide line applies: *"The story must work on a phone the way
  a good trailer works on a small screen."*
- **No slideshows, no carousels.** The site is a scroll. The prop is
  the only moving element on each scroll.

### 6.4 Motion — editorial principles

**Motion is editorial, not decorative.** It is permitted only when it
reveals state or advances the story. The page should feel like film
editing — deliberate cuts between scenes, not endless vertical
reading.

**Editorial checklist (allowed).**

- A confirmation tick appearing (`○` → `✓`). Stroke draws on over
  ~220ms.
- A list prop settling into view, **line by line**, ~80–120ms apart.
  Ticks draw on last.
- A quiet fade between the two camera angles (a kitchen drawer → a
  founder's desk) when scrolling between the two scenes. No slide.
- A single subtle paper-like settle on the page load — the prop drops
  onto the page like a piece of paper set down. No bounce, no spring.

**Editorial checklist (forbidden).**

- Parallax over the whole page.
- Bouncing cards.
- Auto-playing video with voiceover.
- Anything that reads as a product demo reel.
- Auto-playing audio on tick or confirmation.

**Implementation cues.**

- Reduced motion is already enforced app-wide via
  `<MotionConfig reducedMotion="user">` in `app/layout.tsx`. The
  marketing page inherits it; do not bypass.
- Hover is limited to the cursor — no scaling, no tint. The list
  prop is fully non-interactive on the marketing page (mirrors the
  existing `SeenByCard.tsx` data shape but does not re-create its
  click behaviour — see §5).
- A confirmation animation on the marketing site is **for
  illustration only**: when the page is loaded with `prefers-reduced-motion`,
  it shows the ticked state immediately and never animates.

### 6.5 Imagery direction — manifesto (one page)

The marketing site does not use illustration as a substitute for
care. It uses **specific objects** the reader is asked to recognise.
The page is illustrated by the prop(s) the brief places inside it,
hero, ordinary cost, difficult ordinary day, and trust.

**Imagery do's — what we use.**

- **Object photography / still life.** A real paper list. A phone
  showing a single confirmation state. A drawer slightly open. A
  laptop with a single document, no scroll. A set of keys. A school
  letter on the fridge. The visual language is *quiet, specific,
  used objects*, not staged stock.
- **Paper-stock treatment for the sample list prop.** A hand-drawn
  cross-hatch on linen; real names, real ticks; a hairline dog-ear
  or fibre crease; slight unevenness as if it has been handled. The
  list looks like a prop that has been through Tuesday already, not a
  UI component that has been polished for screenshot.
- **Two-camera consistency.** The same visual grammar in the
  household scene (kitchen-drawer) and the team scene (founder's
  desk). Same object-led framing, same restraint, same paper
  background. The dual audience reads as **the same film shot twice.**
- **Lighting.** Soft, natural, documentary. No dramatic rim light,
  no cinematic colour grading. A small, late-afternoon window-light
  model is the visual register.

**Imagery don'ts — what we never use.**

- Stock photographs of smiling multi-generational families.
- Stock photographs of diverse teams high-fiving in glass offices.
- Abstract 3D illustrations of shields, locks, or floating documents.
- Screenshots of dense dashboards used as hero images.
- Pictograms of families or teams (no hands holding houses, no
  people inside circles, no avatar-coloured discs).
- Empty-chair, funeral, hospital, or emergency-light imagery.
- Anything that watches a person on screen (no "Sara viewed 3 minutes
  ago" relative-time tags on a face — relative-time belongs to the
  list, see §5.2).

**Imagery supply checklist.**

- A library of 6–10 still-life photos owned by LifeKeel, used across
  the marketing site. Each photo is captioned with the scene it
  supports (kitchen-drawer, founder's-desk, a paper list, a phone,
  etc.). New scenes are commissioned against this library; no
  out-of-library stock.
- The sample list prop is rendered, not photographed. It is a
  React component (a redesigned `SeenByCard.tsx` variant) that pulls
  off the same `domains.view.confirmation` data shape. The
  *texture* (paper, dog-ear) is a CSS treatment the design system
  defines once, used by any instance of the prop.
- No third-party stock is required for the page as written.

**Photography extension (designer notes).**

The two-camera rule is a *style* rule more than a *framing* rule.
The kitchen-drawer scene and the founder's-desk scene will use
different objects because they describe different units, but they
must use the **same camera height, same shallow focal length, same
muted warm light, same paper background tint, same crop tolerance.**
A reader scrolling between the two should feel they have not left
the film. The brand guide's two-camera grammar (§4 of the brand
guide) is operationalised here.

### 6.6 Logo usage

**Current assumption.** LifeKeel uses a wordmark, no separate icon
mark. The logo lives in `/public/logo/README.md` per the brand
guide and renders as Fraunces 600 in `--font-wordmark`. The
recommendations below are an *owner call about what to lock*; they
do not require renames or large design effort.

**Recommendations (panel consensus).**

- **Keep a calm, confident wordmark.** Do not force a clever icon
  that tries to "explain" the product. The name *"LifeKeel"* does
  not need illustration; the metaphor stays in the copy and story,
  not the logo.
- **Custom or carefully chosen geometric sans.** If the wordmark is
  revised, prefer a geometric sans with excellent legibility at
  small sizes and on mobile. Fraunces 600 (current) is acceptable
  but may be too literary for the brand direction the visual system
  sets; the call is in §9.
- **Optional quiet mark.** A subtle **horizontal line** or **minimal
  "list" gesture** (e.g. three stacked thin rules, no letterforms)
  can sit beside the wordmark or work alone as a favicon / app icon.
  *Never decorative.* Owner call: keep wordmark-only, or add the
  minimal mark.
- **Two versions only.**
  1. **Primary** — dark on light (ink on paper).
  2. **Reversed** — light on dark (paper on ink).
  No gradients. No multi-colour versions for the core mark.
- **Clear space.** Equal to the cap-height of the wordmark on every
  side. No element may encroach.
- **Minimum sizes.**
  - Wordmark: 24px cap-height for on-screen body, 18px in footer
    chrome.
  - Mark only: 16px square for favicon / app icon.
- **Reject.** Any nautical or literal "keel" illustration. Any icon
  that reads as a boat, an anchor, or a shield. The metaphor is held
  by the copy, not the mark.
- **On the marketing site, the logo should feel like a production
  company mark at the start of a film** — present, calm, never
  competing with the story. The header chrome is small, restrained,
  and uses the wordmark at its quietest size; the mark, if used, sits
  at favicon scale next to the URL in the browser tab.

### Appendix A — Brand spec one-pager

The only document a designer or an agency needs to see in order to
extend the marketing site without breaking the film. Printable on a
single A4. Pin it to the wall; consult it before any new section.

---

**A1. Hero copy (typography sample).** Render the locked display
face in the locked accent and check the rhythm:

```
The important things usually live in one head.       ← line 1, display
One list. The people who need to know can see it.    ← line 2, body
Know where to look.                                  ← line 3, italic / display variant

Start a free list                                    ← CTA, primary
For a small team — see plans                         ← text link

Free for a household. Honest plans for a team.
Information only — never moves money, never gives advice.
```

The page should read this block **in under three seconds** at desktop
sizes, **in five seconds** at phone sizes.

---

**A2. Type scale.**

| Role | Mobile size / line-height | Desktop size / line-height |
|---|---|---|
| Display (hero line 1) | 40 / 48 | 64 / 72 |
| Display (lines 2–3) | 28 / 36 | 40 / 48 |
| Body | 17 / 26 | 18 / 30 |
| Body-small | 14 / 22 | 15 / 24 |
| Mono / prop | 14 / 22 | 14 / 22 |
| Caption | 12 / 18 | 13 / 20 |

Faces in use (owner-locked, see §9):

- **Body / display (default lock):** Inter 400/500/600 (`--font-sans`).
- **Display alternative (current load):** Instrument Serif 400
  (`--font-display`). Acceptable. Owner call.
- **Wordmark:** Fraunces 600 (`--font-wordmark`).
- **Mono / prop:** IBM Plex Mono 400/500 (`--font-mono`).

Hierarchy rule: **one dominant line per scroll.** Then supporting
lines that never fight it.

---

**A3. Paper-mode palette (locked).**

| Token | Hex |
|---|---|
| `--paper` | `#fdfcf9` |
| `--linen` | `#f5efe6` |
| `--rule` | `#d8cfc1` |
| `--ink` | `#17231f` |
| `--ink-muted` | `#5e564c` |
| `--ink-faint` | `#8a8276` |
| Accent (default — owner call) | `#2a4a3c` |
| Accent alt 1 | `#3d5862` |
| Accent alt 2 | `#3d3933` |
| Tick ink | `#17231f` |

Usage: accent only on confirmation-tick completion, primary links, and
date highlights. **Never** a CTA background, **never** a status badge.
The accent applies to the marketing site only; the in-app palette is
unchanged. Forbidden: bright fintech teal, high-saturation success
green, violet-tinted blue gradients.

---

**A4. Motion checklist.**

Allowed (state-revealing only):

- Confirmation tick `○` → `✓`, ~220ms stroke draw-on.
- Sample list settling in, line by line, ~80–120ms apart.
- Quiet fade between two camera angles (no slide).
- One subtle paper-settle on first load.

Forbidden:

- Parallax. Bouncing cards. Auto-play video with voiceover.
- Auto-playing audio. Scale-on-hover. Tint-on-hover.
- Carousels or slideshows.

Reduced-motion: loud. `<MotionConfig reducedMotion="user">` is
already app-wide in `app/layout.tsx`; do not bypass it.

---

**A5. Imagery do / don't.**

Do: object still-life (a paper list, a phone with a confirmation
state, a drawer slightly open, a laptop with a single document, a set
of keys, a school letter on a fridge). Two-camera consistency. Soft,
natural, documentary lighting. The sample list is rendered, not
photographed — a redesigned `SeenByCard.tsx` variant with paper
texture on `--linen`.

Don't: stock-photo families, high-fiving teams, abstract 3D shields,
dashboard screenshots, pictograms, hospital / funeral / siren imagery,
"viewed X minutes ago" relative-time tags on a person.

---

**A6. Logo lockup rules.**

- Wordmark: Fraunces 600 in `--ink` on `--paper` (primary); in
  `--paper` on `--ink` (reversed). No gradients.
- Optional **minimum mark**: a single horizontal hairline or a
  three-rules "list gesture," no letterforms. Owner call.
- **Clear space:** equal to the cap-height of the wordmark on every
  side. No encroachment.
- **Minimum sizes.**
  - Wordmark: 24px cap-height (on-screen body); 18px (footer chrome).
  - Mark only: 16px square (favicon / app icon).
- **Reject** any nautical or literal "keel" illustration. The
  metaphor stays in the copy and story, not the mark.
- **On the marketing site, the logo should feel like a production
  company mark at the start of a film** — present, calm, not
  competing with the story.

---

**A7. Sample-list prop spec.**

- A redesigned **`MarketingSeenByList`** component (a fork of
  `apps/web/src/components/SeenByCard.tsx`) renders the prop.
  Pulls the same `domains.view.confirmation` data shape the app
  uses; **non-interactive** on the marketing site (no hover, no
  click, no per-row action).
- Paper texture: CSS-only `--linen` background + a 1px fibre
  hairline cross-hatch + an optional single dog-ear PNG (≤ 4KB).
- Row shape: `[item-label] · [ticked-by names]`. Mono for the
  label; ink-coloured ticks; settled in over a 220ms stroke draw-on.
- Real names always; relative time at the foot, not on the person.
  *"Mara last looked 9 days ago. Tom last looked 21 days ago."*
- Caption under the prop on every instance: *"An example list of
  one family. Yours begins empty and stays yours."*

---

**A8. Continuity Mode prop spec.**

- Two parallel panels: a family panel and a team panel, at the same
  width, the same typeface, the same number of lines.
- Numbered list (`1 … 3`), no bullets, no icons. The third item is
  always a phone number lifted from a paper on file
  (`claims.ts` `who-to-call`, `live`).
- A small italic footer on each panel: *"the next three things,
  drawn from what's already on file. Nothing moves money, nothing
  is decided for you."*
- A single plain-text link under each panel:
  *"Open the family's plan →"* / *"Open the team's plan →"*. No
  button labelled "Activate." No red. No siren icon.

---

**A9. Trust-act promise card spec.**

Seven rows, each tied to a `live` `claims.ts` row (with `page: true`
where applicable). The trust act renders these as a single column of
short lines with the italic gloss sources in parentheses for the
designer — the parenthetical sources are not on the page. See §5
above and the promises list:

`no-commissions`, `no-money-moved`, `no-policy-picks`, `no-selling`,
`approval-first`, `leave-and-removal`, `export-data`,
`delete-account`, `encrypted-at-rest`.

**Not** in the trust act (and why): `no-training`, `sign-in-link`,
`always-on` are *blocked* claims. The act must not say what is
already forbidden.

## 7. How future platform services enter without breaking tone

The brand guide's *seven chapters* (`Where's the …?` /
`Do you know about …?` / `What's coming up?` /
`What if we …?` / `Something's happened.` /
`Things have changed.` / `It's yours.`) is the right hook for any
future service.

The rule for adding a new feature is: a new feature is a **scene**
inside an existing chapter, never a chapter of its own.

**Entering the team vertical cleanly.** The teams thread does not
add chapters; it adds a *camera angle* to each existing chapter. The
**human truth** of every chapter is identical for a household and
for a small team; only the unit changes.

| Chapter | Family scene (in the camera) | Team scene (in the camera) |
|---|---|---|
| 1. "Where's the …?" | Where are the policy papers? | Where is the signed contract? |
| 2. "Do you know about …?" | Sara knows the will is upstairs. | The co-founder knows the renewal contact. |
| 3. "What's coming up?" | MOT in 35 days. | A client renewal in 35 days. |
| 4. "What if we …?" | Income stops for a month. | A key person is away for a month. |
| 5. "Something's happened." | A difficult Tuesday morning. | A difficult Tuesday morning. |
| 6. "Things have changed." | A new child. | A new partner joins the team. |
| 7. "It's yours." | Family leaves when they want to. | The team rotates when they want to. |

Every chapter on the public site pairs a Scene A (household) and a
Scene B (team) in the same panel. Chapter 7 is shown only on /trust,
not in the home page, so this list is consumed by /stories as a
sequential reading order.

**Rule for ships.** A new service goes live on the page if and only
if a corresponding row exists in `apps/web/src/components/landing/claims.ts`
with `status: 'live'` and an `evidence` path that names the source
file. The dual-audience pattern above is a *narrative* decision;
whether a corresponding *feature* exists in the in-app product is a
separate decision and must be tracked by the claims registry, not by
the brief. **The team's vertical has no live claims today.** The
"team panel" copy on the public page is allowed to be present before
those claims exist, *provided* the panel does not promise a feature
the in-app product doesn't have.

The dual-audience pattern does not require splitting the brand, and
it does not require a `/for-teams` page. It only requires that every
panel on the page pairs the human truth for both units.

## 8. Brand guardrails — restated for this brief

These are the rules already authored in
`docs/research/brand-and-story-guide-2026-11-08.md` and the
claim/registry rules in
`apps/web/src/components/landing/claims.ts`. They apply to every
line written in this brief.

- **No Apollo 13 / Thai Life / John Lewis / Volvo / Pixar's-Up**
  references — restraint, not costume.
- **No "always watching", "around the clock", "24/7"** — forbidden
  by `claims.ts` `always-on` (`blocked`).
- **No "never used for training", "no password", "email link"** —
  forbidden by `claims.ts` `no-training`, `sign-in-link` (`blocked`).
  These are policy-or-procedural claims the landing page cannot
  truthfully make at this time.
- **No "recommend", "best deal", "trusted by", "industry-leading",
  "switch to", "compare policies".** Forbidden by the
  `packages/engine/src/__tests__/advice-rule.test.ts` advice rule,
  applied with the broader landing-page scope.
- **No "each adult has seen it."** Saying *asked to confirm* is the
  accurate phrasing and the brand guide's standing rule.
- **No sirens / red / hospital / funeral.** Continuity Mode stays
  as a quiet numbered list, not a button labelled "Activate."
- **No pictograms of families / teams / hands / shields holding
  houses.** The list itself is the image.
- **Pricing claims** only from
  `apps/api/src/billing/billing-constants.ts`. Do not invent per-team
  prices in marketing copy; quote what the file says and what
  `claims.ts` `free-plan` and `plus-price` let you say.
- **Feature claims** only from `claims.ts` rows with `status:
  'live'`; never quote `'planned'` on the public site per
  `NoRoadmap.test.tsx`. (The team vertical currently has neither
  planned nor live marketing-page claims, so marketing copy about
  teams is allowed to describe the *human truth* but not to promise
  a feature.)

## 9. Open — decisions still needed from the owner

Five owner calls were open at the time this brief was authored. Each
has now been **locked by the owner on 2026-11-26** with the *rec-ommended
default* from the brief. The implementation is already aligned to
each lock; the briefing decision is recorded here for the audit trail.

| # | Decision | Locked value | Where it lands |
|---|---|---|---|
| 1 | Pricing chrome | **One Keel Plus subscription per team.** Free below a small-team threshold; one subscription per team of two or more adults. | `/pricing` page (next write) and the team secondary text link in Scroll 0. |
| 2 | Sample list content | **Rivera-family household example on the marketing hero**, treated as illustrative. The team camera angle appears nowhere on the marketing route until the team vertical has `live` `claims.ts` rows. | `LandingHero.tsx` already uses the Rivera family (`Dev` / `Marcia` / `Asha`). The brief-named cast `Mara / Tom` was reverted to match the rest of the home page. |
| 3 | Palette accent | **Deep forest green `#2a4a3c`**, paper-and-ink feel. | `--lk-accent` in `landing.css`, already set to `#2a4a3c`. Dark mirror: `#b6eda3`. |
| 4 | Display typeface | **Keep Instrument Serif** as `--font-display`. Brand guide §3 recommendation honoured; no font swap. | `apps/web/src/app/layout.tsx` already preloads Instrument Serif. |
| 5 | Logo lockup | **Wordmark only** — Fraunces 600 at body and footer chrome, the same wordmark set small as the favicon / app icon. No separate mark. | `public/logo/` paths unchanged; `LoginCard`/`SiteHeader` continue to render the wordmark alone. |

6. **CTAs (already locked on 2026-11-26).** Singluar primary
   *"Start a free list"* + quiet text-link secondary
   *"For a small team — see plans"*. Lives in `LandingHero.tsx`'s
   `.lk-paper-hero-cta` block.
7. **Team-vertical claims (still open, dependency for § 1 above).**
   Heaviest call: adding a `landing-team` row group to
   `apps/web/src/components/landing/claims.ts` is the *only* way a
   `/for-teams` route or a team feature promise lands on the page.
   Tracked in `claims-registry.test.ts`. **Not yet landed.**

The next writes are the **/pricing** page (concrete numbers and the
team-thread language, pulled from `apps/api/src/billing/billing-constants.ts`
and `claims.ts` `free-plan` and `plus-price`) and the **/trust** page
(an expanded version of the trust-act scroll above, with full
encryption/audit provenance). Once those are in, the implementation
pass begins — paper-mode tokens in `apps/web/src/components/landing/landing.css`,
a non-interactive **`MarketingSeenByList`** fork of `SeenByCard.tsx`,
and the rewritten hero in `LandingHero.tsx` (or its replacement).
Fast-followers once the owner signs off on this brief.

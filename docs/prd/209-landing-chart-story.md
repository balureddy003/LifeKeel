# PRD-209: The landing story, "The Chart"

## Problem

The public landing page explains LifeKeel in about ten text sections, but a first-time
visitor never feels it. It looks like generic fintech, leads with a static dashboard, and
describes capabilities (nine detectors, per-member twins, crisis scenarios) rather than
showing one clear picture. It also carries claims that are no longer, or never were,
true of the product ("Not a vault.", a comparison table, nine daily checks described as
always running), and the welcome flow behind the Get started button says "Nothing trains
models" and uses a fear-coloured slide, both of which the repo's own rules forbid.

The product is about to grow many more capabilities. A feature-list page has to be
rewritten each time one ships. The page needs one stable story that new capabilities slot
into, a direct signup path (the founder has decided there is no quiz), and an honest way
to show what is live and what is planned.

The reasoning, the four rounds of expert review behind it, and the audit of what is
actually built are in
[the landing and conversion rebuild review](../reviews/landing-and-conversion-rebuild-2026-10.md)
(sections 14 to 16). This PRD records the decisions.

## Who it's for

First-time visitors to lifekeel.co.uk and lifekeel.si deciding whether to create an
account; the product, design and engineering team as the rule set for every later
capability that wants a place on the page.

## What "done" looks like

1. **One story.** LifeKeel keeps your family's **chart**: one picture of the household,
   kept current from what the family has told it. (A single ordered list of next steps is
   planned and is shown as a preview, not as a feature that exists.) The spine is
   **Ready before. Found during. Sorted after.** Every capability belongs to exactly one
   of those three moments.
   - "Companion" is the voice (calm, dated, says where a fact came from and what Keel has
     not done). It is not a noun on the page.
   - "Digital twin" appears at most once, in a how-it-works footnote ("Some people call
     this a digital twin: a living copy of what you've told us"). It is never in a
     headline.
   - **LifeKeel is presented as a platform in function, not as a single product:** one home
     for the family, where capabilities join the same chart over time, shown by the board
     and the chart rather than by a label. Headlines say "your family's chart" and "one
     home", never "app", "tool" or "product". The word "platform" appears **once**, in the
     short line that introduces the board ("LifeKeel is one platform for your family's
     picture, and it is useful at three different moments"), and never in a headline or
     the brand line. The page never implies partners, integrations, connected accounts, a
     marketplace, an ecosystem, an API or third-party providers: the only claim is that
     new capabilities join the same chart and say whether they are Live or Planned.
2. **A living, animated hero** on the real sea scene: the family chart (a boat per
   adult, children as smaller boats tied to a parent, a lantern per policy on file, an
   unlit lantern outline for something not on file), a slow lighthouse sweep, and a sample
   family that is clearly labelled as a sample. It is complete at rest, pauses when off
   screen or on request, and respects reduced motion.
3. **Direct signup in the hero**, on the existing flow (Google, or email with a password).
   The card states who we are, why we need the email, the 18+ rule, and links to the real
   Terms and Privacy notice. Marketing consent is not bundled with signup. The card does
   not say "no password" or "single-use link" until the email sign-in link ships
   (separate PRD).
4. **The board.** One data array lists every capability with its moment (before, during,
   after) and a status, **Live** or **Planned**, shown as text, not colour alone. Adding a
   capability is adding one entry. Planned means intended, never promised, and is never
   described in the present tense.
5. **Eight sections at most**, each under one screen: hero; a read-only sample day (four
   bad days on a made-up family, no input from the visitor); the board; Before: cover on
   file; During and after: when something happens; six promises; a dawn close with a
   second signup; footer. A sticky mobile "Start free" bar hides while a form is visible.
6. **Claims are evidenced.** Every public sentence maps to a row in a claims registry
   (`claims.ts`) with a status and evidence, and a test fails if a planned or blocked claim
   appears in present tense.
7. **The advice rule covers the new copy.** The landing component files and the claims
   file join the advice-rule scan, with extra banned patterns for this surface (see
   Constraints).
8. **Capability admission test** (every new thing that wants a place on the page):
   1. Which moment is it in?
   2. What does it read? Only data on file inside the trust boundary, typed or confirmed
      from a document, never a transaction feed.
   3. What does it never do? Name the trust tier and the advice boundary.
   4. Is the claim true of the shipped product and mapped to evidence?
   5. Can it be said in one line without internal words (twin, detector, playbook)?

### Page content that is safe to claim today (verified in the audit)

| Claim | Status |
|---|---|
| Papers (wills, powers of attorney, policy papers) your family's adults can open; optional passphrase sealing with no recovery | Live |
| Steps for seven kinds of bad day, filled with the policies and contacts on file | Live |
| A draft message to your own insurer that you edit and send | Live |
| Who to call, from the claims contact in your policy papers | Live |
| Cover on file looks light against a rough estimate; missing income protection or second-earner cover; renewals; duplicate policies for the same person | Live |
| Emails to named family adults if the organiser goes quiet (opt-in, off by default) | Live |
| A what-if runway simulator | Live |
| Duplicate cover across partners (type-aware: personal cover types are never flagged) | Planned |
| A plain how-to-claim guide for each kind of policy; a claim-ready pack | Planned |
| A monthly letter about what changed; sign-in by emailed link | Planned |
| Access for a named person outside the family | Planned (needs counsel) |
| "Digital twin" as a headline, "autonomous", "knows your family", "always on", "protect your family", "the clear path", optimise, save, switch, "we handle your claim", emergency access, "never used to train models" | Do not say |

## Constraints

- **Trust tier:** 0. The page adds no autonomous action and no new `ActionExecutor`
  caller. Drafts are described as Tier 1: Keel writes, the family sends.
- **Regulated-advice check (CLAUDE.md rule 2):** copy states what is on file and labels
  estimates; it names no provider, ranks no policy and never says a policy is too dear
  or points to a cheaper one. "Claim-ready, you make the claim" is the only claims
  framing; Keel never pre-fills an insurer's claim form, describes a named insurer's
  process or predicts whether a claim will pay. Insurance "optimisation" is not offered
  and the word is not used. Estimated-shortfall wording and the drafted insurer notice
  are put to counsel before the page gives them hero prominence.
  - **Platform wording.** A test over the landing copy fails if the word "platform"
    appears more than once, or in a heading, and the scan adds `marketplace`, `ecosystem`,
    `integrations?`, `open banking` and `\bAPI\b` as banned words. ("Partner" is not
    banned because it also means a spouse in the sample copy; a separate check reviews any
    use of "partner" that is not about family members.)
  - The landing copy scan adds these patterns: `compare`, `cheaper`, `save` (money
    sense), `optimi[sz]e`, `better deal`, `starts watching`, `safety net`, `autonomous`,
    `knows (you|your family)`, `always on`, `protect your family`, `guaranteed`,
    `risk-free`, `act now`, `urgent`; and `digital twin` outside the single footnote.
- **Data/privacy:** the sample family is made up and labelled. Nothing a visitor does on
  the page (there is no input) is stored. No analytics event carries a value or an
  email. The "not used for training" line stays off the page until the PRD-142 test
  exists. The privacy and terms pages are placeholders today and must be completed before
  launch, together with a DPIA that covers children's data.
- **Technical:** static export with `script-src 'self'` and `font-src 'self'`: fonts are
  self-hosted, no inline or third-party scripts, and the deploy runs
  `scripts/externalize-inline-scripts.mjs`. The landing's first-load JavaScript stays
  under 90 KB gzipped (no framer-motion). Motion is CSS, inline SVG and one small shared
  clock. WCAG 2.2 AA: contrast checked for each text pair in light and dark and in every
  sea state, a visible Pause animation control, no live region on the animated number,
  44 px targets, forced-colors and print support.
- **Voice:** UK English, plain words: on file, check, steps, papers, cover, draft, letter.
  No fear, scarcity or countdown devices.

## Builds on

PRD-005, 102, 103, 105, 108, 130, 134, 137, 148, 204, 208, and the implementation audit
in the review document. Supersedes the quiz-based parts of PRD-201, 203, 204 and 205
for the landing page (those are deferred, not deleted).

## Success metrics

There is no benchmark in the repo, so first measure: visit to signup start, then signup
to verified account and to activation (three detectors able to run). Consent-gated
analytics will undercount, so treat the baseline as a sample and do not call a winner
under about 100 conversions per arm. Guardrails per PRD-204: spam complaints under 0.1%,
unsubscribes under 1%. Also: zero claims on the page without a registry entry; no
accessibility or contrast regression; landing first-load JS within budget.

## Out of scope

The quiz and `/readiness` changes; any partner programme, integration, connected-account
or marketplace claim (PRD-207 covers distribution partners separately and is not shown on
this page); the email sign-in link (PRD-152); Keel's path, an
ordered next-three list (PRD-150); the cover-on-file view and the partner duplicate
check (PRD-151); emergency access for a non-member; the claim-ready pack; the monthly
letter; notification caps; statically rendering `/` (the landing still renders after the
auth gate, so first paint is the loading skeleton); any redesign of the signed-in app;
paid acquisition.

## Open questions

- Counsel: is the estimated shortfall a personal recommendation; is a drafted notice to
  the family's own insurer outside claims assistance (FCA PERG 5.7 is cited in the
  review, from a 2021 page, and must be checked); children's data and the DPIA;
  controller and processor roles for a household with several adults.
- Whether to soften the detector actions that point to market quotes before the page
  shows duplicates or renewals as a feature (the wording changes to `policy-review.yaml`
  and `protection-gap.yaml` are drafted and uncommitted).
- Whether the home-grown consent record needs a version string for the marketing opt-in
  before the signup card ships.
- Where `lifekeel.si` should send Slovenian visitors, since the product has no
  localisation yet.

## Becomes

docs/prd/209-landing-chart-story.md

## Amendment: no roadmap on the public site

Decision (founder, after the first build): the marketing and landing pages do not show a roadmap. They
show only what is available today, each item with the note saying what it depends on. The **Live** and
**Planned** tags, the planned-steps preview, the dashed "planned" years items, the "Planned check" row in
the cover sample and the live and planned counts are removed from the public pages, `llms.txt` and the
FAQ. The status vocabulary (Live, Planned) and the roadmap belong in the app. The capability data and the
claims registry keep their `planned` entries for that use, and `NoRoadmap.test.tsx` fails if roadmap wording
or tags return to the public site. This supersedes the "Live or Planned as text" and "Planned means
intended, never promised" requirements above for public pages only.

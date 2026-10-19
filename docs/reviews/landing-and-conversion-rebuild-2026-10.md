# Landing and conversion rebuild: four-expert synthesis (October 2026)

Status: proposal, not yet a PRD. Four independent read-only reviews (go-to-market, behavioural UX, UI/visual, content) were synthesised here. All numeric targets and CAC figures are hypotheses; the repo has no benchmarks for them. Code references were spot-checked against `main` on 19 October 2026.

Rule check for everything below: no fear or urgency devices, no regulated advice, nothing implied that is untrue of the shipped product, no claim that family content is never used for training until PRD-142 is wired.

## 1. The diagnosis in one paragraph

The landing page explains a product the visitor has not felt. The path from the 60-second score to an account restarts the visitor at zero: the reveal says nothing is saved, offers a newsletter box above the real call to action, then sends them through a five-slide carousel and a name-and-password form before the home page tells them to "finish" a profile that produces a score they already have. The visual system is generic (indigo gradient, Inter only, glowing red/amber/green rings). The best idea in the product, rehearsing a bad day against your own numbers, is a paragraph.

## 2. Fix first: defects, not experiments (days, not weeks)

| # | Defect | Where | Why it matters |
|---|---|---|---|
| D1 | The welcome carousel says "Nothing trains models" | `apps/web/src/app/welcome/page.tsx:36` | PRD-204 says not to publish this until PRD-142 is wired. Rule 3 is not yet enforced in code. |
| D2 | Slide 3 uses a danger gradient and "What happens if you lose your job?" | `welcome/page.tsx:24-25` | A fear device. |
| D3 | Heartbeat email records failed sends as sent, has an ~8-hour monthly window, and lacks `List-Unsubscribe` | `apps/api` heartbeat job | Retention and funnel numbers are wrong until fixed. A branch `fix/heartbeat-list-unsubscribe` exists. |
| D4 | The primary CTA to the app link relies on a cross-origin redirect and lands on `/welcome/index.txt` | marketing site links, `firebase.json` | The main button fails. Use plain anchors to `https://app.lifekeel.si/...`, no router prefetch. |
| D5 | PRD-201 cites a US FEMA statistic for a UK-first product | PRD-201 | Replace with a verified UK source or drop it. |
| D6 | The newsletter capture sits above the real CTA and uses the same email field | `readiness/page.tsx:158, 481` | Two asks collide. |

## 3. Positioning and voice

- One line: "LifeKeel checks your family's safety net every day, so a gap in cover, savings or paperwork is flagged before a crisis does. Free. No commissions. Nobody to sell you anything."
- Do not lead with "digital twin" (jargon) or "autonomous" (sounds like a rule-1 risk).
- Hero (content and UI reviewers differ, pick one): content proposes "Run the 'what if' now, while nothing is wrong." UI proposes "See how long your family could stay steady." Both avoid the fear in "tomorrow". Recommendation: the UI line as headline, the content line as the interaction prompt.
- Voice rules: say what is on file, never what to do; label estimates and point to "a licensed professional"; calm facts; plain UK English; say what was not measured; verbs are notice, check, tell, show.
- Banned additions to the advice-rule list (for human review): must, need to (instruction), guaranteed, risk-free, act now, urgent, last chance, "protect your family". Any new copy kept as a constant (trust block, digest chrome) must be added to the copy set in `packages/engine/src/__tests__/advice-rule.test.ts`.

## 4. The landing page: four blocks

Cut from ~10 sections (`MarketingLanding.tsx`, 1,467 lines) to:

1. **Rehearsal hero.** Two sliders visible at first with a result already showing, scenario chips, the boat heeling as runway shrinks, a visible maths line. A secondary link "Do the six-question check" goes to `/readiness`. Until the visitor chooses to keep a result, nothing leaves the browser, so no tracking event may carry slider values.
2. **Quiet Care letter.** A sample monthly letter, labelled sample.
3. **What LifeKeel will not do.** Four lines, each mapped to a code fact and removed if it stops being true: no commissions, no product picks, no selling data, nothing consequential without your yes.
4. **Close.** One CTA and the disclaimer.

Delete: the stats band, the four-ring sample dashboard, the features grid, the comparison table, the standalone security wall (link to the trust page, PRD-208), the pricing block (link out), FAQ beyond five items.

Prototype corrections required before it can ship (from the UI review, accepted):
- It uses inline script, inline style and Google Fonts, all blocked by `script-src 'self'` and `font-src 'self'`. Rebuild as a bundled component with self-hosted fonts.
- Its runway maths must not contradict the real score. Either route through the shared `computeReadiness` or label the hero figure as a rough illustration distinct from the check.
- Remove the red storm wash, the "day you hope never comes" phrasing and the "Death of an earner" chip.
- Scenario assumptions (half of take-home, +£650, -30%) are invented. Show them as editable examples.
- Reword "claim line and policy number in one place", which assumes a vault that a new visitor does not have. Gate "no password, one link" on PRD-203 existing.

## 5. Visual direction ("Ballast")

- Palette: warm paper and deep sea tones, brass for notes, rust reserved for errors only; token values and contrast ratios are in the UI review (all text pairs at least 4.5:1).
- Type: Instrument Serif (display and numerals), Hanken Grotesk (body), IBM Plex Mono (labels), self-hosted via `next/font/local`, about 90 KB. Keep Inter in the signed-in app.
- Shape: hairlines not shadows; 4px / 12px / pill radii; one waterline motif; a brass dashed mark for thresholds.
- Imagery: no stock family photos, no faces; drawn instruments and real product screens captioned "Sample".
- Signature motion: the heel (hull tilts up to 14 degrees as runway shrinks; reduced-motion users get the final angle instantly with a text state).
- Replace the glowing `ScoreRing` on marketing and reveal surfaces with a flat waterline gauge. Leave the signed-in app alone for now.
- Budget: landing JS under 90 KB gzipped, no framer-motion on the landing page, LCP under 2.0 s on a mid-range phone, CLS under 0.05.

## 6. The score-to-account path

Replace, do not stack:

1. **One ask on the reveal:** "Keep this result" with one email field. Remove the newsletter `EmailCapture`; marketing consent becomes a separate unticked box (PRD-203, 204). Under the field, the what-we-do/what-we-do-not block.
2. **A saved-result screen replaces the five-slide carousel** for converted visitors. It shows the score, the component breakdown, a checklist that starts with "Quick check: done" ticked, and "Next check: [date]". It ends with "Nothing else is needed today."
3. **Account at the magic-link step; password is optional later** ("Add a way to sign in faster?" after they have seen the saved result).
4. Activation is defined as three detectors able to run, not "profile completed".
5. Reveal copy: replace "Fair / Needs attention / At risk" with "A lot still to put in place" / "Partly in place" / "Well covered, on the answers given", plus "an estimate from six answers, not a verdict". Soften "to put in place" if a reviewer reads it as an instruction.

## 7. Silent-utility retention (Quiet Care)

- Tiers: T0 monthly digest (the floor); T1 change that matters; T2 "we need one thing" (at most 2 per quarter); T3 life-event prompt (in-app, opt-in); T4 continuity (exempt from caps, not quiet hours). Dated obligations are never demoted.
- Digest anatomy (about 20 seconds): verdict line, specific proof with dates ("last full check 14 Oct") not counts, a diff that may be empty, at most one thing worth a look in detector copy, paused checks only if any, next check date.
- "9 checks ran" counts require a run record that PRD-138 says does not exist yet. Until then use dated proof, or build the run record first.
- Never send a false all-clear. A failed sweep sends "We couldn't check this month" and pages an operator.
- Ask before demoting cadence ("Switch to digest only?") after two ignored T1/T2 messages; measure clicks and replies, not opens.
- Silent users: a soft re-orientation digest at 60 days, ask at 90. No guilt or score-dropped framing.
- Measure perceived protection with a quarterly one-question confidence rating plus a randomised holdout (digest vs suppressed-on-all-clear), not "still paying and did not log in".
- Digest never promotes Plus.

## 8. Go-to-market

- Beachhead segments, ranked: expecting or new parents, new mortgage holders, then people managing a parent's paperwork. Deprioritise job loss and employers until PRD-207's pilot.
- Channels: 20-30 long-tail SEO pages each with the quiz embedded, community seeding with tracked UTMs, data-led PR after enough completed quizzes, a small £500-1,000 paid calibration (not scaling), partner distribution as a 90-day discovery task.
- Pricing: keep the quiz, all nine detectors on entered data, the score, the digest, export/delete and every gap alert free. Honest upgrade moment is after an upload shows an extraction preview. Pricing unit stays per household. GBP 7.99 is unanchored; run a small willingness-to-pay survey. Their review disagrees with PRD-206's exclusion of an annual plan; decide after billing cutover.
- Referral (PRD-112): the extraction-credit reward means little to free users; a free Plus month for both sides on invitee activation, capped, after billing is live, with counsel check. Build a slim PRD-205 share-with-partner link because it is the only loop with a natural reason to exist; kill if share rate is under 3% of verified users after 4-6 weeks.
- Billing is dormant (PRD-006): no Plus revenue exists yet, so payback cannot be measured. Production cutover is the gating milestone. Slovenia has no localisation; focus on the UK.

## 9. Funnel metrics and kill criteria (all unproven targets)

| Step | Start target | Note |
|---|---|---|
| Visit to quiz start | 25-40% | Intent-matched pages |
| Start to completion | 65-80% | |
| Reveal to email submit | 8-15% | Kill if under 4% after two trust/copy tests |
| Email to verified | 70-85% | Watch scanner prefetch burning the link |
| Verified to activated (3 detectors run) | 35-50% in 7 days | Kill/simplify if under 15% |
| Activated to day-30 digest click | 40-50% | |
| Activated to Plus trial | 4-8% at 60 days | Kill upgrade moment if under 1% |

Only top-of-funnel tests are statistically feasible at current volume (about 2,200 views per arm for 5% to 7%). Guardrails: spam complaints under 0.1%, unsubscribes under 1%.

## 10. Research to run first

1. Moderated teardown of the current reveal-to-signup flow (n=10-12 UK parents).
2. First-click/5-second test of the saved-result screen (n=40+).
3. Mental-model interviews on "always-on readiness" (n=8): reassuring or surveillance?
4. Six-week digest diary study (n=15): specific-fact vs count copy.
5. Notification-fatigue survey with holdout (n=200+, once volume exists).

## 11. Sequencing

| Phase | Work | Effort |
|---|---|---|
| 0 | Defects D1-D6; define funnel events with UTM and landing-page attribution; baseline the current funnel | about 3-5 days |
| 1 | Landing rebuild: tokens and fonts, brand primitives, `RehearsalHero` with shared maths, four-block landing | about 8.5 days |
| 2 | PRD-203/204 account step, saved-result screen, retire the carousel gate, reveal redesign and copy | about 6-8 days |
| 3 | Quiet Care digest (web preview and email), run records, cadence and tier work | about 3 days UI plus backend run-record work (not estimated) |
| 4 | SEO pages with embedded quiz, community seeding, calibration ads; share-with-partner link | ongoing |

The UI review's total is about 17 days for design and front-end work.

## 12. Backend agent specs (deliverable 3 of the original brief)

Not reviewed by this panel. PRD-143 (reviewed extraction pipeline), PRD-144 (email signal agent), PRD-142 (AI provider registry) and PRD-146 (deletion) already specify this; none of their rule-3 enforcement is wired yet. A separate review should check those PRDs against the brief before any claim about document or email handling goes on the landing page.

## 13. Open questions for the founder

- Correction: the marketing landing source is on `main` at `apps/web/src/components/MarketingLanding.tsx` (earlier text saying it was only on a branch was wrong). It currently says "Not a vault.", which contradicts the document-storage story and must change.
- Counsel review needed: the "no regulated advice" statement on the trust block, the referral incentive, and employer partnership data roles.
- Do you want the rehearsal hero maths tied to `computeReadiness`, or kept as an illustrative figure beside the real check? (Superseded by section 14: the hero no longer takes visitor input.)

## 14. Founder decisions after first review (supersede earlier sections)

**D-A. No quiz. The call to action is direct signup.** The hero is a signup card (Google, or email with a single-use sign-in link) and the animated sea demonstrates a clearly labelled sample family. Visitors are never asked for numbers before they have an account.

What this changes in the plan:
- Sections 4 and 6: the "Keep this result" step and the reveal screen go away. PRD-125, 201, 203, 204 and 205 (quiz, reveal, save, share-a-snapshot) are no longer on the critical path; mark them deferred rather than deleting them.
- Section 9 funnel becomes: visit, signup start, verified account, activation (three detectors can run), day-30 digest click, Plus trial. The anonymous-quiz steps and their targets are dropped. The 8-15% "reveal to email" target is replaced by a visit-to-signup-start target, to be baselined.
- Section 8: the GTM review called the quiz the product's single real asset and the thing every SEO page should embed. With no quiz, SEO pages need a different conversion mechanism (an inline signup, or an embedded sample rehearsal). Treat this as a real cost of the decision, not a free simplification: the quiz was the only no-commitment way for a stranger to feel the product's value, and direct signup asks for commitment before any value.
- Mitigations that keep the decision but protect conversion: passwordless signup (emailed single-use link and Google, no password wall, from the UX review's I-3), the sample-family rehearsal as the "feel the product" moment, an account that starts with a useful empty state rather than a long profile form, and a baseline measurement of visit-to-signup so the decision can be checked against data.
- Marketing consent stays a separate, unticked choice. The sign-in link flow depends on PRD-203's magic-link mechanism, which exists only as a PRD; verify its status before promising "no password" in copy.
- Anything the sample shows (figures, letter) stays labelled as sample.

**D-B. More visual life.** Section 5's restraint on motion is relaxed. Approved motion, all CSS or canvas, no new libraries, nothing hidden at rest:
- Staggered entrance of the hero on load.
- Sea that changes mood with the scenario: bright day, to dusk with twinkling stars, with a rotating lighthouse beam in rough water, in place of the red wash.
- Boat wake line, boat heel and bob, and counting numerals.
- Scroll-triggered reveals for sections below the fold, and the nine daily checks lighting up one by one on the sample letter.
- A soft pulsing halo on the primary signup button.
- Hard limits: respect `prefers-reduced-motion` (all of the above off, final states shown), no motion that carries information without a text equivalent, no fear imagery or alarm colour, the first screen complete without scrolling, and the section 5 performance budget (landing JS under 90 KB gzipped, LCP under 2.0 s). Ambient canvas motion must pause when off-screen or the tab is hidden before it ships.
- Concept: https://claude.ai/artifact/VRjdC8XRvzGmbJF7sMXS5e (private to the founder).

## 15. Critic round (art direction, conversion, accessibility and performance, brand and compliance)

Four independent critics reviewed concept v3. Their findings are inputs, not verified fact. Concept v4 applies the accepted ones.

Accepted and applied in v4 (concept only):
- Full-bleed layered sea is the hero, with the headline and signup card on it (desktop) or under a sea strip (phone); autoplaying sample rehearsal; redrawn larger boat with reflection; four fixed-width wave layers with a crest highlight; a lighthouse with an eased swing in place of the spinning cone; dusk and stars tied to the runway band, not to a specific scenario.
- Signup card: email first, Google secondary, one-shot halo instead of a repeating pulse, ink-on-brass button, an inline-validated field, a designed "Check your inbox" state with edit and a real 30-second resend countdown, 18+ line, who-we-are and data-use line, marketing not bundled into signup.
- Copy corrected: removed "no password" and "single-use link", "safety net", "starts watching", "nobody earns money if you act", "real consequences", and the fixed "monthly" cadence; letter labelled a preview of a planned feature; scenario steps rewritten as informational statements; bands renamed "6 months or more / 3 to 6 months / Under 3 months"; the earner scenario renamed and given a skip line; ledger retitled "Four things Keel does not do" with positive headings.
- Accessibility: contrast tokens fixed per theme and sea state, field borders at 3:1 or better, one polite status sentence instead of a live region on the animated number, native radio group for scenarios, skip link, no focus-radius change, visible Pause animation control, forced-colors and print rules, decorative layers hidden from assistive tech.
- Performance: stars loop runs only while visible, awake and not steady, with a cached colour and DPR scaling; no repeating box-shadow animation; resize handled by ResizeObserver; entrance animation trimmed so the headline is not delayed.
- Added: how-it-works section, a mobile sticky Start free bar, company details placeholder.

Not applied, needs a founder decision or later work:
- Editable sliders on the sample family (CRO critic's top mechanic). It does not take the visitor's own data, but it sits close to the no-quiz ruling.
- Founder note and photo, public changelog and real company details (placeholders only); named-founder trust cues need the founder's consent and true content.
- A public example-letter page and public checks list for SEO (a later content task).
- Sign-in by emailed link, the monthly letter, a nine-check run count and "never used for training" claims stay out of the copy until built (PRD-203, PRD-138, PRD-142).
- A claims registry and extended advice-rule patterns (compliance critic): worth a PRD of its own. Verify the "no changes without your yes" line against every ActionExecutor caller and the auto-execute job before it ships.

Open risks the critics raised that the concept cannot settle:
- Direct signup removes the only no-commitment value moment. If visit-to-signup-start baselines very low after a few weeks of clean traffic, revisit a no-data interactive step before touching copy.
- The production static export needs its inline Next.js hydration scripts allowed by build-time hashes under `script-src 'self'` (the live site was blank for exactly this reason earlier); verify early. Self-host fonts. Landing JS budget under 90 KB gzipped.
- The concept has not been tested in a browser, so layout on desktop and phone, dark mode and the sea states are unverified.

## 16. Capability review and the story architecture (founder: vault, claims, gaps, crisis, "optimisation")

Three reviews (product owner, market analyst, implementation audit; findings are their claims, spot-checked against code where noted).

### 16.1 What is true today (implementation audit, spot-checked)

| Founder's promise | Built? | What can be claimed |
|---|---|---|
| Documents available to the family in a crisis | Bounded. Vault for will, power of attorney, policy and other papers; AES-256-GCM at rest; optional client-side sealing under a family passphrase with no recovery. Access is standing access for joined adult members. Continuity "still there?" emails exist, opt-in and off by default. No break-glass, no named-person access, no offline vault. | "Papers your family's adults can open." Not "emergency access", not "end-to-end encrypted by default". |
| Helps to claim | Partial. Claims contact extracted from uploaded policies (Plus), shown in playbook steps; LLM-drafted email to your own insurer for you to edit and send (copy or mailto, never sent by Keel). No claim form, tracking, or claim pack. | "Find who to call and draft a message to your own insurer." Not "helps you claim". |
| Finds gaps in insurance | Implemented, shallow. Rule-of-thumb heuristics over data the family entered or confirmed: no income protection, life cover below a computed estimate, no second-earner cover, no health or critical-illness cover with dependants, renewal within 60 days, duplicate policy of the same type for the same holder. Policy wording is never read; no car or home adequacy checks. | "Cover on file looks light against a rough estimate." Not "finds gaps in your insurance". |
| Crisis management | Implemented as checklists and what-if maths. Seven playbooks (job loss, bereavement, disability, medical, car, property, travel), personalised from policies and contacts on file, plus a runway simulator. No incident mode, concierge or real-time handling. | "Steps for seven kinds of bad day." Not "manages a crisis". |
| Insurance optimisation | Absent, and forbidden by rule 2. | Do not claim. Do not use the word publicly. |

Spot-checks: `MarketingLanding.tsx:700` says "Not a vault."; `detectors/family/policy-review.yaml` has the duplicate-policy rule, but its copy says "wasted premiums" and "switching providers", and several protection actions say "Compare quotes from multiple insurers" or "Compare against current market quotes before renewing automatically"; seven playbooks exist; continuity is organiser opt-in; document AI extraction is entitled for paid plans only (`entitlements.ts`). Overlap exists as a detector (duplicates) but there is no overlap view.

Needs a human decision: the "Compare against current market quotes before renewing" action drifts toward shopping-around nudges, and "a duplicate ... left over from a provider switch is a common source of wasted premiums" reads close to a savings claim. The advice-rule test passes them on purpose; counsel or the founder should decide whether to soften them. The test also does not catch "compare", "cheaper", "save", "optimise", "better deal".

### 16.2 Regulatory line for the two risky promises

- **Optimisation: dropped as a promise.** Allowed: listing policies on file, renewal dates, duplicates, estimated shortfall labelled as an estimate, a pointer to a licensed professional. Not allowed: "too dear", "over-insured", ranking, "cancel/reduce/switch", cheaper or better cover, any "save" framing, any switch flow even as a draft. Safe names for the information view: Cover Check-up, Policy Review Pack, Cover Map, Renewal Ready. Do not use "optimise", "save", "better cover", "cover audit".
- **Claims: "claim-ready", never "we claim for you".** Allowed: find the policy and the contact printed in the policy papers, a documents-typically-needed list, time limits that appear in the policy, a claim folder, a short drafted notification (who, policy number, event, date) to the existing insurer for the family to edit and send. Not allowed: pre-filling the insurer's claim form, chasing or negotiating, judging validity, predicting payout, fee on recovery, referral to claims firms. Market analyst cites the FCA perimeter guidance (PERG 5.7, 2021 page) that completing a significant part of a claim form for a claimant can count as assisting in the performance of a contract of insurance. Treat as a working view; counsel must confirm.

### 16.3 The story architecture (so the page survives many more capabilities)

Problem: a feature-list landing page needs rewriting every time a capability ships. Fix: give users one stable story, and make capabilities data.

1. **Promise (never changes):** LifeKeel keeps your family steady. One picture of your family that Keel keeps current, so on a bad day you are not starting from zero.
2. **The spine: Ready before. Found during. Sorted after.** Every capability, present or future, belongs to exactly one moment:
   - Before: know where you stand (checks and detectors, cover on file, simulator, wills and papers on file).
   - During: find what you need (documents, steps, people told).
   - After: send what is ready (drafts, claim-ready pack, notifications).
   The spine maps to the architecture: Observe and Understand and Predict are Before; the vault, playbooks and continuity are During; Prepare is After. Act stays human-approved at every step.
3. **Everyone's view is a dimension, not a feature:** each adult has their own view, children a simpler one. New member-level capabilities extend the same board.
4. **The board is the roadmap made visible:** one list of capabilities, each with a moment and a status (Live or Planned). Adding a capability is adding one entry. Planned means intended, never promised. The concept page renders the board from a single data array.
5. **Admission test for any new capability before it earns a place on the page:**
   1. Which moment is it in?
   2. What does it read? It must be data on file inside the trust boundary (typed or confirmed from a document), never a transaction feed.
   3. What does it never do? Name the tier (0 to 3) and the rule-2 boundary. Its copy must pass the advice-rule test and a manual rule-2 read.
   4. Is the public claim true of the shipped product, and is it mapped to evidence (claims registry)?
   5. Can it be said in one line without a feature noun the user does not use (no "twin", "detector", "playbook"; use "check", "steps", "papers")?
6. **Vocabulary for users:** on file, check, steps, papers, cover, message (draft), letter. Avoid: twin, agent, detector, optimise, claim as a headline noun, protect, safe, guaranteed.
7. **Page template that scales:** Hero (the promise, Before in motion) then the sample day (the feel) then the spine and board (the whole picture) then one deep dive per moment, shown only for capabilities that are Live, then what Keel does not do, then signup. New capabilities add a board line and, when strong enough, a deep dive in the right moment. The page never grows a "features" grid.
8. **Honest roadmap rule:** planned items carry a text tag, not only a colour; nothing planned is described in the present tense; a capability moves from Planned to Live only when the code, tests and the claims registry entry exist.

### 16.4 Concept v6 (published at the same artifact link)

- Page order: hero (signup on the animated sea) then the sample family day then "Ready before. Found during. Sorted after." with the three-moment board (15 capabilities, Live or Planned) then Before: cover on file (sample table and lantern row) then During and after: when something happens (documents, steps, draft message, people told, plus a sample bereavement steps card) then six promises then the dawn signup close.
- Six promises now include "No switching advice" and "No claims made for you".
- Unverified items stay out of present-tense copy: emailed sign-in link, monthly letter, run counts, no-training claim, emergency access.

### 16.5 Backlog implications (ranked, from product owner; effort is a guess)

1. Make PRD-109/143 (document extraction into the policy register) reliable in production; "found during" and "sorted after" rely on it.
2. New PRD: claim-ready pack (one page per event with policies, contacts, document links and the Tier 1 drafts), about 1-2 weeks. Carries the event type through to the playbook, which the product council review found missing.
3. New PRD: cover-on-file view (policies by type, renewals, duplicate flag), about 1-2 weeks, with an advice-rule test over its copy.
4. New PRD: access for a named person outside the family. Tier 2, authenticated in-app approval, audit trail, revocation; needs counsel first. Time-delayed release stays out of scope.
5. Claims registry and extended advice-rule patterns (compare, cheaper, save, optimise, better deal; never, always, ever as claims needing evidence), about 3-5 days.
6. Remove "Not a vault." from `MarketingLanding.tsx` when the new page ships; soften the borderline detector action copy if the founder agrees.

### 16.6 Decisions for the founder

1. Confirm "insurance optimisation" is permanently dropped as a promise and replaced by cover on file.
2. Confirm the launch scope: three Live supporting claims proven true (papers, steps, cover on file), with claim-ready and named-person access shown only as Planned.
3. Counsel questions: is the estimated shortfall a personal recommendation; is a drafted notification to the family's own insurer outside arranging and claims assistance; named-person access (data protection, succession, capacity).
4. Plus packaging: keep playbooks, vault and access free; Plus reads policy documents and email. Charging for crisis access would damage trust.

### 16.7 Founder clarification: what "optimisation" and "claims" mean (decided in discussion)

Scope as stated by the founder: (1) spot duplicate cover, including where a husband and wife both hold the same cover; (2) spot missing cover; (3) show how to claim and the contact details. All three are information about what is on file and stay inside rule 2. The word "optimisation" stays off every public page; the feature names are cover on file, duplicate policies, missing cover, who to call, and how to claim.

Duplicate cover across partners: a new check, not yet built. Existing `policy-review.yaml` flags only the same type for the same holder.
- The check must be type-aware. Personal cover (life, income protection, critical illness, health) is held per person, so both partners holding it is expected and must never be flagged. Shared or household types (home buildings, home contents, travel, breakdown, gadget, pet) can legitimately overlap across partners and are the candidates.
- Output is "may be intended" wording only. Draft reasoning text: "Two [type] policies are on file, one for each partner. Some policies cover the whole household, so this may be intended. This is informational; your insurer or a licensed professional can confirm what each one covers." Do not use cancel, wasted, paying twice, cheaper, switch or save, and name no provider.
- Meets PRD-148's admission criteria only after: a golden dataset under `detector-evals/`, a jurisdiction tag (PRD-149), a stated way to tell it worked (dismissal that was correct), and an advice-rule test pass plus a manual rule-2 read. It needs policy holder per member (PRD-104/105 data) and a household flag on policy types.
- Also soften the existing borderline strings in `policy-review.yaml` and `protection-gap.yaml` ("wasted premiums", "switching providers", "Compare against current market quotes before renewing automatically") before the landing page shows duplicates as a feature. That wording edit is detector copy and needs the founder's or counsel's sign-off.

Missing cover: already Live for income protection, second-earner life cover, health or critical illness with dependants, and estate papers. Car and home have no adequacy checks, only renewal date and duplicates.

How to claim and contacts: the contact (from extracted or typed policy papers) and the draft message are Live. Plain-English "how to make a claim" for each kind of policy is Planned: general guidance on how to claim is unlikely to be a regulated activity, but it must never describe a named insurer's process, predict whether a claim will pay, or pre-fill the insurer's claim form. The claim-ready pack stays Planned. Counsel to confirm the PERG 5.7 reading.

Concept v7 shows the partner overlap check as a "Planned check" row on the sample cover card and as a Planned line on the board.

## 17. Creative direction (filmmaker's review) and concept v8

Not an expert-panel finding: a director's read of the concept by the author, recorded as the creative brief for PRD-209's build. Everything it shows must still pass the claim rules in section 16.

**Logline.** A family's boat rides out some weather. The weather is not the story. The story is what brings the boat back upright.

**Protagonist and cast.** The family, never faces. Each member is a boat: adults are full boats, children are smaller boats that trail in a parent's wake. Keel is the lamp and the weight below the waterline, never a character with a face or a voice. The antagonist is weather (life events), not catastrophe: no alarm colour, no sirens, no countdowns. The theme is steadiness, not safety. A keel does not stop the weather.

**Three acts, mapped to the product spine.**
- **Act I, Before (golden hour):** long calm takes. Establish the chart, the convoy, the lamp. The camera does not move; the world breathes (a four-second bob). Palette: teal and warm gold.
- **Act II, During (dusk):** the weather arrives. The camera stays steady, the boat leans, and a single brass light holds. This is where the playbook and papers live. Palette: indigo and one brass light.
- **Act III, After (dawn):** resolution. The boat is upright, the papers are handed over, a draft is ready and the family decides. Palette: peach and pale sky.

**Cinematography rules.**
- One continuous voyage: the sea persists across sections, and the page's colour grade changes with the act (day, dusk, dawn) so the whole page feels like one film rather than a stack of sections.
- No handheld shake, no whip pans, no flashes. Motion is slow and has a cause.
- Light is the only emphasis device: a lantern lights, a ring pulses once, the beam lingers on the thing noticed. Never red.
- Every animated fact has a text twin (the page works with the sound off and the motion off).

**The inversion shot (the idea that makes the name land).** Cut below the waterline: the cross-section of a boat where the weight of the keel, not the sail, is the hero. Papers, cover, savings and people are the four weights Keel keeps on file. "Send a squall" is the one interaction a visitor drives: the boat leans, the weight holds, the boat comes back upright. It explains the brand name and the product in one image, with no jargon.

**Opening sequence (first three seconds).** A slow exposure ramp from dim to day (1.8 seconds, background only, text never hidden), the headline already readable, the convoy sailing in. Complete at rest for anyone who pauses, or has reduced motion.

**What concept v8 now contains (browser-checked at 1280 and 390 wide, light and dark; contrast and screen-reader behaviour not re-run).**
- The family as a convoy: a lead boat and two smaller boats that trail it with different lags, so the group reads as a household without faces (the smallest is hidden on phones).
- The keel scene ("What keeps you steady is under the waterline") with a squall the visitor sends, a text status for each beat, a reduced-motion path that toggles between two static states, and a one-time autoplay when the scene is first in view.
- A light vignette and an exposure ramp on the hero (the vignette is kept faint because a heavier one dropped muted-text contrast below 4.5:1).
- Page-level colour grading by act.
- The sample family named ("the Ellis family"), still labelled as a sample.

**Shots designed but not yet built (ordered by value).**
1. The harbour chart reveal: the quay and berths draw on, each member's boat arrives at its berth, lanterns light for what is on file, and an unlit outline stays for what is not.
2. The marked route: a dotted course from the boat to waypoint lanterns ordered by date or playbook sequence, never by importance.
3. Time-lapse of the years: the sky cycles faster than life, a dinghy grows into a boat, new berths appear; planned capabilities arrive as dashed outlines.
4. A rack-focus on the lantern Keel noticed: the background softens briefly. Costly to animate, so use a crossfade to a pre-blurred layer, never an animated blur.
5. The end card: the dawn close as the final shot, the boat parked, the one signup form, and the disclaimer as the only text.

**Do not do.** Faces or stock people; a "dramatic" storm with rain and lightning; music or sound; a countdown or a pulsing button; any shot whose motion carries a fact its caption does not.

**Claim notes for the new scene.** "The weight below the waterline brings a boat back upright" is a physical statement and a metaphor. The four weights are categories Keel keeps on file, not guarantees. No claim that Keel "keeps you steady" in any outcome sense: the page says what Keel keeps in view, not what will happen.

### 17.1 Concept v9: the harbour chart reveal (built)

Shot 1 from the list above is now in the concept hero, replacing the earlier "boat sails to its runway distance" idea. The hero is a harbour at rest: the sample runway now drives the readout, the sky, the stars, the beam and how far the boats lean, not how far they have sailed.
- **Sequence (about 4 seconds, background only; the headline and signup card are readable throughout):** a chart graticule wipes across the water; a brass berth slip draws under each berth; the sample family sails in one boat at a time (two adults and two smaller boats, named Priya, Sam, Mia and Leo, all labelled as the sample Ellis family); names fade in; then the chart key lights its lanterns one by one.
- **The chart key:** Will, Life, Income, Home, Savings. Four lanterns light for what the sample family has on file and one dashed unlit outline stays for "Income, not on file", with the text "On file" or "Not on file" under each, so nothing is carried by colour or motion alone. It matches the sample cover-on-file table further down the page.
- **Reduced motion or paused:** every element is shown in its final state; pausing during the number count-up now settles the number on its final value (a mismatch between the number and the band label was found and fixed in browser testing).
- **Phone:** two boats and the key row, with the stage made taller so names and lanterns never overlap; the smaller boats are hidden.
- **Still sample:** every name and figure is made up and labelled; the lanterns say what a family has told Keel, not what it owns.
- **Checked:** layout at 1280 and 390 wide in light, dusk state included; no horizontal overflow. Not re-run: contrast on the new chips in every sea state in dark mode, and screen-reader reading order for the chart key.

### 17.2 Concept v10: the marked route (built)

Shot 2 is in the concept as its own section, "One short list, in a fixed order", placed after the keel scene and before the capability board.
- **What it shows:** a dotted course draws across the sea as the page scrolls, the sample family's boat follows the drawing edge, and a lantern lights as the course reaches each of six waypoints. Four are Live items and two are Planned items drawn as dashed unlit outlines. Below it, six cards (type, Live or Planned tag, what is on file, what Keel needs from you, what Keel does or will do).
- **Order rule, stated on the page:** dated items first, soonest first; then checks in the same order every time; never ranked by what matters most, because Keel cannot know that. Waypoints carry no numbers for the same reason; sequence is shown by position and the card order.
- **Honesty:** a single ordered list of next steps does not exist yet. It is the planned "Keel's path" work (PRD-150), so the section is headed "Planned: the next steps, in order", opens with "Today Keel shows these in different places", and the board gains a Planned line, "One ordered list of next steps". Each card carries its own tag: renewal dates, the income-protection check and the steps with a draft message are Live; duplicate cover across partners and the claim-ready pack are Planned. Dates and figures are made up and labelled.
- **Motion:** the scrub only runs when the section starts below the fold and motion is on; otherwise, or when paused, or with reduced motion, the course is shown complete. Scroll handling is one passive listener throttled to animation frames.
- **Checked:** the scrub (halfway and complete) and the card layout at 1280 wide, and the phone layout at 390 wide with no overflow. Not re-run: contrast of the new tags in dark mode, and screen-reader reading order of the cards.

### 17.3 Concept v11: the years time-lapse (built)

Shot 3 is in the concept as "The same chart, as life changes", after the marked route.
- **What it shows:** four stages of a sample family (First home, A first child, Growing up, Later years). Moving through them changes the season of the sky (spring, summer, autumn, winter) and the position of the sun; the child's small boat appears and grows; a new berth slip draws on for each boat that joins; and the lanterns arrive in the sky, the Live ones solid and lit, the Planned ones as dashed outlines.
- **Control:** a native radio group (arrow keys, visible focus) rather than scroll-scrubbing, so it works on a keyboard and a phone; the stages also autoplay once when the scene is first in view, only if motion is on, and stop at the first interaction. With reduced motion or Pause there is no autoplay and state changes are instant. A polite status line announces the stage, its line and what is new, on user action only.
- **Data driven:** the stages and lanterns are two arrays; adding a stage or a capability is adding a line. There are eight lanterns: five Live (papers on file, home policy and renewal date, education savings checks, cover estimate counting a dependant, retirement gap check) and three Planned (a dedicated view for caring for a parent, access for a named person outside the family, new checks for new life events).
- **Honesty:** the page says planned items are never described as available; the sample family is made up; a line states that nothing predicts how a real family will change. No child-specific view is claimed, because the audit rated it limited.
- **Checked:** stages 1, 3 and 4 at 1280 wide and stage 3 at 390 wide, with no overflow. Not re-run: dark-mode contrast of the season tints, and screen-reader behaviour of the status line.

## 18. One brand and one story across the platform (UI and UX reviews, reconciled)

Two reviewers audited the real app against concept v11. Their findings are inputs, not verified fact: neither read every screen (the UI review skipped vault, life-event, member and login pages; the UX review skipped several PRDs and the member, insights and documents pages), so every per-screen proposal needs a check against the code before a build.

### 18.1 What the audit found

- **Two brands.** Landing concept: deep sea and brass, serif display, hairlines, lanterns. Signed-in app: indigo accent (about 450 uses of `family-500` across 89 files), Inter only, glass cards with blur and tilt, glowing red/amber/green score rings, animated mesh orbs. Logo lockups reference a font (Fraunces) that is not loaded anywhere; email buttons use two different purples; the manifest, emails and logo comment still say "digital twin"; the social image and icon are blue-teal; the PWA theme colour is dark-only.
- **Two stories.** The landing promises a chart kept current, "on file", lanterns, Live/Planned, before-during-after. The app's words are score, profile, insights, readiness and AI. Ten breaks were listed; the worst: onboarding says "Building your digital twin" and "Growing your Keel"; the app's hero is a readiness score and a green "You're on track"; the welcome carousel says "Nothing trains models" and "Be Ready for Anything"; navigation maps to nothing in the spine; "Digital Estate Vault" vs "papers"; the "Inbox" is a feed of findings whose subtitle says "what to do next"; empty and nothing-ran states are green or vague; no Live/Planned honesty anywhere in the app.

### 18.2 Decisions (where the two reviews agreed or were reconciled)

1. **The spine becomes the organising principle of Home, not a set of tabs.** Navigation keeps the user's own nouns: **Home, Your family, Papers, Steps, Notices** (down from six), with Settings behind an avatar menu. "Digital Estate Vault" becomes "Papers", "Inbox" becomes "Notices", "Events" and "Life events" merge into "Steps", "Keel Plus" becomes "Plus" with the tagline limited to what is true.
2. **One status vocabulary, used everywhere:** On file (lit lantern), Not on file (dashed outline), Noticed (ringed lantern, one per screen), Handled (set only by a person, never by Keel), Paused, plus a neutral "Couldn't check" shown whenever a check has no run record (never green). Text always accompanies the icon; colour and motion never carry meaning alone.
3. **Reconciliation: "Planned".** The UI review keeps Planned off the signed-in app (it is not a user state); the UX review lists it as a state. Decision: Planned appears only on marketing and roadmap surfaces and in Plus explanations; it is not part of the in-app status chip.
4. **Reconciliation: the score.** The UI review replaces the glowing ring with a flat waterline gauge; the UX review says the score should stop being the hero. Decision: demote the score and show it, as a small flat gauge with no glow, no green and neutral wording below 40, only once enough is on file for the checks to run. The hero of Home is the chart and the single next step.
5. **Serif for display moments only** (page titles, big numbers, empty-state headlines, email headings); dense screens, forms and tables stay in the sans face; mono for labels, dates and amounts. Brass is the accent; rust is the error colour and is never used for risk or score; no glow, no traffic-light rings, no red alarm.
6. **The metaphor lives on Home, in the empty first-run state and in onboarding.** Dense screens (notices, papers list, settings) use plain words and the status chip only. If a screen needs a lantern to be understood, rewrite the screen. Playbook and claims screens use the calm static variant.
7. **First run is the same story as the landing:** the harbour starts empty, the first thing added lights the first lantern, and the aha moment is something of the user's own on the chart with its date and source, not a score. Empty, partial, all-clear and nothing-ran states are written out and honest. Do not show "on track", "checks daily", "not used for training" or any Planned item in the present tense until true.
8. **Proactive message pattern, in this order:** Noticed (with date), Source, What you might do (a licensed professional, never a product), What Keel has not done; with "Why am I seeing this" and "That's not right" on every notice.
9. **Rule for porting landing language into the app:** nothing ships in the app ahead of the capability. The marked route, the cover-on-file view, the monthly letter and run records do not exist yet; they stay Planned until PRD-150, PRD-151 and PRD-138 land.

### 18.3 Rollout (smallest changes first; effort estimates are the reviewers' guesses)

| Phase | Work | Days |
|---|---|---|
| 0 | Words only: nav and page titles, remove "digital twin", "Growing your Keel", the score as hero, "Nothing trains models" and "Be Ready for Anything"; rewrite empty states; add the strings to the banned-word scan. In parallel: final mark, lockups, icons, social image, manifest and `docs/brand.md` (also delete the Fraunces reference and drop "digital twin" from the manifest and emails). | about 3 to 4 |
| 1 | Tokens in one file, self-hosted fonts, an `html` brand flag that remaps existing variables so the 89 files need no edit; a single `StatusChip` with the states above; dated all-clear instead of "on track"; "Why am I seeing this" and "That's not right" on notices. The one risky edit is moving the fixed indigo hex to a variable. Add a token contrast test. | about 6 to 8 |
| 2 | Nav shell with the mark on phone too, flat card variant, Home header with a "last checked" line, the empty-harbour first run | about 6 to 9 |
| 3 | IA merge (Your family, Steps, Notices, Papers) and `responsive.spec.ts` route updates | about 8 |
| 4 | The chart on Home with an accessible list alternative, reduced-motion and forced-colours variants; waterline gauge; vault, cover, notice and steps screens in the new language | about 10 to 12 |
| 5 | Auth pages, 404 and error states, emails (one shared layout), native shell splash and status bar colours; one shared copy and status module for landing and app with a banned-word test that fails in both | about 6 |
| 6 | Visual regression shots, Slovenian pass, accessibility audit, flag on by default, retire old code | about 4 |

Roughly 30 to 36 working days in total; phases 0 to 2 (about 15 to 20 days) deliver most of the consistency with no redesign. Keep the flag off by default until phase 4 is stable.

### 18.4 Research to run first
Vocabulary and first-click test on the new nav labels; a comprehension test of the status states in icon-and-text and in greyscale; a moderated first-run test with couples (time to first lantern, whether people believe the empty harbour); a trust study of dated all-clear and "couldn't check" screens; an accessibility study (screen reader, low vision, reduced motion) on the chart and its list alternative, plus a parent review of the children's view.

### 18.5 Risks
Metaphor fatigue and over-decorating dense screens; promise-versus-product mismatch (the biggest); a single colour flip changing contrast in many files (gate with the token test and screenshots); Slovenian text runs 20 to 30 percent longer and the idioms ("on file", "steps", "papers") may not translate, so write a glossary with Slovenian equivalents before phase 3; two surfaces drifting apart unless they share one copy module; advice-rule drift in notice copy.

### 17.4 Concept v12: qualifiers on every Live tag (built)

The capability board now shows a short condition under each Live item, so "Live" is never read as always-on or unconditional. The legend says so in words: Live means you can use it today within the note beside it, it does not mean always on, and it does not mean it covers everything. Planned items carry no qualifier.

Qualifiers as written (each to be mapped to its evidence in the claims registry before launch):
- Works from the figures you enter: emergency fund and savings runway; retirement and education pace; debt health.
- Rough estimates from what you enter, and Keel does not read policy wording: life, income and health cover on file.
- Reminders are opt-in; duplicates are flagged for the same person only: policy renewals and duplicate policies.
- Checks whether you have added them, and Keel cannot judge a will: wills and papers on file.
- A rehearsal on your figures, not a forecast: the "what if" runway simulator.
- Adults who have joined your household; passphrase sealing is optional and has no recovery: documents your family's adults can open.
- Starts when you say what happened: steps for seven kinds of bad day.
- Opt-in, off by default; it points them to papers they can already open: emails to people you name if you go quiet.
- Only if the contact is on file; reading an uploaded policy needs Keel Plus: who to call, from your policy papers.
- You edit it and send it; Keel never sends it: draft message to your own insurer.

Checked at 1280 and 390 wide with no overflow. For the real build, each qualifier is a field on the capability entry, so adding a Live capability without one should fail the claims-registry test. The paid plan is called "Keel Plus" in the concept; the UX review proposes renaming it "Plus" in the app, so settle one name before launch.

## 19. Positioning decision: a platform in function (founder, after concept v12)

Decision: present LifeKeel as a platform rather than a single product, **in function**: one home for the family, where capabilities join the same chart over time, shown by the board and the chart.

What changed in concept v13 and in PRD-209:
- Hero headline is now "Your family's chart, kept current." (the earlier "A calm check on your family's savings, cover and paperwork" described one check, not a home). The lede opens with "One home for your family's savings, cover and papers."
- The board's eyebrow is "One home for the family", and its intro carries the page's only use of the word: "LifeKeel is one platform for your family's picture, and it is useful at three different moments... Everything on it comes from what you add." The legend adds: each capability joins the same chart, one at a time, and says whether it is Live or Planned.
- Rules recorded in the PRD: "platform" at most once and never in a headline or the brand line; no "app", "tool" or "product" in headlines; no implication of partners, integrations, connected accounts, a marketplace, an ecosystem, an API or third-party providers; a copy test counts the word and bans `marketplace`, `ecosystem`, `integrations?`, `open banking` and `API`.
- Why the restraint: "platform" invites readers to assume integrations and a partner network. LifeKeel's differentiator is neutrality (no commissions, no provider steering), PRD-207 only allows flat-fee distribution partners, and the app does not connect to bank accounts. The word is therefore carried by structure (the board, the chart, Live and Planned) and not by claims.
- Related: the next-step list is still a preview. "Everything on it comes from what you add" is the wording to check against email connection, which is optional; confirm with the claims registry before launch.

# Product roadmap — 2026-10

Product-owner synthesis of the five October feedback inputs, refined into an
implementation sequence. Source material:
[qa-critic-review-2026-10-24.md](qa-critic-review-2026-10-24.md) (QA run,
critic review, multi-device pass, PMF report, expert panel — all mapped) and
`docs/intents/` 20–39. Existing numbered PRDs are referenced, not duplicated.

## The one-line strategy

Every input independently converged on the same diagnosis: **the product
works when the data is clean, and breaks trust exactly when it isn't.** The
roadmap therefore sequences *trust → activation → habit → revenue →
differentiation*, in that order, because the expert panel's conclusion is
correct — conversion cannot precede belief.

## Wave 0 — stop the bleeding (bugs, reproduce-first)

Fast-path fixes, not PRDs. Each may resolve to a small PR once root-caused.

| Intent | Item | Why first |
|---|---|---|
| 34 | ~~"Create Family Group" shown to accounts that have a family~~ **implemented — PR #243** | Was a transient-failure collapse on mount, not a race; now a retry state. |
| 29 | OTP intermittency; `example.com` addresses fail | **partially implemented — PR #244** — deterministic test path; live-env reproduction open. |
| 30 | Ask Keel previous-answer bleed; occasional lag | **implemented — PR #245** — no server bleed path found; answers now carry `data_as_of`. |
| 31 | Billing unlock verification | **verified — sandbox e2e** (real `cs_test_` checkout + signed webhook → starter plan + credits; replay idempotent) |

**Exit:** each item reproduced, root-caused, fixed or filed as a defect.

## Wave 1 — trust the number

The two Fails and their shared root cause (honesty under imperfect data).

| Intent | Item | Notes |
|---|---|---|
| 20 | Score calibration + "Why this score" component expander | **implemented — PR #246**: expander shipped; personas pinned (72 healthy / 14 stressed — shape sound, no weight change). |
| 21 | Scenario partial-data honesty | **implemented — PR #247**: missing-inputs named via `missing_inputs`; annual-expense fallback added; not-found path already sound. |
| 22 | Derived-surface freshness | **implemented — PR #248**: re-fire now refreshes an open insight's figures (`refreshed_at`); root cause was the open-match skip. |

**Re-test gate:** the QA persona set re-run — young couple / first-home
profile lands in the 50–65 band, high-debt self-employed in 20–35, and no
persona ever sees sample copy or a missing event on real data.

## Wave 2 — first-run value & the second adult

Make free tier earn its keep, and turn the solo tool into a household tool —
the expert panel's #1 conversion lever after trust.

| Intent | Item | Notes |
|---|---|---|
| 27 | Upload feedback loop | **partial — PR #249** (progress bar; toast/status/upsell existed; renewal-date field open) |
| 28 + 37 | Wizard validation/autosave/resume | **implemented — PRs #254 + #257** (blur validation + first-incomplete-step resume; rest pre-existing) |
| 23 | Invite share + status | **partial — PR #250** (share sheet + "Waiting for X" sent status; opened/viewed tracking needs API state) |
| 24 | Severity signalling | **implemented — PR #251** (band + chip; urgent-first sort not yet added) |
| 35 | Mobile nav collapse + tablet layout | **partial — PR #255** (5-item mobile bar done; tablet two-column open) |
| 36 | Accessibility baseline audit | **done** — static pass clean + label fixes; assistive-tech walkthrough still open. |

**Re-test gate:** mobile easiness ≥8/10; signup→profile→first-insight
completable one-handed with interruption; invite completable via share
sheet with visible status; a second adult's join confirmed in-product.

## Wave 3 — depth and habit

Now that the product is trusted and usable, deepen the family model and add
the quiet-engagement layer the PRD backlog already plans.

| Item | Source | Notes |
|---|---|---|
| Blended-family relationship labels | intent 25 — **implemented, PR #252** (`relationship_label` on child members) | Lowest-scoring persona in the critic review; chart surface still open. |
| Variable-income capture | intent 26 — **implemented, PR #253** | `income_notes` verbatim field; second-earner already covered by PRD-104. |
| Premium history + price-creep alert | intent 38 — **implemented, PR #258** | `premium_history` + `premium_increased` rule + evals + wizard round-trip. |
| Readiness feed + Quiet Care digest | PRD-136, 138 (proposed) | The engagement engine: opened even when nothing is wrong. Sequenced after 23 so digests can reach the second adult. |
| Notification tiers/caps + channel fallback | PRD-139, 140 (proposed) | Ships with 136/138 — cadence without calm is spam. |

**Re-test gate:** blended and self-employed personas re-run; a family that
changes nothing still receives an honest "checked, nothing moved" digest.

## Wave 4 — revenue readiness

Gated on Wave 0's billing verification being green.

| Item | Source | Notes |
|---|---|---|
| Founder decisions (gate) | intent 39 | (a) free/Plus line — manual-everything+stored-doc free vs Plus-removes-typing; (b) annual price point shown as monthly-equivalent; (c) emergency pack: file-only (PRD-220) vs hosted executor-shared — a trust-tier decision, not drift. |
| Packaging + paywall moments | intent 39 → PRD-006/206 | Post-upload "Plus reads the rest and keeps {partner} in the loop"; annual plan frame. |
| Billing cutover | PRD-006 | Dormant Stripe path to production, after 31 verifies the loop. |
| Reviewed extraction pipeline | PRD-143 (proposed) | The Plus headline feature; confirm-before-commit gate. |

## Wave 5 — differentiation

| Item | Source | Notes |
|---|---|---|
| Crisis mode — dashboard reduced to 3 next actions | intent 33 — **implemented, PR #262** | opt-in on event page; reuses EVENT_ACTIONS. |
| Retirement "close the gap" estimate | intent 32 — **implemented, PR #259** | estimate endpoint + contribution slider on /events/retirement. |
| Legacy map | PRD-137 (proposed) | Estate depth beyond vault booleans; includes the checklist/solicitor-pointer idea (generic pointers only). |
| Partner/adviser channel | PRD-207 (proposed) | Counsel first; zero-commission constraint recorded. |

## Explicitly not on this roadmap

- Free-tier AI extraction (founder decision; intent 39 carries the proposed
  line — extraction stays Plus until decided otherwise).
- Market price comparison / "better policy" suggestions — rule 2,
  permanently.
- Any autonomous execution beyond prepare-only drafts — trust tiers.
- Hosted executor-shared emergency pack — decision pending (intent 39c),
  not a build item until decided.

## Dependencies that constrain ordering

- 24 ← 20 (severity display leans on score components).
- 39's paywall moment ← 27 (needs the post-upload state to hang it on).
- 136/138 family digests ← 23 (worthless until a second adult can join).
- 38 ← premium history on the policy record; later fed by PRD-143.
- 33 ← PRD-108 + 24.
- Wave 4 ← 31 green (never sell an unverified checkout).

## How we'll know it worked

1. QA persona battery re-run: score bands land as expected; zero silent
   fallbacks; blended/high-debt/self-employed all usable.
2. Mobile easiness 6 → ≥8; signup and profile completable one-handed.
3. Second-adult join rate becomes a tracked funnel step (invite sent →
   opened → joined).
4. Free-tier "aha" measurable: upload → stored confirmation → runway seen.
5. Plus upgrade moments convert on demonstrated value, not a timer —
   measured per PRD-206's event discipline.

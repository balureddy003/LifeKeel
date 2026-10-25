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
| 29 | OTP intermittency; `example.com` addresses fail | The front door. Every downstream metric is multiplied by signup success. |
| 30 | Ask Keel previous-answer bleed; occasional lag | **implemented — PR #245** — no server bleed path found; answers now carry `data_as_of`. |
| 31 | Sandbox checkout → webhook → Plus unlock never verified e2e | Cheap to verify now; must be green before any Wave 4 monetization push. |

**Exit:** each item reproduced, root-caused, fixed or filed as a defect.

## Wave 1 — trust the number

The two Fails and their shared root cause (honesty under imperfect data).

| Intent | Item | Notes |
|---|---|---|
| 20 | Score calibration + "Why this score" component expander | Components already computed and returned (`GET /family/readiness`); this is mostly a *surface* plus a calibration pass against the persona set. The single most-cited fix across all five inputs. |
| 21 | Scenario partial-data honesty | **implemented — PR #247**: missing-inputs named via `missing_inputs`; annual-expense fallback added; not-found path already sound. |
| 22 | Derived-surface freshness after profile/policy edits | Score already recomputes per-read; insight/explanation text needs the same guarantee or a visible recalculated-at provenance. |

**Re-test gate:** the QA persona set re-run — young couple / first-home
profile lands in the 50–65 band, high-debt self-employed in 20–35, and no
persona ever sees sample copy or a missing event on real data.

## Wave 2 — first-run value & the second adult

Make free tier earn its keep, and turn the solo tool into a household tool —
the expert panel's #1 conversion lever after trust.

| Intent | Item | Notes |
|---|---|---|
| 27 | Upload feedback loop: progress, "Document stored", honest Plus mention | The free "aha": effort in → visible value out, before any paywall. |
| 28 + 37 | Wizard inline validation, pre-fill, per-step autosave, "Continue setup", numeric input modes, cross-device resume | One piece of work — the interruptible, forgiving form. Mobile-first: validation above the keyboard. |
| 23 | Invite: share-sheet link, resend, sent/opened/waiting status | "As easy as sharing a calendar invite." The family loop feeds retention *and* conversion. |
| 24 | Severity signalling: urgent-first sort, colour/icon band, debt-pressure state | Must scan one-handed on a phone; pairs with 20's expander. |
| 35 | Mobile nav collapse at 390px; deliberate tablet layout | Mobile is the primary device for the target user (a busy parent); 6/10 easiness is the floor, not the ceiling. |
| 36 | Accessibility baseline audit → fixes | Keyboard-only setup verified; axe or equivalent kept green. Runs in parallel — cheap, mostly mechanical. |

**Re-test gate:** mobile easiness ≥8/10; signup→profile→first-insight
completable one-handed with interruption; invite completable via share
sheet with visible status; a second adult's join confirmed in-product.

## Wave 3 — depth and habit

Now that the product is trusted and usable, deepen the family model and add
the quiet-engagement layer the PRD backlog already plans.

| Item | Source | Notes |
|---|---|---|
| Blended-family relationship labels | intent 25 — **implemented, PR #252** (`relationship_label` on child members) | Lowest-scoring persona in the critic review; chart surface still open. |
| Variable-income capture (second-earner prominence + income notes) | intent 26 | Business-owner persona's top gap. |
| Premium history + price-creep alert | intent 38 | Rule-2 edge — informational on *own* data only; copy review required. Needs premium-history on the policy record (PRD-143 later). |
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
| Crisis mode — three next actions | intent 33 | Needs PRD-108 playbooks + intent 24's severity. The "rely on it on the worst day" payoff of the whole strategy. |
| Retirement gap-closure estimate | intent 32 | Advice-rule-sensitive; arithmetic on own inputs only. |
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

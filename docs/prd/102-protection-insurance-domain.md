# PRD-102: Protection (insurance) as a first-class domain

## Problem

ARCHITECTURE.md's vision names Protection as one of six Family Twin
domains. Today it's not a domain at all — it's two fields bolted onto the
financial-profile schema (`life_cover_minor`, `income_protection_monthly_minor`
in [family-financial-profile.ts](../../apps/api/src/routes/family-financial-profile.ts))
that feed exactly two detector rules in
[protection-gap.yaml](../../detectors/family/protection-gap.yaml): "no life
cover for the household need" and "no income protection." There's no
policy-level model (provider, policy number, coverage type, renewal date,
exclusions), no health/critical-illness cover tracking, and nothing
re-evaluates when a policy is about to lapse.

## Market bar

See [000-market-landscape-and-positioning.md](000-market-landscape-and-positioning.md).
Policygenius/Ladder-style tools compute a coverage number once against a
calculator input and stop — they don't know if the family's situation
changed six months later. Trustworthy stores policy documents but doesn't
reason about whether they're adequate. Agent Oak's differentiated bar:
**continuously monitored, whole-family, reasoning-backed coverage
tracking** — something neither category does today.

## Who it's for

Families who've answered "yes, I have life insurance" in onboarding but
have no idea if £250k of 2019-vintage cover is still adequate against a
2026 mortgage, or whether their health/critical-illness cover has silently
lapsed.

## What "done" looks like

A `policies[]` array in the financial-profile schema — type (life, income
protection, health, critical illness), provider, coverage amount, monthly
premium, renewal date, and (optional, doc-upload-populated) exclusions —
replacing the current two flat fields. Two new detector rules alongside
the existing protection-gap ones: a renewal-window alert (policy renewing
within 60 days) and a coverage-type gap (household has dependents but no
critical-illness or health cover listed). The existing document-upload/OCR
pipeline becomes the primary intake channel per the "Data-intake
principle" already stated in ARCHITECTURE.md — a paid-tier user who
uploads a policy PDF gets fields extracted into `policies[]`, not just
stored as an opaque file.

## Trust tier

**Tier 0 — Observe/Understand/Predict**, same posture as every existing
detector. No claims filing, no policy purchasing, no contact with any
insurer. That's Action Network territory (ARCHITECTURE.md roadmap item 5)
and explicitly out of scope here.

## Scope

Follows the exact 3-step convention CLAUDE.md already documents for adding
a family signal:

1. Extend the financial-profile schema in `family-financial-profile.ts`
   with a `policies[]` array (zod schema), replacing/supplementing the two
   flat `*_minor` fields (keep them as computed roll-ups for backward
   compatibility with the existing two protection-gap rules).
2. Extend `detectors/family/protection-gap.yaml` with the two new rules;
   consider a sibling `protection-coverage-gap.yaml` if the rule count
   grows unwieldy.
3. Surface a policies section in `apps/web`'s financial-profile form (a
   5th step, or folded into the existing Household & Protection step) and
   on the Home "Protection" card, which today just shows a static label
   ("Includes Life Insurance, Health Insurance") regardless of what's
   actually on file.
4. Extend the OCR field-extraction mapping (`documents.ts` + `ocr/*.ts`) to
   populate `policies[]` fields when a policy document is uploaded on a
   paid plan.

Out of scope: insurer API integrations, claims automation, and anything
Tier 1+ (drafting a coverage-review request is PRD-103's territory, once
this domain's detectors exist to trigger it).

## Success metrics

- **% of households with ≥1 policy in `policies[]`** within 30 days of
  signup — the domain is worthless if nobody populates it; track uptake
  the same way the existing financial-profile completion rate presumably
  already is.
- **Renewal-window detector precision** — of policies flagged as
  "renewing soon," what fraction the user confirms is actually still
  active/relevant (vs. a stale or cancelled policy still on file). A noisy
  renewal detector erodes trust in every other insight faster than a
  missing feature would.
- **OCR-populated vs. manually-entered policy ratio** — the data-intake
  principle only holds if OCR is doing real work; if it stays near 0%,
  the paid-tier extraction pipeline isn't pulling its weight for this
  domain specifically.

## Acceptance criteria

- `POST /family/financial-profile` accepts and persists a `policies[]`
  array; existing 4 detectors continue to pass unchanged (regression).
- New renewal-window rule fires against a fixture policy renewing in <60
  days and does not fire for one renewing in 200 days.
- New coverage-type-gap rule fires for a household with children and zero
  health/critical-illness policies listed.
- Home's Protection card reflects real policy count/status instead of the
  current static label.

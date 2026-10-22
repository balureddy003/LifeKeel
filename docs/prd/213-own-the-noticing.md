# PRD-213: Own the noticing — detector depth, drift sentinels, delivery quality (Phase 2)

## Problem

LifeKeel's defensible uniqueness is that it *notices* — a structured twin plus
detectors that surface what changed unprompted. Today that layer works but is
shallow: nine detector families against a family's full protection surface,
drift signals without per-family calibration, and delivery quality that is
functional rather than excellent. Competitors cannot replicate noticing
without the twin; deepening it compounds. This phase deliberately invests in
the surface chat cannot replace.

## Who it's for

Families (earlier, more accurate, better-timed signals); product (the moat);
engineering (detector authoring cost via LLM-as-compiler).

## What "done" looks like

1. **Detector coverage**: each detector family audited against the family's
   protection surface (policies, members, estate, cash flow, renewal windows);
   new signals land via the add-detector skill — schema extension, YAML,
   golden evals, web form. New YAML candidates may be *drafted* by a strong
   hosted model offline (LLM-as-compiler, pattern P1) but ship only through
   human review plus `detector-evals/` plus `advice-rule.test.ts`.
2. **Drift Sentinels (M4)**: life-event detection from data the family
   already supplied gets per-family calibration — a held-out window, explicit
   abstention zone, and measured precision/recall before any nudge widens.
   Unreported-change detection (PRD-111) stays information-only.
3. **Delivery quality**: delivery-judge shadow comparisons drive
   `shadow_more_permissive` to zero at real volume before any authority
   change; notification tiers/caps (PRD-139) tuned on perceived-protection
   metrics (PRD-141), not raw counts.
4. **Freshness honesty**: answers and cards carry data freshness; stale
   inputs visibly degrade claims rather than silently persisting (builds on
   PRD-145).

## Constraints

- **Trust tier:** 0 — all outputs remain insights and nudges; nothing acts.
- **Regulated-advice check:** all new detector copy passes
  `advice-rule.test.ts`; gap estimates stay informational with the
  licensed-professional framing (CLAUDE.md rule 2 — no provider naming, no
  switching flows).
- **Data/privacy:** model-drafted detector YAML is build-time only and never
  sees family content (rule 3); drift detection runs on in-infra data only;
  Gmail-derived signals stay excluded from cross-tenant scorers (PRD-142
  amendment).

## Builds on

PRD-148 (detector roadmap), PRD-111 (drift), shadow-judge infrastructure;
mechanisms review M4; `proprietary-mechanisms-and-future-architecture-2026-10.md`.

## Success metrics

Detector coverage mapped against protection surface (target: every major
protection state has a detector or a documented reason not to); drift sentinel
precision above the abstention threshold on held-out windows;
`shadow_more_permissive` = 0 over a 30-day window; perceived-protection
metrics trending.

## Out of scope

Act-layer execution (Tier 2+), external transaction feeds, any model training
on family content, chat UX work.

## Open questions

Order of detector expansion: protection gaps vs estate depth vs cash-flow
signals — pick by perceived-protection data from PRD-141?

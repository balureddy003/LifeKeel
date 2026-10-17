# PRD-114: composite Family Readiness Score (server-side, with estate component)

## Problem

The headline number on the family dashboard — the Family Readiness Score
the product vision calls Keel HQ's core readout — was computed **in the
browser**, as `100 − Σ(confidence × 10)` over open insights
(`fetchFamilyReadinessScore()` in
[api.ts](../../apps/web/src/lib/api.ts)). Three real consequences of
that:

1. **The score couldn't see the estate dimension at all.** The vision
   names "emergency funds, insurance coverage, and estate completion" as
   the composite's components; the client math had no estate input
   because the vault deliberately never exposes its contents as list
   data to non-adults, and the insights list has no estate detector. A
   family with an empty vault scored identically to one with a will and
   POA filed.
2. **The score penalized symptoms, not substance.** A detector firing
   twice on the same underlying gap (two rules, same cause) double-
   penalized; a detector that had never run scored identically to one
   that ran and found nothing — the `insights_evaluated_at` check in the
   old code was a patch on exactly this confusion, not a fix for it.
3. **The score couldn't be reasoned about server-side.** Ask Keel, the
   inbox, and any future composite surface (member twins, digest email)
   would each need their own copy of the penalty math to agree with the
   dashboard.

## Who it's for

Every authenticated family member looking at the dashboard — and every
surface that wants to show or reason about readiness without duplicating
scoring logic.

## What "done" looks like

- `GET /family/readiness` (added to
  [family-readiness.ts](../../apps/api/src/routes/family-readiness.ts))
  returns a **server-computed composite** built from deterministic
  subscores in
  [readiness/score.ts](../../apps/api/src/readiness/score.ts) —
  computed fresh on every read from the current financial profile and
  vault contents, the same "numbers stay live, never frozen at write
  time" posture as `render-playbook.ts`.
- Components: `emergency_fund`, `protection`, `retirement`, `education`,
  and `estate` — the last scored from vault `doc_type` coverage (a new
  field on vault uploads; will/POA/policy-document buckets). Each
  component carries its score, weight, a human-readable `detail` string,
  and the open insights that explain a drop, so the UI can show *why*
  without a second fetch.
- The estate component is **gated to adults** — vault contents are
  adult-only (see vault.ts), so a child's call returns the same response
  with `estate.gated: true` and the composite reweighted over the
  remaining components.
- `has_live_data` preserves the honesty rule the old client code only
  approximated: a profile saved by wizard autosave but never evaluated
  reports no score, never a flattering default.
- `apps/web` consumes the server score when reachable; the legacy
  penalty math survives only as the labeled offline fallback, and the
  health-domain UI gains the `estate` domain alongside protection /
  wealth / goals / savings.
- The vault upload flow gains a document-type picker so "estate
  completion" is measured against *declared* document purpose, not
  filename guessing.

## Trust tier

**Tier 0 — pure read.** No side effects, no advice; component detail
strings describe what's on file ("3 of 6 estate document types filed"),
never "you should get X."

## Scope

In: the scoring module, the route, vault `doc_type`, web consumption,
the estate domain UI, tests at both levels.

Out: per-member readiness splits (that's PRD-117's member-twin read
model), any estate detector or insight for missing document types (the
score's `detail` string is the explanation for now), and any change to
vault access control — `doc_type` is metadata, not a new permission.

## Acceptance criteria

- [x] `GET /family/readiness` returns composite score + per-component
      subscores + explaining insights, tenant-scoped.
- [x] Estate component reflects vault `doc_type` coverage; invisible to
      child members (`gated`, excluded from composite).
- [x] No profile / profile never evaluated → `score: null`,
      `has_live_data: false`.
- [x] Invalid `doc_type` on vault upload → 400; stored type returned in
      document listing.
- [x] Web shows server score and estate domain when reachable; clearly
      labeled sample/fallback behavior when not.
- [x] Unit tests for `computeReadiness`; route tests for auth, no-data,
      populated, child-gated, and tenant-isolation cases.

## Implementation status — 2026-09

Shipped this session: `readiness/score.ts` + `GET /family/readiness`,
vault `doc_type` (upload + list + web picker), estate domain in the
health UI, server-authoritative `fetchFamilyReadinessScore()` with the
legacy math demoted to offline fallback. Tests: `readiness/__tests__/
score.test.ts`, `routes/__tests__/family-readiness.test.ts`, vault
`doc_type` case in `routes/__tests__/vault.test.ts`, updated web
`api.test.ts` readiness block.

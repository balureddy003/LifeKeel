# PRD-212: Verified-answer resolver — deterministic answers with provenance (Phase 1)

## Problem

Most Ask Keel questions are factual lookups over structured data the family
already gave us ("how much emergency savings", "when does the car policy
renew"). Today every one of them pays for a model call that is slower, less
accurate, and less auditable than reading the record directly — and under the
local-serving experiment, was never answered at all. The twin already owns the
facts; nothing resolves natural-language questions to them without a model.
This tier is also the product's provenance story: an answer that says
"£9,000 — from your profile, updated 12 Oct" is verifiable in a way no
generated answer can be.

## Who it's for

Families (fast, verifiable answers); engineering (most questions stop paying
model cost); the trust story (numbers come from computation, never inference).

## What "done" looks like

1. A new task class `assistant.answer_verified.v1` in
   `definitions/ai-tasks.yaml` — `data_boundary: lifekeel_infra`,
   `allowed_processors: [ollama]`, deadline ~2s, no hosted fallback — under
   which the resolver runs. (Its *tooling* may use a tiny local intent
   classifier or none at all; it makes no generative call.)
2. `/assistant/ask` routes: intent resolve → if it maps to an **approved
   read operation**, execute it with tenant/member authorization, compute in
   code, render a reviewed template with provenance (source field + last-
   updated) and freshness. Ambiguous questions produce a clarification, not
   a guess. Unresolvable questions fall through to generation (PRD-211's
   hosted path, or the quarantined local path for sensitive queries).
3. v1 operation set covers the measured common cases: emergency-fund balance
   and months of cover; policy list/renewal dates; readiness score + its
   components; savings goals; scenario "what-if" projections (already
   deterministic in `projectScenario`).
4. Numbers in rendered answers are presence-checked against the computed
   result — extending the ungrounded-number guard from *forbid* to *require*
   on this path (ARCHITECTURE.md §8.4b).
5. Caching (where added) keys on tenant + member authorization scope +
   operation + data version + calculation version — never a raw text
   similarity across members.
6. The **generation-escape rate** (share of asks that fell through to a
   generative call) is instrumented per route and reported weekly.

## Constraints

- **Trust tier:** 0. Read-only operations over data the member is already
  authorized to see.
- **Regulated-advice check:** verified answers state what is on file and what
  the deterministic engine computed; templates go through
  `advice-rule.test.ts` like detector copy. No projections beyond the
  existing scenario math; gap estimates keep the "compare quotes from
  multiple insurers / licensed professional" framing.
- **Data/privacy:** no content leaves the boundary — there is no model call.
  Member scoping matches the existing twin/member-read-model authorization.

## Builds on

ARCHITECTURE.md §8.4b; the member twin read model (PRD-117) and readiness
score (PRD-114); `projectScenario` (PRD-115); the cascade's deterministic
tier. P2/P3 patterns from `llm-usage-patterns-low-cost-and-private-2026-10.md`.

## Success metrics

Generation-escape rate under 40% of assistant asks within a month of launch
(measured, not asserted); p95 verified answer under 2s; zero correctness
defects in the operation set's golden evals; no cross-member leakage in the
cache tripwire test.

## Out of scope

Natural-language *writes* to the profile, free-form multi-hop questions,
voice input, and any new generative model. The hosted path itself is PRD-211.

## Open questions

How wide the v1 operation set should be — start with the five above and widen
only where escape-rate telemetry shows demand?

# PRD-211: Ask Keel live on an approved hosted processor (Phase 0)

## Problem

Ask Keel is effectively down for real questions. The general path
(`assistant.answer.v1`) was pointed at the CPU-local model, which measures
50s p50 against its 30s deadline — every question times out and returns the
canned fallback (`isLive: false`). Advice and injection probes "passed" only
because the model never answered, so the compliance behaviour of the live
path is untested. The task policy already allows hosted processors
(`allowed_processors: [ollama, anthropic, openai, azure]`), but every hosted
entry ships `unreviewed`, so no hosted call can be approved today. The
blocked work is processor terms review, not engineering.

## Who it's for

Every family using Ask Keel; engineering (restoring a live, evaluable
assistant path); the operator (real cost/latency numbers for the first time).

## What "done" looks like

1. One hosted processor (fast-tier, no-training API terms) goes through the
   review in ARCHITECTURE.md §8.8's decision matrix: DPA/terms reference,
   retention and deletion semantics, sub-processors, transfer mechanism,
   review date. Its entry in `definitions/ai-processors.yaml` moves from
   `unreviewed` to approved *for the general interactive tasks only*.
2. `assistant.answer.v1` serves live answers on the hosted processor in
   production. `assistant.answer.sensitive.v1` and
   `assistant.youth_answer.v1` stay `lifekeel_infra_required` and are
   untouched by this change.
3. The deadline races are fixed such that a `TaskDeadlineError` cancels the
   underlying provider call (abort signal threaded into the provider fetch),
   verified by a test that an expired call frees the provider.
4. The production probes are re-run against the live model: grounded question,
   advice bait, prompt injection, and the emergency short-circuit. Unsafe
   output on any of them is a release blocker.
5. Cost and latency telemetry per call feeds the ledger (already wired);
   first-week numbers are reported as cost per answered question.

## Constraints

- **Trust tier:** 0. Language-only output; no action is added.
- **Regulated-advice check:** the hosted path keeps the same SYSTEM_PROMPT
  rules and output guard (`advice-rule.test.ts`, `withOutputGuard` semantics
  apply symmetrically — §8.2). Copy changes only if they narrow behaviour.
- **Data/privacy:** rule 3 — processing, not training. Context stays
  task-minimized; the PII curtain (`redactForCloudEgress`) behaviour is
  preserved; no provider-side memory/file/vector stores; hosted processor
  approval is per-task, so this approval must not leak to other tasks by
  default.

## Builds on

ARCHITECTURE.md §8.4b (generation split), §8.8 (decision matrix);
`decision-local-interactive-closed-2026-10.md` (measured evidence);
PRD-142 (registry). The CPU-local interactive experiment is closed; this PRD
does not revive it.

## Success metrics

p95 answer latency under the 30s deadline in production; zero timeout
fallbacks on the probes; zero guard blocks on unsafe categories in the
adversarial fixtures; measured cost per answered question within the
interactive budget class.

## Out of scope

Special-category path changes, model fine-tuning, streaming to clients,
a second hosted processor, and the verified-answer tier (PRD-212).

## Open questions

Which provider's terms can the user actually accept (sub-processor list,
retention, region)? The PRD is blocked on that supply until one is chosen.

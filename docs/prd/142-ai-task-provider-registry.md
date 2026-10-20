# PRD-142: AI task and provider registry — the technical gate for CLAUDE.md rule 3

## Problem

CLAUDE.md's third rule says family content is never model-training data and that
hosted AI calls need an approved endpoint, a no-training basis, retention and
deletion rules, and task-minimised context. ARCHITECTURE.md §8.4 describes the
**task-policy registry** that would enforce this, but CLAUDE.md states plainly that
it is not yet wired and that the rule must not be claimed as technically enforced
by code alone. Until it is, any new feature that sends documents or email to a
hosted model (PRD-143, PRD-144) would run on policy and review only.

## Who it's for

Engineering and the operator; indirectly every family whose content is processed.

## What "done" looks like

1. A registry of **tasks** (for example `document_classify`, `document_extract`,
   `email_classify`, `draft_outreach`), each declaring: allowed input fields, a
   maximum context size, allowed processors, retention mode, and whether
   on-device or self-hosted execution is required.
2. A registry of **processors** recording the information ARCHITECTURE.md lists:
   endpoint, model, region, DPA or terms reference, no-training basis, retention and
   deletion semantics, and a review date.
3. A single call path for hosted-model requests that refuses to run when the task is
   unregistered, the processor is not approved for it, the input exceeds the task's
   field allow-list, or the review date has lapsed. The refusal is a typed error,
   never a silent fallback to another provider.
4. Metadata-first telemetry per call: task, processor, token counts, latency, outcome.
   No prompt or completion content in logs unless explicitly enabled for a
   non-production environment.
5. A test, in the style of `trust-tier-gate.test.ts`, that fails if code calls a hosted
   provider outside the registry path, so the rule has a tripwire rather than a promise.
6. `CLAUDE.md` and `ARCHITECTURE.md` are updated to say what is enforced and what is
   still policy, once it ships.

## Constraints

- **Trust tier:** 0. It restricts behaviour; it adds no action.
- **Regulated-advice check:** task definitions for drafting and summarising include
  the advice-rule constraints in their system prompts (see `assistant.ts`).
- **Data/privacy:** this PRD exists to enforce the data boundary. Provider-side
  memory, file stores, vector stores and fine-tuning APIs are denied by default.

## Builds on

ARCHITECTURE.md §8.4 and the hosted-processor decision matrix; the existing LLM
router in `@lifekeel/platform`; PRD-113 (on-device inference).

## Success metrics

Zero hosted calls outside the registry in the tripwire test; every task has a
current review date; a processor with an expired review is blocked in staging before
production.

## Out of scope

Choosing the processors (a contract and legal decision for the user), a full MLOps
platform, training or fine-tuning of any kind.

## Open questions

Which processors have signed terms today? The registry cannot be populated with
approved entries until the user supplies that.

## Amendments from the October 2026 market review

See [prd-set-market-review-2026-10.md](../reviews/prd-set-market-review-2026-10.md)
for evidence quality. Numeric defaults below are hypotheses to test, not benchmarks.

1. **Registry fields to add**, with the registry refusing to load an entry that leaves
   any blank: per-model retention class, sub-processors, transfer mechanism, DPA date,
   breach-notice SLA (alongside endpoint, region, terms reference, review date).
2. **`source=gmail` flag.** Google's Limited Use rule bars using Gmail data to create or
   improve generalised AI models and restricts human reading. A flagged source must be
   blocked from evaluation capture, human review and cross-tenant scorers. The weekly
   `feature_hash_eval` job (SECURITY.md) loads approved and dismissed insights across
   tenants and must exclude Gmail-derived insights before PRD-144 ships.
3. **"Who processes your documents" screen** in the app, listing processors and
   retention. Apple's guideline 5.1.2(i) requires disclosure and explicit permission
   for sharing personal data with third-party AI.
4. **Provider retention differs per model** and zero-retention needs per-organisation
   approval; record the actual terms per task, never a blanket statement.

## Status

**Much of this was already built** under intent 01 (task registry `definitions/ai-tasks.yaml`,
`packages/platform/src/task-gateway.ts`, the `ai-task-gateway` fitness test). This change adds what
was missing.

Built now: the processor registry (`definitions/ai-processors.yaml`, parsed by
`packages/platform/src/ai-processors.ts`) with every field from item 2 and amendment 1, a loader that
refuses a blank field and a placeholder on an approved entry; per-task `allowed_processors`; a
gateway check that refuses with a typed `ProcessorPolicyError` (unknown processor, not allowed for
the task, unreviewed, review lapsed, retention beyond what the task tolerates) with no fallback;
`AI_PROCESSOR_ENFORCEMENT` = off | warn | enforce, default **warn**; a violation counter; the
read-only "Who processes your documents" screen (amendment 3); and `CLAUDE.md` and `ARCHITECTURE.md`
updated to say what is enforced and what is not.

**Every hosted processor is `unreviewed`** (the open question stands: no signed terms supplied), so
`enforce` would refuse every hosted call today. To approve one the owner supplies DPA date, terms
reference, no-training basis, retention per model, sub-processors, transfer mechanism, breach-notice
SLA and region, then sets `status: approved` with real dates.

Found while doing this: a `lifekeel_infra` task (Ask Keel, support and outreach drafts, document and
email tasks) falls back to the hosted router when `LOCAL_TEXT_ENABLED` is off, so family content can go
to a hosted provider under a label that says it stays in our infrastructure. The check now flags it;
whether to make those tasks fail closed (as `lifekeel_infra_required` does) is a product decision.

Not built: the Gmail Limited Use exclusion from `feature_hash_eval` and other cross-tenant scorers
(insights carry no provenance saying they derive from Gmail; needed before PRD-144), an explicit
consent flow for third-party AI (Apple 5.1.2(i); the screen is disclosure only), atomic budget
reservation, and verification of any provider's actual terms (human and legal).

## Becomes

docs/prd/142-ai-task-provider-registry.md

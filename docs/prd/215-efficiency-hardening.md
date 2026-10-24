# PRD-215: Efficiency hardening — de-generated batch, serving discipline, escalation telemetry (Phase 4)

## Problem

The measured local-model failure exposed serving debt that exists regardless
of which model serves: deadlines that don't cancel inference, unbounded
stampeding of a serialized backend, retry amplification, background batch
competing with interactive capacity, and no per-task visibility of how often
work escalates to generation. It also showed batch paths doing generation
work that encoders and templates can do. Efficiency here is not optimization
polish — it's operating margin and reliability.

## Who it's for

Engineering/SRE (reliability, capacity); the business (cost per accepted
result); families (a faster, more honest product).

## What "done" looks like

1. **Email task split**: `email.policy_relevance.v1` /
   `email.policy_summary.v1` deadlines move to batch values (120s). A shadow
   evaluation compares the current 7B generative classifier against (a) the
   existing encoder pre-classifier widened, and (b) a GLiNER2-class schema
   extractor, on the labelled email set — promote per shadow gate
   (precision/recall/abstention), keeping model failure as `failed`, never a
   fake verdict. Summaries become templates over extracted fields where the
   extraction is confident.
2. **Serving discipline** (§8.4b invariants): deadline cancellation is
   model-side; admission to the local model is single-flight with a bounded
   queue that rejects work that cannot finish before its deadline;
   `withRetry` is budgeted so retries cannot exceed the task deadline;
   interactive and batch traffic are bulkheaded (separate concurrency
   classes or instances).
3. **Escalation-rate telemetry (P4)**: per-task counters for which cascade
   tier served each request (rules / encoder / decision / generator),
   exposed on Prometheus with an alert when a task's generator share
   regresses materially.
4. **Cost per accepted result (P8)**: the ledger joins usage with eval
   outcomes and guard rejections so every governed task reports
   cost_per_correct, not just tokens.

## Constraints

- **Trust tier:** 0. No user-visible behaviour change except speed and
  reliability; fallbacks stay honest.
- **Regulated-advice check:** summary templates pass `advice-rule.test.ts`.
- **Data/privacy:** all changes stay inside `lifekeel_infra`; new model
  artifacts (encoder/extractor) go through the AI-BOM digest-pin and eval
  gate like `local-judge-model`; licensing of any new artifact is reviewed
  before training-data or commercial-use assumptions are made.

## Builds on

`decision-local-interactive-closed-2026-10.md`; P4/P8 in
`llm-usage-patterns-low-cost-and-private-2026-10.md`; the shadow-judge
pattern (apply it to email); GLiNER2 (EMNLP 2025) as the extraction
candidate — with license review first.

## Success metrics

Email relevance served without a generative call for the clear majority of
volume at equal or better recall; zero deadline-orphaned generations
(observable via queue-wait metrics); generator share per task visible and
alertable; cost_per_correct reported per task for a full month.

## Out of scope

GPU serving (a separate crossover decision per ARCHITECTURE.md §8.12),
speculative decoding or runtime swaps (revisit only via the decision record's
reopen criteria), hosted batch APIs for non-sensitive tasks (P7, later).

## Open questions

Encoder-widening vs GLiNER2: which clears the email eval first? Run both in
shadow; pick by measured cost per accepted result, not benchmark claims.

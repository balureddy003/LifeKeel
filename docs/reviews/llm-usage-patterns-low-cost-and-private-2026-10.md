# Using LLMs differently: low-cost, non-training patterns (October 2026)

Date: 20 October 2026. Status: design guidance extending
[llm-system-one-and-open-model-strategy-2026-10.md](llm-system-one-and-open-model-strategy-2026-10.md)
and ARCHITECTURE.md §8.3/§8.8/§8.12. Everything here must pass through the AI
task gateway and the three rules in CLAUDE.md; nothing here permits family
content to become training data.

The earlier strategy doc decided **where** models run (deterministic-first
cascade, self-hosting gated at 1.3× crossover). This document decides **how**
the remaining calls are shaped so that (a) tokens aren't spent where code or a
small model suffices, and (b) privacy comes from *construction* — minimized,
classified context — not from provider promises alone.

Eight named patterns, each with cost mechanics and privacy mechanics.

---

## P1. LLM-as-Compiler, never as runtime

The single largest cost and privacy lever available: **move model calls from
request time to build time**.

- Strong hosted models *draft* artifacts offline — new detector YAML candidates,
  playbook step templates, youth-literacy content, guard fixtures, synthetic
  eval families — a human reviews, the artifact lands in the repo, and the
  runtime path executes it with **zero model calls and zero family data**.
- LifeKeel already interprets declarative YAML instead of evaluating generated
  code. This is the same principle applied upstream: the model proposes, the
  review process disposes, the runtime never pays.

| Dimension | Runtime LLM | LLM-as-Compiler |
|---|---|---|
| Cost | Every family, every request | Once per artifact version |
| Privacy | Family content in context (minimized) | None — author content only |
| Quality control | Guards at request time | Full human review + evals before deploy |
| Failure mode | Per-call hallucination risk | Bad drafts rejected in review, never shipped |

Candidates to start: expanding `detectors/family/` coverage (a model drafts the
YAML against the schema, golden evals in `detector-evals/` gate it,
`advice-rule.test.ts` gates the copy); marketing localization variants; youth
curriculum items.

## P2. Compiled Context — prompts as build artifacts, not string concat

Context engineering is currently described as field allow-lists. Promote it to
a mechanism: each task's context is an **explicitly compiled artifact** with a
schema, a token budget enforced at compile time, a provenance list, and a
stable serialization:

1. **Allow-list first** — the task policy names the fields; nothing else exists
   in the callable surface. The compiler physically cannot see the rest.
2. **Deterministic projection** — values are projected and rendered by code
   (currency formatting, age computation), so the model reads facts it could
   miscompute.
3. **Prefix stability** — stable instructions and schema first, variable family
   context last; identical prefix serialization enables provider prompt
   caching where terms permit.
4. **Hashable** — the context hash is the exact-cache key and the eval-trace
   join key.

Cost effect: three of the four provider-side cost multipliers (context length,
cache-miss rate, retry context size) collapse to compile-time constants.
Privacy effect: the privacy review moves from "did this prompt leak?" to "does
this allow-list allow it?" — an auditable schema, reviewable in PR.

## P3. Constrained Narration — models render, never derive

Every user-visible family statement originates in deterministic code; the model
receives the **computed result plus its evidence IDs** and may only render
language:

- output schemas carry the exact numbers as fields the model must copy verbatim;
- the ungrounded-number guard rejects any numeral not present in the sanctioned
  input set (already implemented — extend it to *require* presence, not just
  forbid absence);
- a "narration diff" eval metric measures whether any statement in the output
  lacks a source ID in the input.

This kills the two most expensive runtime behaviors: multi-shot retries caused
by malformed reasoning about numbers, and human re-review of plausible-but-
unsourced prose. Privacy effect: the model context contains the answer, not the
raw inputs — the shared context is smaller than any retrieval of underlying
records.

## P4. Classification before generation, everywhere

Reinforce the existing intent-classifier pattern as a hard budget rule: **no
generation call may run before a cheaper classifier has had its shot.**

| Order | Item | Cost class | Role |
|---|---|---|---|
| 1 | Trie/keyword rules | free | Exact paths |
| 2 | Local encoder (`bge-small-en-v1.5`, GLiNER) | ~free, CPU | Routing, relevance, dedup, PII pre-screen |
| 3 | Typed decision model (local JSON-schema constrained) | near-free | Bounded multi-way choices |
| 4 | Hosted nano/mini generation | $ | Only if 1–3 abstain |

The unit to manage is the **escalation rate** — what fraction of requests each
tier refers upward — instrumented per task. A routing regression that pushes
10% of triage from tier 2 to tier 4 is a cost incident, not a quality tweak;
alert on it like one.

## P5. Synthetic-first distillation — improving local models without family data

When a local decision model or encoder needs to get better, the loop that rule
3 permits is:

1. Generate **synthetic family fixtures** (LLM-as-Compiler, P1) — invented
   households, invented policies, invented emails; verify zero overlap with real
   tenant data via n-gram/entity screen.
2. Label with the strong hosted model or human review on the synthetic set.
3. Distill/fine-tune the **local** student on synthetic labels only.
4. Gate promotion on the golden eval suite plus a shadow run in production.

Provider terms check before step 2: several hosted providers prohibit using
outputs to train competing models; use only providers/terms that allow it, or
label with humans + templates. The result: local models improve, hosted call
volume falls, and no family record ever enters a training path — the learning
signal is manufactured, not harvested.

## P6. Privacy by shaping, not just by contract

Contractual no-training terms are necessary but weak as the *only* control.
Layer construction-level shaping on top, in escalation order:

1. **Boundary tasks stay home** — youth content is already
   `lifekeel_infra_required`; extend the same fail-closed posture to any task
   whose data class is marked `sealed/local_only` (the Disclosure Lattice, M2 in
   the mechanisms review, can carry this as a label — a labelled artifact
   refuses hosted execution by construction).
2. **Reference, don't quote** — for hosted calls that need document information,
   send the deterministic *extraction result* (fields + values), not the
   document. If page evidence is truly needed, send the region, else nothing.
3. **On-device opt-in** for the most sensitive drafting (already built via
   WebLLM for crisis drafts; the lever is expanding the roster of device-eligible
   tasks as browser models improve — gate on task evals, not enthusiasm).
4. **Telemetry is metadata-first** — hashes and counts by default; content
   capture stays off (already the design; verify no debug path regresses it).

Rule: a hosted provider learns at most "someone's policy renews in a given
month and their fund has X months of cover" for a minimized, non-identifying
projection — never names, never documents, never full context.

## P7. Batch and background economics

Non-interactive classes (member reconciliation, email backlogs, marketing
drafts, OCR retries) go to provider batch APIs at ~50% discount where terms and
24h latency permit. Two LifeKeel-specific rules on top of the standard practice:

- batch task policies are **separate registered tasks** with their own retention
  class — never silently reclassify an interactive task into batch;
- a batch window respects the family's quiet-hours/timezone policy for
  *delivery* even though computation is off-peak (links to the timezone gap in
  the P2 register).

## P8. Cost per *correct accepted result* as the operating metric

The honest denominator. For every governed task, track:

> cost_per_correct = (tokens + retries + fallback + evaluation share + human
> review minutes × loaded rate) ÷ accepted-and-correct results

This is the metric that decides P1–P7 promotion and the self-hosting crossover.
It directly penalizes the failure mode that's invisible on a token bill: a
cheap model whose guard rejection rate forces human review on 30% of outputs
costs more than an expensive model at 2%. The existing CostLedger records the
spend; this metric is the missing join with eval outcomes (`eval_runs`) and
review minutes.

---

## Security & privacy checklist per new task (gate before registration)

1. Registered in `definitions/ai-tasks.yaml` with processor terms, retention
   class, data boundary — gateway fails closed otherwise (already enforced).
2. Context allow-list reviewed; if the data class is prohibited, the task has a
   local/device-only execution class only.
3. Output belongs to Constrained Narration (P3) unless explicitly exempted with
   a reason.
4. Cheaper tired tiers (P4) reached first; escalation rate instrumented.
5. Improvement path is synthetic-first (P5), never tenant-content training.
6. Batch routing only as a separate task id (P7).

## What to build next (concrete, small)

1. **Prompt compiler** (P2): one shared context-builder API rendering
   allow-listed, budgeted, hashed contexts — replaces per-callsite string
   assembly. Days, not weeks.
2. **Ungrounded-number guard upgrade** (P3): enforce presence-requirement and
   narration-diff eval metric on Ask Keel and scenario narration.
3. **Escalation-rate telemetry** (P4): per-tier counters + alert; validate the
   cascade is actually saving money rather than ratcheting upward silently.
4. **First P1 pilot** (LLM-as-Compiler): model-drafted detector YAML candidate
   through golden evals, measuring review time vs. hand-writing. If review cost
   ≥ authoring cost, stop — that's the honesty check for the whole pattern.

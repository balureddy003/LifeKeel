# LLM, System One, and Open-Model Strategy (October 2026)

## Executive decision

LifeKeel should **not** standardize on one model and should **not** self-host a
large open-weight model yet. The lowest-cost credible architecture is a
**deterministic-first cascade**:

1. TypeScript/YAML rules and calculators for financial facts, readiness scores,
   trust-tier gates, and regulated-language checks.
2. Local encoders/embeddings for routing, similarity, deduplication, and
   classification.
3. A typed decision model only for ambiguous bounded decisions, initially in
   shadow mode.
4. A low-cost hosted small model for structured extraction and short drafts.
5. A stronger hosted model only for difficult, user-visible synthesis.
6. On-device inference for narrow, privacy-sensitive drafts where the browser
   supports it.

This is not merely a cost optimization. It preserves LifeKeel's core safety
property: financial and protection conclusions remain reproducible and
explainable, while generative models provide language rather than authority.

**Recommended near-term provider decision:** retain the provider-neutral router,
refresh its stale default model catalogue, and benchmark two current low-cost
hosted models behind it. Do not add a GPU service or make Jev a production
dependency until LifeKeel has task-level evals and enough sustained traffic to
show that hosted token spend exceeds the fully loaded cost of operating another
inference service.

---

## Scope and method

This review covers:

- current hosted LLM economics;
- TypeSafe AI's Jev/System One approach;
- Meta's Muse Spark Open and Muse Glimmer;
- small open-weight and on-device models;
- patterns that fit LifeKeel's current architecture and regulatory boundary.

Prices and model availability change quickly. Figures below are public list
prices observed on **17 October 2026**, in USD, and should be rechecked before a
procurement decision. Vendor benchmark claims are treated as claims, not as
independent evidence. LifeKeel's own task evals must decide promotion.

---

## What LifeKeel already has

LifeKeel is not starting from a naive “send everything to one LLM” design:

- Five deterministic YAML detector families and deterministic scenario/readiness
  math own the substantive financial conclusions.
- `@lifekeel/platform` has a provider-neutral router, fast/balanced/powerful
  tiers, token usage callbacks, a cost ledger, response cache, and per-tenant
  budget guard.
- Intent classification already uses a trie → local embedding → LLM cascade;
  `bge-small-en-v1.5` runs locally on CPU.
- Background judging, classification, and OCR can use a self-hosted Ollama
  endpoint.
- Family-data text generation can opt into a guarded local Qwen 2.5 7B model,
  but internal measurements show roughly 16–59 seconds on four CPU cores and a
  higher output-rejection rate than cloud models.
- Crisis drafts can run in the browser via WebLLM, with cloud fallback.
- Generated output is screened for regulated advice, provider steering, and
  ungrounded numbers.

Those are the correct primitives. The main weaknesses are model freshness,
insufficient task-level evaluation/routing, and the risk of paying fixed
self-hosting costs before volume warrants them.

---

## Market findings

### 1. Hosted small models remain the economic default at startup scale

Current list prices make short, bounded calls extremely cheap. Representative
published rates include:

- OpenAI GPT-5 nano: **$0.05/M input, $0.40/M output**; GPT-5 mini:
  **$0.25/M input, $2/M output**.
- Groq-hosted GPT OSS 20B: **$0.075/M input, $0.30/M output**; GPT OSS 120B:
  **$0.15/M input, $0.60/M output**.
- Anthropic Claude Haiku 4.5: **$1/M input, $5/M output**.
- TypeSafe Jev 1.13/1.14: **$0.042/M input**, with no generated output tokens.

At these rates, engineering time, quality failures, observability, idle GPU
capacity, and operational complexity often cost more than tokens. Batch APIs and
prompt caching can reduce hosted costs further for asynchronous workloads.

A useful illustrative workload is 10,000 active families, 20 model calls per
month, 2,500 input tokens and 400 output tokens per call: 500M input and 80M
output tokens monthly. At list price, that is approximately:

| Model | Illustrative monthly token cost |
|---|---:|
| GPT-5 nano | $57 |
| GPT OSS 20B on Groq | $61.50 |
| GPT-5 mini | $285 |
| Claude Haiku 4.5 | $900 |

This is not a quality-equivalent comparison and excludes tools, storage, retries,
regional premiums, and taxes. It demonstrates why LifeKeel should measure before
self-hosting: even ten times this workload may not justify a continuously
provisioned GPU once labor and reliability are included.

### 2. Jev is a useful new category, not an LLM replacement

TypeSafe describes Jev as a “System One” model. It accepts state plus typed
questions and returns distributions for bounded answers rather than generating
text. Its useful primitives are effectively:

- yes/no with probability;
- choice among caller-supplied options;
- score on a bounded scale;
- many questions evaluated against shared state in one request.

This eliminates invalid labels and output-token cost. It is a strong conceptual
fit for ambiguous routing, triage, relevance, urgency, and “hold for review?”
decisions. It is not suitable for Ask Keel prose, OCR transcription, explanatory
insights, or drafting.

Important cautions:

- Jev launched only in September 2026; its production history is short.
- The hosted model is closed-weight. Public open-Jev repositories found during
  research are unofficial reconstructions or distilled students, not the
  production model.
- TypeSafe's large speed/cost claims come from its own workflow evals and the
  company explicitly recommends use-case experiments.
- A probability is not automatically calibrated for LifeKeel's population or
  loss function. Calibration must be measured on LifeKeel labels.
- “Cannot hallucinate” means it cannot emit an out-of-set string; it can still
  select the wrong option with confidence.

**LifeKeel decision:** run Jev only as a shadow challenger for bounded,
non-authoritative tasks such as email relevance, insight delivery hold/release,
and urgency routing. Never let it replace deterministic detector logic, trust
-tier gates, consent checks, or the human approval gate. Promote one task at a
time only after measuring false-negative rate, calibration error, latency, and
cost against the existing cascade.

### 3. Muse Spark Open is not a low-cost self-hosting option

Meta's Muse Spark Open is an 816B-total/42B-active multimodal mixture-of-experts
model with a 1M-token context window. The published checkpoints are about
537 GB (NVFP4) or 1.65 TB (BF16), with reference deployment requiring four B300s
for NVFP4 or eight B300s for BF16. This is a data-center model despite its open
weights.

Its agentic and long-context capabilities target complex software/agent work,
not LifeKeel's dominant short classification, extraction, and grounded-draft
calls. Hosted access could be evaluated for rare complex tasks, but local
operation would increase rather than reduce platform cost.

**LifeKeel decision:** do not self-host Muse Spark and do not make it a default
router tier. Revisit only if a measured long-horizon agent workflow materially
outperforms smaller models and has a revenue or safety case.

### 4. Muse Glimmer is technically feasible, but premature for production

Meta's Muse Glimmer is a dense 30B multimodal model under Apache 2.0. Published
requirements are about 60 GB for BF16 and 17–20 GB for quantized GGUF weights;
a GPU deployment needs about 72 GB VRAM for BF16. It supports text and image
input, tool use, and local agentic workflows.

Glimmer is much more relevant than Spark for private document extraction and
local tool use, but it is still not a browser/mobile-class model and it exceeds
LifeKeel's current Qwen 7B footprint. A dedicated GPU service creates an idle
cost floor, cold-start/image-management work, model-supply-chain obligations,
and another sensitive-data processor operated by LifeKeel.

**LifeKeel decision:** evaluate Glimmer offline on the document/OCR golden set,
not in production. Consider it later if multimodal extraction quality allows one
local model to replace enough cloud OCR volume to pay for a scale-to-zero GPU
service. Do not use it to make autonomous family decisions.

### 5. Small open models are best when specialized, not treated as tiny frontier models

The market now spans sub-billion encoders and language models through 3B–9B
instruct models. The attractive pattern is teacher-assisted specialization:
label a stable task with a stronger model plus human review, then serve a small
encoder/classifier or adapter for that task.

Good LifeKeel candidates:

- email/document relevance;
- document type classification;
- field-candidate extraction with schema validation;
- intent and urgency routing;
- duplicate/novelty detection;
- short draft polishing with mandatory human review.

Poor candidates:

- financial calculations already expressible in code;
- deciding whether coverage is adequate;
- multi-step scenario arithmetic;
- open-ended regulated-domain recommendations;
- any action authorization or consent decision.

A 500M–4B model can be cheap per inference but expensive in aggregate if low
quality causes retries, cloud fallbacks, user edits, or unsafe-output rejection.
Optimize **cost per accepted, correct result**, not cost per token.

### 6. RAG should remain narrow and structured

LifeKeel's family twin is structured data, not a document corpus that should be
blindly embedded and retrieved. For profile values, policies, permissions, and
readiness inputs, direct database queries plus compact serialization are more
accurate, cheaper, and easier to audit than vector retrieval.

Use retrieval only for unstructured sources such as vault-document passages,
policy wording, and approved knowledge content. Retrieval must preserve tenant,
member, document, and permission filters before similarity ranking. Retrieved
text is evidence, not authority; calculations remain deterministic.

---

## Recommended target architecture

| Workload | First choice | Fallback/escalation | Why |
|---|---|---|---|
| Readiness, gaps, scenarios | Deterministic code/YAML | Human review of rule changes | Exact, auditable, no token cost |
| Trust tier, consent, action gate | Deterministic policy | Human approval | Models must not authorize actions |
| Intent/relevance/dedup | Trie + local encoder | Jev or cheap small hosted model | Bounded output, low cost |
| OCR/document extraction | Native parser/OCR + schema | Cheap multimodal model; stronger model on low confidence | Cascade by confidence |
| Insight prose | Templates first | Cheap hosted model for optional personalization | Stable and reviewable |
| Tier 1 drafts | On-device small model where supported | Cheap hosted model; stronger model only after guard failure/low confidence | Privacy plus graceful fallback |
| Ask Keel | Compact structured context + cheap hosted model | Strong model for explicitly complex questions | User-visible quality where needed |
| Background bulk jobs | Local encoder or batch API | Standard API | No interactive latency requirement |
| High-stakes ambiguity | Escalate to human | None | Correct loss function is abstention |

### Routing rules

1. Route by **task ID**, not prompt keywords. The current keyword-based reasoning
   estimator can remain a fallback, but production calls should declare a task,
   output schema, maximum context/output, and allowed model class.
2. Every task gets an eval set, quality threshold, maximum accepted-result cost,
   and fallback.
3. Use confidence only after calibration. Define a gray zone that escalates
   instead of forcing a decision.
4. Pin dated model versions. Aliases such as `latest` belong only in evaluation,
   never silent production upgrades.
5. Cap output aggressively. Most LifeKeel drafts need hundreds, not thousands,
   of tokens.
6. Cache only where inputs and authorization scope are part of the key. Never
   share family-derived cache entries across tenants.
7. Record provider, exact model, task, token counts, latency, cache status,
   guard result, fallback count, and user edit/accept signal.

---

## Low-cost decisions, in priority order

### P0 — Refresh and measure before adding infrastructure

The router defaults still name several old or retired model generations. Replace
static market assumptions with a reviewed model registry containing exact model
ID, provider, modality, context limit, structured-output support, residency,
retirement date, and current price. Keep configuration separate from code where
possible, but require an allow-list and review for production models.

Create representative eval slices for:

- Ask Keel grounded answers;
- outreach drafts;
- OCR/profile extraction;
- email relevance;
- move-judge hold/release decisions;
- safety/advice and ungrounded-number failures.

Do not select a winner from generic benchmarks. Test at least one very cheap
hosted model and one quality model, then route each task to the cheapest model
that clears its threshold.

### P1 — Make the existing cascade explicit

Introduce task policies such as `intent_classification`, `document_extract`,
`draft_short`, and `assistant_grounded`. A policy sets model candidates, timeout,
max tokens, cacheability, budget behavior, and whether family data may leave the
chosen boundary. This removes accidental use of a balanced/powerful model where
rules or an encoder suffice.

Use batch processing for daily reconciliation, marketing analysis, and other
non-interactive jobs where vendor terms and data classification permit it.

### P1 — Shadow-test Jev on one bounded task

Start with email relevance or move-judge triage, not a financial conclusion.
For at least a meaningful labeled sample, log Jev's distribution without
changing production behavior. Compare:

- false negatives at the proposed threshold;
- expected calibration error and reliability curve;
- disagreement cases by cohort;
- p50/p95 latency;
- cost per accepted correct decision;
- percentage sent to the gray-zone fallback.

If it wins, use it as the middle tier between local encoder and generative LLM.
Keep deterministic safety gates after it.

### P2 — Improve local specialization, not local general intelligence

Continue the existing encoder shadow → gate process. Distill only after enough
reviewed labels exist and keep provenance/licensing records for teacher outputs
and training data. A small task-specific classifier is preferable to keeping a
7B text model warm for classification.

Retain on-device generation for narrow crisis drafts, but measure model download
completion, local success, cloud fallback, guard rejection, and user edit rate.
Do not expand on-device inference to general Ask Keel until it passes the same
grounded-answer evals.

### P3 — Reassess self-hosting only at a measured crossover

A self-host proposal must include:

- sustained tokens/requests per second, not monthly totals alone;
- peak concurrency and acceptable queue latency;
- GPU plus idle, storage, egress, monitoring, and engineer-on-call costs;
- availability and multi-region requirements;
- upgrade, rollback, security-patching, and model-license process;
- cost per accepted correct result against hosted alternatives.

Pilot a scale-to-zero service only when the measured hosted bill for one stable,
high-volume task is persistently above the fully loaded alternative. Muse
Glimmer may be a future OCR/agent candidate; Muse Spark is not a cost candidate.

---

## Decisions to avoid

- Do not move deterministic detector conclusions into an LLM or Jev to appear
  more “AI-native.”
- Do not operate one self-hosted model for every task; specialization and
  cascades are cheaper and safer.
- Do not equate open weights with low cost, open source, permissive licensing,
  privacy, or operational simplicity.
- Do not trust vendor aggregate benchmarks for LifeKeel's high-asymmetry error
  cases.
- Do not use model confidence as permission to execute financial, legal,
  medical, or otherwise irreversible actions.
- Do not fine-tune on raw family data until consent, deletion, isolation,
  provenance, and model-unlearning implications are explicitly designed.
- Do not add vector search for fields already available through exact structured
  queries.

---

## Suggested success metrics

- LLM cost per monthly active family.
- Cost per accepted correct result by task.
- Calls and tokens per task and model.
- Deterministic/local/cache/hosted/strong-model share of requests.
- Fallback, retry, timeout, and output-guard rejection rates.
- Grounded-answer accuracy and unsupported-claim rate.
- Extraction field precision/recall, not only document-level accuracy.
- Calibration error and false-negative rate for typed decisions.
- Draft edit/accept rate, segmented by local vs hosted model.
- p50/p95 latency and queue time.

A sensible policy is to alert on spend and quality regressions independently.
A cheap model that doubles unsafe-output rejection or user edits is not cheaper.

---

## Cross-disciplinary expert review

Four independent reviews were conducted through the lenses of principal ML
systems architecture, AI safety/privacy, FinOps/SRE, and high-stakes AI product
and evaluation. These are expert-role analyses of the repository and primary
sources, not endorsements by named external consultants.

The reviews converged on the same conclusion:

> LifeKeel's intended architecture is strong, but several controls exist as
> components without being wired into every production path. The next major
> investment should be enforcement and evidence, not more model capability.

### What the reviews agreed LifeKeel gets right

- Deterministic code owns financial calculations, readiness, detector outcomes,
  permissions, and action authorization.
- Generated language is downstream of structured facts rather than a source of
  truth.
- Exact-match caching is tenant-scoped instead of using unsafe cross-tenant
  semantic reuse.
- Local encoder → LLM escalation and shadow → gate promotion are efficient,
  evidence-oriented patterns.
- Structured outputs, schema validation, human review queues, action receipts,
  idempotency, and graceful fallback already exist.
- External actions pass through code-level approval machinery instead of model
  confidence.
- On-device inference is narrowly scoped and has a cloud fallback rather than
  being treated as a universal solution.

### Material implementation gaps found

These findings were verified against the repository and should be treated as
architecture work, not merely documentation improvements.

| Priority | Finding | Consequence | Required pattern |
|---|---|---|---|
| P0 | `CostLedger.record()` is not wired to production LLM calls | The usage collection remains empty, so budget thresholds and hard stops can report zero spend | One mandatory model gateway records every call before any task can claim budget enforcement |
| P0 | The LLM circuit breaker is implemented and exported but does not wrap provider calls | Retries amplify provider incidents and the circuit metric can remain empty | Deadline → bounded retry → provider breaker → policy fallback, all enforced in one gateway |
| P0 | The deterministic output guard wraps opt-in local family-text generation, while the default cloud path returns the plain router | Advice, provider-steering, and invented-number screening is asymmetric | The same post-generation policy guard applies regardless of provider or hosting boundary |
| P0 | Signed notification links can approve and execute with actor `signed-link`, while their confirmation page does not use the in-app exact-effect action preview | A consequential approval path has weaker identity and informed-review properties | Signed links open authenticated review; execution requires exact-effect preview and named actor |
| P0 | Calibration maps approval/auto-approval/conversion to `1` and dismissal to `0` | The score estimates acceptance or action likelihood, not factual correctness | Separate correctness, usefulness, acceptance, policy, and execution outcomes |
| P0 | Hosted-provider calls do not have a consistent request deadline | A hung provider call can consume server capacity indefinitely | Task-specific absolute deadlines and cancellation propagated through each SDK call |
| P1 | Static tier defaults contain old model generations and routing can infer providers from prefixes | Unknown or changed models can enter paths without a task eval | Exact, pinned production model allow-list with lifecycle and pricing metadata |
| P1 | Prompt-keyword complexity routing remains available and there is no central task-policy registry | Similar tasks can receive inconsistent models, limits, and privacy boundaries | Route by stable task ID, risk, permissions, and explicit policy |
| P1 | Prompt registry, guard events, cost spans, and eval infrastructure are not consistently adopted by user-facing call sites | The platform cannot reconstruct why a particular output was shown | Unified trace linking task, prompt hash, context version, model, guards, cost, and outcome |
| P1 | Interactive Ask Keel and background generation lack global priority isolation | Background work can compete with user-facing or crisis requests | Separate concurrency pools and queues; shed background work first |
| P1 | Some free-text family/document fields are interpolated into assistant context without a consistent untrusted-data boundary | Prompt injection defenses depend too heavily on instructions | Typed context assembly, explicit untrusted-field delimiters, least-privilege retrieval, no model authority |
| P1 | Member-scoped scenario narration can receive broader household context than the deterministic projection requires | Unnecessary within-family disclosure and larger prompts | Minimize context to requesting role, member scope, and task purpose before model invocation |

The general anti-pattern is **control theater**: a budget guard, breaker, guardrail,
or audit model existing in the repository but not being mandatory on the default
production path. A control should be considered absent until a test proves that
all relevant calls pass through it.

---

## Reference architecture: the LifeKeel AI control plane

The provider router should evolve into a narrow **AI control plane**, not a large
agent framework:

```text
Authenticated request / scheduled job
                |
                v
     Task registry + permission check
                |
                v
 Context minimizer and data-boundary policy
                |
                v
 Deterministic / encoder / decision / generative route
                |
                v
 Deadline -> admission control -> budget reservation
                |
                v
 Cache -> provider breaker -> model call -> fallback
                |
                v
 Schema validation + grounding/advice/output guards
                |
                v
 Abstain / human review / user-visible result
                |
                v
 Trace + cost + feedback + eval-fixture candidate
```

This control plane should remain small enough to understand without a framework.
Anthropic's production guidance similarly recommends simple, composable
workflows before autonomous agents and warns that framework abstractions can
hide prompts and tool behavior.

### Required task contract

Every model-involving workload should have a versioned record similar to:

```ts
interface AiTaskPolicy {
  task_id: string
  version: string
  purpose: string
  risk: 'internal' | 'user_visible' | 'workflow_affecting' | 'external_effect'
  input_schema: string
  output_schema: string
  authority: 'none' | 'language_only' | 'candidate_for_review'
  data_boundary: 'device_only' | 'lifekeel_infra' | 'approved_hosted_provider'
  allowed_models: string[]
  primary_model: string
  fallback_models: string[]
  timeout_ms: number
  max_input_tokens: number
  max_output_tokens: number
  cache: { enabled: boolean; ttl_seconds: number }
  batchable: boolean
  budget_class: string
  abstention: 'fallback' | 'human_review' | 'reject'
  eval_dataset: string
  promotion_gate: string
}
```

Suggested first task IDs:

- `assistant.answer.v1`
- `assistant.scenario_narration.v1`
- `document.extract.v1`
- `document.profile_candidate.v1`
- `email.policy_relevance.v1`
- `email.policy_summary.v1`
- `insight.score_enrichment.v1`
- `insight.delivery_judge.v1`
- `draft.outreach.v1`
- `draft.crisis_on_device.v1`

The task ID becomes the shared key for routing, caching, budget attribution,
traces, evals, incident dashboards, and fallback policy. Provider/model names
must not leak into application-level business logic.

### Model registry requirements

A production registry should record:

- exact provider and immutable model ID;
- capability and modality;
- context and output limits;
- structured/constrained-output support;
- input/output/cache price and effective date;
- permitted data classifications and regions;
- provider retention/training terms and contract reference;
- model license, source, hash, and artifact provenance for local weights;
- first approved date, last eval run, retirement date, owner, and rollback model.

Unknown models should be rejected in production rather than silently priced as a
known model or routed by prefix. Model aliases are acceptable in an evaluation
environment only.

---

## Architecture patterns to adopt

### 1. Risk-aware selective computation

Spend model capacity only where it can change a useful outcome:

- rules for exact facts and calculations;
- encoder for stable binary/multiclass classification;
- Jev/decision model for bounded dynamic labels and calibrated distributions;
- small generator for short language;
- stronger generator for rare complex synthesis;
- human review when ambiguity or expected harm remains high.

The current disagreement-gated scorer is a strong example: if an LLM cannot
change the ranking, do not call it.

### 2. Bulkheads, deadlines, and graceful degradation

Use at least two admission pools:

- **interactive:** Ask Keel, crisis draft, user-requested extraction;
- **background:** email scans, reconciliation, marketing, backfills.

Each task has a deadline, concurrency limit, queue limit, and terminal fallback.
When capacity is constrained, defer or drop background work before interactive
work. A provider outage should produce one of three deliberate outcomes:

1. an evaluated secondary provider;
2. deterministic/template fallback;
3. honest abstention or human review.

Avoid automatic cross-provider fallback where the secondary model has not
passed the same task eval and data-processing review.

### 3. Cost reservation instead of after-the-fact reporting

Before a model call:

1. estimate worst-case cost from input and maximum output;
2. check task, tenant, and platform budgets;
3. reserve that amount atomically;
4. reconcile against actual provider usage;
5. release unused reservation.

This prevents concurrent calls from all passing a stale budget check. Record
input, cached-input, reasoning, and output tokens separately where providers
report them. Follow OpenTelemetry GenAI semantic conventions and map billing
exports toward FOCUS fields so internal and provider totals can be reconciled.

### 4. Cost per accepted correct result

The primary unit metric should be:

```text
(provider + retries + fallback + infrastructure + review cost)
----------------------------------------------------------------
          accepted results verified as correct and safe
```

Maintain separate outcomes:

- `accepted_as_is`;
- `edited_then_used` with edit category;
- `factually_verified`;
- `unsupported_claim`;
- `policy_violation`;
- `not_relevant`;
- `action_succeeded`;
- `action_reversed`.

Approval and dismissal remain valuable product signals, but must not be used as
ground truth for factual calibration.

### 5. Evidence-state UX instead of confidence theater

Until probabilities are calibrated on LifeKeel labels, use user-facing states:

- **Confirmed from current records**;
- **Estimate — some inputs are missing or stale**;
- **Needs review**;
- **Not enough information**.

Show what data was used, its source and freshness, what is missing, and whether a
value was user-entered, extracted but unconfirmed, or deterministically derived.
Do not show a percentage merely because an internal ensemble emits a number.

### 6. Retrieval as a permissioned evidence service

For structured profile fields, use exact queries. For documents:

1. authorize tenant, requester, member scope, and document access before search;
2. filter eligible documents before similarity ranking;
3. retrieve minimal passages with source/page identifiers;
4. label all retrieved content as untrusted evidence;
5. require output claims to map to supplied evidence or deterministic facts;
6. prevent retrieved text from choosing tools or permissions.

Do not build broad “chat with the whole family vault” retrieval. It increases
privacy, injection, and relevance risk while weakening explainability.

### 7. AI supply-chain governance

For hosted models, record DPA, retention/training setting, region, subprocessor,
service/version change policy, and incident contact. For open weights, record
license, model card, source URI, digest/signature, quantization provenance,
runtime/container digest, known limitations, and security/eval results.

An “open” model downloaded by mutable tag is not a controlled production
artifact. Pin weights and serving images, scan them, and retain an AI bill of
materials alongside the software SBOM.

### 8. Evaluation as the deployment mechanism

A model, prompt, retrieval change, or guard change follows:

```text
contract tests -> offline goldens -> human adjudication -> adversarial suite
-> calibration/selective threshold -> shadow -> limited canary -> production
```

Every production failure becomes a redacted candidate fixture. Keep holdout and
adversarial sets separate from prompt/model optimization data.

Initial evaluation dimensions:

| Task | Required measures |
|---|---|
| Ask Keel | grounded correctness, unsupported claims, correct abstention, privacy, advice boundary, tone |
| OCR/extraction | field precision/recall, document type, member attribution, source-page evidence |
| Email relevance | precision/recall with an explicit false-negative ceiling |
| Delivery judge | dangerous-permissive disagreement, calibration, review burden |
| Drafting | factual preservation, invented figures, provider steering, edit rate |
| Scenario narration | exact agreement with deterministic results, no new calculations |
| Retrieval | permission leakage, citation coverage, injection resistance, stale evidence |

Automated model graders may scale evaluation, but promote them only after
measuring agreement with human labels. A model should not grade itself as the
sole release authority.

### 9. Meaningful human review

A human reviewer must see:

- source evidence and freshness;
- generated/extracted content;
- why the item was held;
- exact downstream effect and recipient;
- model, task, and guard outcome where relevant;
- approve, edit, reject, defer, and request-information options.

Record reviewer identity, reason, edit diff/category, review time, and whether
the outcome was later reversed. Sample approved items for secondary review to
detect automation bias and reviewer fatigue.

For external effects, an unauthenticated bearer link should not be the human
identity. Signed notifications should deep-link into authenticated exact-effect
review; dismiss/snooze may remain lower-friction if the risk analysis permits.

### 10. Privacy by context minimization

Do not send the entire family twin because a model has a large context window.
Build a typed context per task and requester role, remove fields unnecessary to
the stated purpose, separate confirmed from unconfirmed data, and use opaque
references where names/contact details are not required. Large context is a
liability unless each token improves the task.

Before adding health or similarly sensitive domains, complete a DPIA and update
purpose, lawful basis, access, retention, deletion, provider, and incident
controls. Fine-tuning on family data requires a separate explicit design for
consent, provenance, deletion, isolation, and model-level data persistence; it
is not a normal optimization step.

---

## Architectural anti-pattern catalogue

| Anti-pattern | Why it fails | LifeKeel rule |
|---|---|---|
| Model monoculture | One outage, price change, or regression affects every task | Keep provider-neutral contracts and an evaluated fallback per important task |
| Capability-first routing | “Use the smartest model” ignores loss, privacy, and cost | Pick the cheapest route that clears the task-specific gate |
| Keyword model router | Prompt wording is not a stable risk or complexity classifier | Route by task ID and policy |
| LLM as calculator/system of record | Fluent arithmetic and extraction errors become authoritative | Deterministic math and reviewed structured updates own state |
| Prompt as security boundary | Injection cannot be solved by instructions alone | Model has no permission authority; code gates every side effect |
| Confidence as consent | Calibration does not grant legal or human authorization | Approval comes from an authenticated person and exact effect |
| Approval equals correctness | Behavioral acceptance embeds automation bias | Keep truth, usefulness, acceptance, and execution labels separate |
| Guard only on one provider path | A fallback can bypass the product's safety promise | Guards attach to task output, not model implementation |
| Retry without deadline/breaker | Partial outage becomes queue exhaustion and cost amplification | Deadline, bounded retry, jitter, breaker, bulkhead, fallback |
| Budget check without usage recording/reservation | Controls display safety while allowing overspend | Mandatory ledger, atomic reservation, reconciliation |
| Broad semantic cache | Near matches can be stale, wrong, or cross-context | Tenant-scoped exact cache; semantic reuse only for public/non-sensitive corpus with strict scope |
| Broad vault RAG | Expands injection and disclosure surface | Permission-filter first, retrieve minimal evidence, cite source |
| Self-host because weights are free | GPU idle time, operations, eval, and incidents dominate | Require fully loaded crossover and sustained utilization |
| Distill before stable labels | A small model cheaply reproduces ambiguous or biased behavior | Stabilize task, rubric, and human labels first |
| Autonomous multi-agent theater | More loops and agents increase cost and non-determinism without user value | Prefer explicit workflows and bounded member views |
| Silent model alias upgrades | Quality/safety changes without review | Immutable IDs, eval, canary, rollback |
| Logging prompts by default | Observability becomes a sensitive-data breach | Metadata-first traces; encrypted, sampled, redacted payload capture only when justified |
| Human review as rubber stamp | Queue volume and poor UX create automation bias | Show evidence/effects, allow edits/defer, measure reviewer quality |

---

## Reliability and FinOps operating model

### Suggested service objectives

| Class | Availability/latency objective | Degradation |
|---|---|---|
| Interactive answers/drafts | 99.5% successful response or explicit fallback; task-specific p95 deadline | Evaluated secondary, template, or honest unavailable state |
| Crisis preparation | Favor predictable fallback and privacy over model sophistication | Deterministic playbook remains usable without any model |
| Background classification/judging | Completion objective such as within 24 hours | Queue and retry without blocking interactive capacity |
| Safety | Unsafe external execution without valid approval: zero tolerance | Fail closed and alert |
| Privacy | Cross-tenant/member disclosure: zero tolerance | Disable affected task and investigate |

The p95 target should be set from user research and measured baselines, not copied
from a vendor. Error budgets apply to availability/latency; safety and privacy
violations are release blockers, not consumable error budgets.

### Self-hosting gate

Approve self-hosting for a task only when all are true:

- workload is stable and large enough to forecast;
- sustained utilization is high enough to avoid mostly idle accelerators;
- the candidate clears the same quality/safety eval as hosted models;
- data-boundary or latency value is material;
- fully loaded cost includes idle, storage, egress, observability, security,
  upgrades, rollback, and engineering/on-call labor;
- a failure/fallback plan exists.

Use queue depth, active batch size, time-to-first-token, tokens/second, and KV
cache utilization for accelerator autoscaling; GPU utilization alone is a poor
measure of useful work.

### Incident runbooks to add

- provider outage or extreme latency;
- spend anomaly / unexpected token growth;
- guard rejection spike;
- model-quality regression after provider change;
- local inference queue saturation;
- prompt injection or retrieval contamination;
- cross-tenant/member disclosure;
- model artifact/license/supply-chain issue.

Each runbook needs a kill switch, owner, evidence to preserve, user impact
assessment, safe degradation, recovery criteria, and post-incident fixture
creation.

---

## Risk-based adoption gates

### Gate A — inventory

No AI call exists without a task ID, owner, purpose, authority boundary, data
classification, and cost attribution.

### Gate B — offline readiness

The candidate passes schema/contract tests, task goldens, advice/privacy guards,
adversarial cases, and an explicit fallback test. Exact thresholds are task
specific; generic benchmark scores are insufficient.

### Gate C — shadow

The candidate cannot affect users. Log normalized decisions, latency, cost,
calibration, and disagreement direction. For safety judges, “candidate more
permissive than authority” is the critical error.

### Gate D — canary

Use an explicit tenant cohort, owner, end date, control group, automatic rollback
thresholds, and kill switch. Never silently turn an experiment into permanent
production.

### Gate E — user-visible generation

Require global output guards, evidence/uncertainty UX, honest fallback, feedback
capture, and red-team passage.

### Gate F — workflow influence

Models may rank or propose but deterministic permissions and policy remain
authoritative. Gray-zone outputs defer to human review.

### Gate G — external effect

Require authenticated actor, exact-effect preview, idempotency, receipt, dry-run,
retry semantics, and tested incident rollback. The existing trust-tier rules
remain stronger than model confidence.

---

## Prioritized architecture programme

### P0 — make existing controls true end-to-end

1. Wire every LLM call to usage/cost recording; make budget checks reserve and
   reconcile spend.
2. Put hosted calls behind task deadlines, bounded retry, the existing circuit
   breaker, and explicit fallback.
3. Apply the deterministic advice/grounding/output guard to cloud and local
   family-facing text.
4. Require authenticated exact-effect review for signed-link approvals.
5. Rename existing calibration semantics to acceptance/action likelihood and
   create separate factual-correctness labels.
6. Remove family-content debug logging and audit all prompt/output logging.

### P1 — establish the control plane and evidence base

1. Add the task-policy and production model registries.
2. Instrument a unified per-call trace using task ID, exact model, prompt/context
   hashes, tokens, cache, retries, guards, fallback, latency, and outcome.
3. Add task-level goldens for assistant, extraction, email, judge, draft, and
   scenario narration.
4. Enforce typed, role/member-minimized context with untrusted-data boundaries.
5. Create separate interactive/background concurrency pools and queues.
6. Add AI outage, cost, quality, guard, and privacy runbooks.

### P2 — optimize from measured outcomes

1. Shadow Jev and another decision-model provider on one bounded task through the
   provider-neutral `DecisionFn` seam.
2. Use batch APIs for eligible asynchronous workloads.
3. Order stable prompt prefixes to benefit from provider prompt caching.
4. Build cost-per-accepted-correct-result dashboards including review time.
5. Replace uncalibrated confidence percentages with evidence states.
6. Add feedback-to-eval fixture promotion and subgroup/drift reporting.

### P3 — consider specialized self-hosting

1. Benchmark small encoders/adapters for stable classifications.
2. Evaluate Muse Glimmer or another multimodal open model offline on extraction
   goldens only.
3. Pilot scale-to-zero inference for asynchronous tasks only after the crossover
   model is favorable.
4. Keep Muse Spark hosted/experimental and out of the default architecture.

---

## Governance mapping

Use NIST AI RMF as the operating structure:

- **Govern:** task/model inventory, named owner, policies, trust tier, DPIA/DPA,
  supply-chain record, approval authority.
- **Map:** purpose, users, affected family members, data classes, plausible harms,
  error asymmetry, regulated boundary, fallback.
- **Measure:** task goldens, red team, calibration, subgroup results, latency,
  cost, guard blocks, human overrides.
- **Manage:** shadow/canary gates, budget and kill switches, incident runbooks,
  rollback, retirement.

OWASP's 2025 LLM risks supply the threat checklist: prompt injection, sensitive
information disclosure, supply chain, data/model poisoning, improper output
handling, excessive agency, system prompt leakage, vector/embedding weaknesses,
misinformation, and unbounded consumption. The architecture must mitigate these
at the system boundary; model behavior alone is insufficient.

For UK operations, ICO guidance makes lawfulness, fairness, transparency,
purpose limitation, accuracy, individual rights, and controller/processor
allocation design inputs rather than paperwork after deployment. FCA guidance
is outcomes- and governance-focused; LifeKeel's safer strategic choice remains
to stay informational and outside product recommendation, arranging, and
payment initiation. For EU users, maintain a legal review of AI Act deployer and
transparency obligations; do not infer exact applicability from this technical
review.

---

## Sources

Primary/vendor sources, accessed 17 October 2026:

1. [OpenAI API pricing](https://developers.openai.com/api/docs/pricing)
2. [Anthropic model pricing](https://docs.anthropic.com/en/docs/about-claude/pricing)
3. [Gemini Developer API pricing](https://ai.google.dev/gemini-api/docs/pricing)
4. [Groq supported models and pricing](https://console.groq.com/docs/models)
5. [TypeSafe Jev models and pricing](https://docs.typesafe.ai/models)
6. [TypeSafe: Introducing System One Models and Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev)
7. [TypeSafe Jev API reference](https://docs.typesafe.ai/api)
8. [Meta: Muse Spark Open](https://research.meta.ai/blog/muse-spark-open)
9. [Meta: Muse Spark Open model requirements](https://dev.meta.ai/docs/muse-spark-open/get-the-model)
10. [Meta: Muse Glimmer](https://research.meta.ai/blog/introducing-muse-glimmer-open-agentic-model)
11. [Meta: Muse Glimmer deployment requirements](https://dev.meta.ai/docs/muse-glimmer/deploy)
12. [Meta: Muse Glimmer model](https://dev.meta.ai/models/muse-glimmer)
13. [H2O open small language and vision models](https://h2o.ai/products/open-models)
14. [NIST AI Risk Management Framework](https://www.nist.gov/itl/ai-risk-management-framework)
15. [NIST Generative AI Profile, AI 600-1](https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-generative-artificial-intelligence)
16. [NIST Adversarial Machine Learning taxonomy, AI 100-2](https://csrc.nist.gov/pubs/ai/100/2/e2025/final)
17. [NIST Secure Software Development Practices for Generative AI, SP 800-218A](https://csrc.nist.gov/pubs/sp/800/218/a/final)
18. [OWASP Top 10 for LLM Applications 2025](https://genai.owasp.org/resource/owasp-top-10-for-llm-applications-2025/)
19. [Google Secure AI Framework](https://developers.google.com/machine-learning/resources/saif)
20. [Google Cloud AI/ML reliability guidance](https://docs.cloud.google.com/architecture/framework/perspectives/ai-ml/reliability)
21. [Google Cloud LLM inference autoscaling guidance](https://cloud.google.com/kubernetes-engine/docs/best-practices/machine-learning/inference/autoscaling)
22. [Google SRE: Handling overload](https://sre.google/sre-book/handling-overload/)
23. [Google SRE: Addressing cascading failures](https://sre.google/sre-book/addressing-cascading-failures/)
24. [FinOps Foundation: FinOps for AI](https://www.finops.org/framework/technology-categories/ai/)
25. [FinOps Foundation: Token economics](https://www.finops.org/wg/token-economics-saas/)
26. [FOCUS for AI](https://focus.finops.org/technology-categories/focus-for-ai/)
27. [OpenTelemetry GenAI semantic conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/)
28. [Anthropic: Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)
29. [Anthropic: Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
30. [OpenAI evaluation best practices](https://developers.openai.com/api/docs/guides/evaluation-best-practices)
31. [OpenAI agent workflow evaluation](https://developers.openai.com/api/docs/guides/agent-evals)
32. [Microsoft GenAI gateway architecture](https://learn.microsoft.com/en-us/azure/architecture/ai-ml/guide/generative-ai-gateway)
33. [ICO guidance on AI and data protection](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/artificial-intelligence/guidance-on-ai-and-data-protection/)
34. [ICO generative AI consultation response](https://ico.org.uk/about-the-ico/what-we-do/our-work-on-artificial-intelligence/response-to-the-consultation-series-on-generative-ai/)
35. [UK guidance on explaining decisions made with AI](https://www.gov.uk/data-ethics-guidance/explaining-decisions-made-with-ai)
36. [FCA approach to AI](https://www.fca.org.uk/firms/innovation/ai-approach)
37. [EU AI Act official text](https://eur-lex.europa.eu/eli/reg/2024/1689/oj/eng/)
38. [EU Commission: Navigating the AI Act](https://digital-strategy.ec.europa.eu/en/faqs/navigating-ai-act)
39. [MLCommons AILuminate safety benchmark](https://mlcommons.org/benchmarks/ailuminate/)

Internal evidence:

- [Architecture](../../ARCHITECTURE.md)
- [On-device inference PRD](../prd/113-on-device-inference-crisis-drafts.md)
- `packages/platform/src/llm.ts`
- `packages/platform/src/llm-budget.ts`
- `packages/platform/src/llm-response-cache.ts`
- `packages/platform/src/cost-ledger.ts`
- `packages/platform/src/memory/LocalEmbeddingProvider.ts`
- `apps/api/src/local-model.ts`

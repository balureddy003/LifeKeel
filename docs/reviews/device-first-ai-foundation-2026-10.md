# Device-first AI: the foundation for low-cost, private, resilient LifeKeel

Research and design date: 20 October 2026. Status: **architectural posture
proposal for review**. Extends
[cascade-framework-2026-10.md](cascade-framework-2026-10.md) and grounds it in
the actual 2026 on-device landscape.

## The thesis — with one honest correction

The user's direction is right: **on-device inference should be the default
compute tier, not a niche opt-in.** It is the only tier that simultaneously
removes per-token cost, network dependency, provider retention questions, and
the rule-3 training surface entirely. But one claim needs correcting before it
becomes a foundation:

> On-device models are **not more accurate** than hosted models. 2025–2026
> mobile benchmarks put commodity-device SLMs at roughly ~39–61% MMLU vs
> 73–84% for cloud models, with single-digit-to-tens-of-seconds latencies on
> CPU-bound devices. The practitioner literature is blunter: *"the most
> reliable on-device LLM feature is one where the LLM does the least"*
> (Palabrita case study, arXiv 2604.24636).

The correct posture is therefore not "device models instead of cloud," it is:

> **Deterministic code owns truth. On-device models own language for every task
> whose scope is narrow enough to make them reliable. Hosted models exist only
> as a governed escalation tier for what the device demonstrably cannot do.**

LifeKeel is unusually well-positioned for this *because* of the deterministic-
first architecture: the hard part — the math, the detectors, the readiness
algebra — never needed a big model. What needs language is narration,
extraction-assist, triage, and drafting: precisely the bounded tasks small
models handle when the task is narrow and the fallback is deterministic.

The production proof point: ixi-sLM, a 1.2B domain-adapted model, reaches **94%
of a state-of-the-art cloud LLM's task-weighted quality** in production on
mobile NPUs — but only through domain adaptation (task-aware quantization,
vocabulary trimmed to the domain), and only in its own domain (Korean call-
agent workloads — generalizing to English fintech narration is our inference,
not the paper's claim). Lesson: on-device quality is *engineered per-task*,
not generic.

---

## 1. The 2026 on-device landscape (verified)

| Surface | What exists today | Constraints |
|---|---|---|
| **Apple Foundation Models** (iOS 26+, iPadOS, macOS) | Free on-device LLM via native Swift API: guided generation, tool calling, Vision-framework OCR integration; Private Cloud Compute for harder tasks, free under App Store Small Business terms (<2M downloads); iOS 27 adds multimodal + Core AI (bring-your-own model, ahead-of-time compilation, memory-safe) | Apple platforms only; model capability bounded; context ~32k for PCC tier |
| **Chrome built-in AI** (Gemini Nano, Chrome 138+) | Prompt API (JSON-schema structured output + multimodal in origin/stable), Summarizer, Translator, Language Detector, Writer/Rewriter (trials) | Chrome/Edge only — not Firefox/Safari; ~22GB storage + 16GB RAM floor; model can be evicted by OS; availability must be feature-detected |
| **WebLLM / Transformers.js** | Already shipped in LifeKeel for opt-in crisis drafts | WebGPU needed; model download size; battery/thermal |
| **Capacitor shell** (apps/mobile) | Can bridge to Apple's Foundation Models via a small native plugin — the highest-leverage device path since mobile is where sensitive capture happens | Requires native plugin work; Android counterpart is Gemini Nano / AICore (uneven) |
| **Local CPU encoders** | Already running: bge-small embeddings, GLiNER relevance pre-classifier | Not device — LifeKeel-controlled infra; still zero-provider-egress |

**Structural implication:** the device tier is real but *fragmented* — three
different device runtimes (Apple FM, Gemini Nano, WebLLM) with different
capabilities, availability, and quality. The framework's job is to make that
fragmentation invisible behind one task contract.

## 2. Revised ladder: device-first ordering

Cascade's ladder stays; the **default entry point changes** for any task whose
policy marks it device-eligible:

```
T0 Deterministic (always first — truth is code)
T5 Device built-in model (Apple FM / Gemini Nano / WebLLM)  ← new default for
    eligible language tasks
T1 LifeKeel-local encoder/classifier (server-side, zero egress)
T2 LifeKeel-local constrained decision model (Ollama-class)
T3 Hosted small (only where T5 unavailable/failed or policy disallows device)
T4 Hosted strong (only tasks whose policy names it)
```

Rules that make device-first safe:

1. **Feature-detect, never assume.** Every T5 call is wrapped in capability
   detection (`'LanguageModel' in self`, Apple FM availability, WebGPU check).
   Unavailable → escalate down-ladder per task policy, or honest degraded mode.
2. **Narrow tasks only.** A task is device-eligible when its eval suite passes
   on the *weakest* supported device runtime — not on the best. The eval suite
   is the gate; enthusiasm is not.
3. **Deterministic fallback for structure.** Device output always flows through
   the same C4 guard stack; a malformed result falls back to a template/code
   path, not a retry loop that burns battery.
4. **The task never crosses boundaries silently.** `device_only` policies have
   no server path by construction (already enforced); `device_preferred` tasks
   may escalate to T1–T3 with an explicit logged reason.

## 3. The killer composition: on-device minimization as a service

This is the highest-value pattern in the document, and it's ownable:

> **The device's first job is not generating text — it's shrinking what the
> server ever sees.**

Concrete applications:

- **Device-side document pre-processing**: on-device Vision/OCR (Apple Vision
  framework, Gemini Nano multimodal) extracts text locally; only the *field
  candidates* — not the document — upload for verification. The vault's most
  sensitive content never transits a provider.
- **Device-side PII screen**: before any T3/T4 hosted call, a device encoder
  strips/masks named entities so the hosted context is maximally anonymous —
  the P6 "privacy by shaping" pattern executed *before egress*, on hardware the
  family owns.
- **Device-side triage of inbox captures**: the email-scan relevance
  pre-classifier (GLiNER today, server-side) can run on-device for the mobile
  capture path — the server learns "a renewal notice exists" without the
  message body ever leaving the phone.

This flips the architecture's data-flow economics: **egress becomes the scarce
resource the device tier protects**, not the other way around. It composes
directly with Compiled Context (P2): the compiler has a *device stage* whose
output is the only thing allowed off-device.

## 4. What this enables that competitors can't easily match

| Claim | Why it's structurally hard for incumbents |
|---|---|
| "Your documents are read on your phone, not our servers" | Trustworthy/Origin/ChatGPT Finances are server-pipeline products; their OCR/extraction economics depend on cloud ingress |
| "Crisis guidance works offline" | A vault you can't reach without connectivity fails exactly in the emergency it's for; device-first makes Emergency Mode network-independent |
| "We can't train on your data — we mostly can't see it" | Rule 3 trends toward a *structural* property (no egress by default) rather than a purely contractual one — but only while on-device succeeds *and* failure paths don't silently egress; fallback policy is part of the guarantee |
| Marginal cost ≈ 0 for the growing share of AI work | Hosted-model COGS approaches zero as device coverage grows; subscription margin improves with usage instead of eroding |
| No queue, no provider outage, no region restriction | Provider incidents (breaker-open events) degrade only T3/T4 tasks |

## 5. The accuracy engineering program (the honest work)

Device-first fails if it's vibes. The program that makes it real:

1. **Per-task device eval suites.** Extend golden datasets to run *against
   device runtimes*: the same eval passes per-runtime or the task doesn't ship
   on that runtime. Device capability matrix (runtime × model version × memory
   class) is a first-class eval dimension.
2. **Responsibility reduction by design** (Palabrita's hard-learned heuristic):
   device tasks emit *bounded artifacts* — JSON fields, picks from a list,
   three-sentence drafts — never open-ended documents. Where a task is too
   broad, split it until the device part is trivial.
3. **Domain adaptation where it pays.** ixi-sLM's lesson: a small model adapted
   to LifeKeel's vocabulary/task distribution closes most of the quality gap.
   Path: synthetic-first distillation (P5) → quantized students packaged per
   task class. This is a later investment, gated on task-eval deltas.
4. **Deterministic fallback is a feature, not a failure.** Every device task
   ships with a code path that produces an acceptable (if less fluent) result.
   Degraded mode is already an architectural value (`isLive: false`) — extend
   it to device tiers.
5. **Measure on real devices.** A device-quality dashboard: rejection rate,
   fallback rate, latency p95, per runtime/model version. This is the device
   equivalent of cost-per-correct — *success per device-task*.

## 6. Updated task-eligibility matrix (initial — eval suites decide)

| Task class | Device-eligible? | Rationale |
|---|---|---|
| Ask Keel narration | device_preferred | Bounded narration over computed facts; weakest-runtime eval decides |
| Scenario narration | device_preferred | Small, structured input; high privacy value |
| Crisis drafting | device_only / device_preferred | Already built via WebLLM; offline resilience is the point |
| Inbox capture triage | device_preferred | On-device relevance screen before any egress |
| Vault document pre-extraction | device_preferred | OCR on device, field candidates up, document stays home |
| Youth answer | **device_only candidate** | Currently `lifekeel_infra_required`; device is even stronger than self-hosted for the children's-data posture |
| Detector/detector-math | never (deterministic) | T0 — no model involved |
| Email body analysis | T1/T2 first | Server-side encoders; device pre-screen helps |
| Complex multi-doc synthesis | T3/T4 only | Beyond reliable device scope today; revisit as models improve |
| Support drafting | T3 (no family data) | Low value to device-route; keep hosted cheap tier |

## 7. Architecture deltas if approved

1. **§8.1 cascade** — ladder reordered; device becomes default-eligible lane
   with the abstention contract unchanged.
2. **§8.2 capabilities** — add "device runtime matrix" (Apple FM, Gemini Nano,
   WebLLM) and device-side minimization as named capabilities.
3. **§8.3 gateway** — add the device stage to context compilation: task policy
   gains `device_minimization` semantics (what may leave the device); gateway
   still governs escalated calls identically.
4. **§8.8 data-use** — "device-first" becomes the default privacy posture
   statement: provider calls are the *exception* a task must justify, not the
   norm.
5. **`apps/mobile`** — Capacitor plugin bridging Apple Foundation Models (and
   Gemini Nano/AICore where present) into the shared task interface; mobile
   becomes the primary device-compute surface.
6. **New eval dimension** — device-runtime matrix in eval harness; promotion
   requires weakest-runtime pass.

## 8. Risks and honest limits

- **Fragmentation** — three runtimes, uneven quality, Firefox/Safari absent,
  Android AICore inconsistent. Mitigation: the framework's runtime matrix +
  abstention contract; ship per-runtime, not "device support" as a boolean.
- **Battery/thermal/first-download cost** — the user's device pays; make heavy
  tasks opt-in and measure abandonment.
- **Accuracy ceiling** — some tasks will never qualify for device; that's fine.
  The ladder keeps them honest at T3/T4 under full governance.
- **Model eviction/version drift** — OS can remove or silently upgrade built-in
  models; eval pins per model version and availability checks handle this.
- **Don't oversell externally.** "On-device" claims must name which tasks and
  which platforms — a blanket "all AI runs on your phone" would be false.

## 9. The positioning sentence this unlocks

> **"Keel's private by physics: for most tasks, your family's information never
> leaves your devices — and where a bigger model is genuinely needed, it sees a
> minimized projection, never the raw record."**

That is a claim Origin, Trustworthy, ChatGPT Finances, and Monarch cannot make
without re-architecting their data ingress — it's architecture, not ad copy.

**Honesty caveat before using it externally:** the sentence is only true when
the implementation is. It requires: (a) opted-in device tasks treat generation
failure as *local* failure (deterministic fallback or abstain), never silent
cloud egress; (b) any consented cloud escalation goes through the reversible
curtain; (c) claims name which tasks and platforms — "most tasks" must be
measured coverage, not aspiration. Today this is the *target* state; say
"designed so" until the slices ship.

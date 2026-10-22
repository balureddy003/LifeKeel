# Decision record: CPU-local serving of interactive generation is closed

Date: 22 October 2026. Status: **decided** — do not re-litigate without new
hardware assumptions. Recorded in ARCHITECTURE.md §8.4b; supersedes the
"leave `LOCAL_TEXT_ENABLED` off until a side-by-side" guidance in
`infra/local-judge/README.md`, which is now historical context.

## What was measured

Production, deployed `qwen2.5:7b` Ollama service (Cloud Run, 4 vCPU / 8 GiB),
production-shaped Ask Keel prompt, 6 requests per concurrency level, one run:

| Concurrency | Errors | p50 | p95 | Max | Calls/min |
|---|---|---|---|---|---|
| 1 | 0 | 50.0s | 58.7s | 69.1s | 1.2 |
| 2 | 0 | 50.4s | 69.1s | — | 2.0 |

- `assistant.answer.v1` / `.sensitive.v1` deadline is 30s. **Every interactive
  question timed out and returned the canned fallback** (`isLive: false`).
  Compliance behaviour of the real model (advice probes, prompt injection)
  was never exercised — the model never answered.
- Output generation dominates: ~15s prompt eval + ~33s to write ~100 tokens
  at ~3 tok/s on CPU. This is a hardware constant for dense 7B models on this
  instance type, not a tuning gap.
- The gateway deadline is a `Promise.race` and does not cancel the Ollama
  fetch (`OLLAMA_TIMEOUT_MS` = 180s). Abandoned calls keep generating on the
  judge: backlog builds, later calls draw 429s, `withRetry` retries them
  inside the next call's deadline — a self-reinforcing pileup.
- Concurrency 2 on a warm second instance gave ~1.7x throughput; cold second
  instances mostly returned 429 while loading the model.

## Decision

1. **General interactive generation** (Ask Keel general path, drafts,
   support) runs on a small hosted processor behind the task gateway — or
   on-device where the user has opted in. It never runs on the CPU-local
   model. `LOCAL_TEXT_ENABLED` stays off for general interactive traffic.
2. **Quarantined tasks** (`assistant.answer.sensitive.v1`,
   `assistant.youth_answer.v1` — `lifekeel_infra_required`) keep the local
   model and accept the latency, surfaced honestly as proof of the boundary.
3. **Batch tasks** (email classify/extract, delivery judge, OCR) keep the
   local model; their deadlines move to batch-appropriate values and the
   work is progressively de-generated (encoder/extractor + templates first).
4. **Serving bugs found here are fixed regardless of model choice:**
   model-side cancellation on deadline (not a client-side race), bounded
   admission, and bulkheads between background and interactive capacity.
5. The product answer to assistant latency is the **verified-answer tier**
   (PRD-212): factual questions resolve to deterministic operations and
   never call a model at all.

## What would reopen this

- A GPU-priced serving path that clears the self-hosting gate
  (ARCHITECTURE.md §8.12) on measured cost per accepted result, or
- a measured 2-3x CPU inference improvement on the exact serving instance
  (new MoE/quantization/runtime), re-evaluated through `judge-load-test`
  and the task evals — for **batch and quarantine** paths first.

A newer small model (4B class) at ~2x decode speed lands ~23s p50, which is
still marginal against 30s with no p95 headroom. That is not a reopening:
it trades timeouts for guard rejections without fixing the product.

## References

- Repo measurements: `infra/local-judge/README.md` (capacity, interactive
  smoke test, model eval gates).
- Strategy: `llm-system-one-and-open-model-strategy-2026-10.md` (cascade,
  hosted-default economics), `llm-usage-patterns-low-cost-and-private-2026-10.md`
  (P1–P8 patterns).
- Delivery: PRD-211 (Phase 0), PRD-212 (verified answers), PRD-215
  (efficiency hardening).

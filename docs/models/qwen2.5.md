# Model card — qwen2.5:7b (local judge / classifier / OCR / LOCAL_TEXT)

| | |
|---|---|
| Source | `registry.ollama.ai/library/qwen2.5` tag `7b` |
| Pinned as | OCI manifest `sha256:845dbda0ea48ed749caafd9e6037047aa19acfcfd82e704d7ca97d631a0b697e` (see `ai-bom.yaml`) |
| Licence | Apache-2.0 |
| Params | ~7.6B instruct |
| Runtime | Ollama on our own CPU service (`infra/local-judge/Dockerfile`) |

## What it does here

Backs four self-hosted paths, all gated behind `LOCAL_JUDGE_BASE_URL`:

- the move judge (`delivery/local-judge.ts`) — pre-flight safety screen on
  insight copy before it can reach a family,
- the email classifier (`email/classify.ts`) — behind a keyword prefilter,
- document OCR assist (`LOCAL_OCR_MODEL`),
- the `LOCAL_TEXT` AI-gateway route for family-data text tasks.

## What data it sees

Family content — insight copy, inbound email text, document snippets. That is
the point: this model exists so those paths never touch a hosted LLM. All
inference is in our infrastructure; no tenant data reaches a third party.

## Evidence and limits

Chosen by smoke test on 6 labelled cases (`infra/local-judge/README.md`):
7b blocked all unsafe copy; 3b rewrote rather than passed it; 1.5b passed
unsafe copy outright and is banned. Six cases is a smoke test, not an
evaluation — groundedness is NOT delegated to the model; the deterministic
`move-guard.ts` screens output regardless.

## Update process

Bump `tag` + `pin.value` in `ai-bom.yaml`, update the `MODEL`/`MODEL_DIGEST`
ARGs in `infra/local-judge/Dockerfile` (the architecture tripwire enforces
they match), re-run the README smoke test, redeploy the judge service.

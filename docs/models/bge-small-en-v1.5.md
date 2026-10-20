# Model card — Xenova/bge-small-en-v1.5 (local embeddings)

| | |
|---|---|
| Source | `huggingface.co/Xenova/bge-small-en-v1.5` (ONNX export of BAAI/bge-small-en-v1.5) |
| Pinned as | HF revision `ea104dacec62c0de699686887e3f920caeb4f3e3` (see `ai-bom.yaml`) |
| Licence | MIT |
| Params | ~33M encoder |
| Runtime | `@huggingface/transformers` in-process via `LocalEmbeddingProvider` |

## What it does here

Tier-2 of the intent classifier: embeds event text for centroid matching.
Free and ~5–10 ms on CPU; the accuracy delta vs `text-embedding-3-small` for
short event text is negligible, and cloud embeddings stay reserved for
long-form RAG.

## What data it sees

Event/insight text, in-process. The model downloads once (build or first
use) into the local HF cache; inference never leaves the process.

## Evidence and limits

Chosen for cost: removes a per-event cloud call. An LRU cache (10K entries,
24h) covers repeats. If the provider is unavailable the classifier degrades
to trie + LLM-tier rather than failing requests.

## Update process

Bump `pin.value` in `ai-bom.yaml` and `DEFAULT_LOCAL_EMBEDDING_REVISION` in
`packages/platform/src/memory/LocalEmbeddingProvider.ts` (tripwire enforces
the match); re-run intent-classifier evals before deploying.

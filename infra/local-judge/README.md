# local-judge

CPU-only Ollama serving the small open-source model that backs the move judge
(`apps/api/src/delivery/local-judge.ts`). When `LOCAL_JUDGE_BASE_URL` is set the
API never sends insight text to a cloud LLM for judging, and the judge spends no tokens.

## Model choice (measured, small sample)

Smoke test of the real evaluator on 6 labelled cases (good copy, two
advice/provider-steering cases, PII, an ungrounded figure, vague copy),
4 CPU cores, Ollama 0.35:

| Model | Correct | Unsafe copy | Latency/call |
|---|---|---|---|
| qwen2.5:1.5b | 1/6 | **passed all of it** | ~4s |
| qwen2.5:3b | 3/6 | never passed (rewrite/block) | ~6s |
| qwen2.5:7b | 4/6 | all blocked | ~15s |

- **Never use 1.5b or smaller.**
- No size caught the ungrounded-figure case. Do not rely on the model for
  groundedness; family detector figures are template-rendered, and the
  deterministic guard (`packages/engine/src/move-guard.ts`) does the safety screening.
- Six cases is a smoke test, not an evaluation. Re-measure on `detector-evals/`
  and a larger labelled set before relying on it.

## Deploy (manual, like the API)

Needs roughly 8 GiB RAM and 4 vCPU for the 7b model. Judging is asynchronous
(delivery queue), so ~15s per call is acceptable; the first call after a cold
start also pays model load.

```
docker build -t REGION-docker.pkg.dev/PROJECT/REPO/agentoak-local-judge infra/local-judge
gcloud run deploy agentoak-local-judge --image ... --cpu=4 --memory=8Gi \
  --no-cpu-throttling --min-instances=1 --max-instances=2 --concurrency=1 \
  --port=11434 --ingress=internal
```

Ollama has no authentication. Keep the service internal-only (VPC connector or
internal ingress). Do not expose it publicly. Then set the repo variables
`LOCAL_JUDGE_BASE_URL` (and optionally `LOCAL_JUDGE_MODEL`) that `deploy-api.yml`
passes to the API.

`min-instances=1` is a real standing cost (CPU/RAM always allocated); weigh it
against cold starts. With `min-instances=0`, a judge call on a cold instance
can time out and the insight is queued for retry/human review, not lost.

## Failure behaviour

Unreachable, timed out, or "uncertain": the insight is blocked and queued for
human review. There is no cloud fallback by design.

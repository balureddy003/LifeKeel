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

## Email classifier (same server)

`apps/api/src/email/classify.ts` also runs on this server when
`LOCAL_JUDGE_BASE_URL` is set, behind a keyword prefilter
(`email/prefilter.ts`) that skips the model for mail with no policy or
protection terms. Measured on 16 synthetic labelled emails
(`email/__fixtures__/labelled-emails.ts`), model only, no prefilter:

| Model | Classified correctly | Recall | False positives | Policy fields | Avg/email |
|---|---|---|---|---|---|
| qwen2.5:3b | 15/16 | 7/8 | 0 | 5/7 | ~14s |
| qwen2.5:7b | 15/16 | 7/8 | 0 | 6/7 | ~22s |

- Both resisted the prompt-injection email and both missed the same borderline
  "review your will" email.
- Decoding schemas must mark every key **required with an explicit null option**.
  With optional keys the small models skipped fields they could read (7b policy
  fields were 2/7 before this fix, 6/7 after). Extracted fields only ever *propose*
  a profile update that a human approves, never auto-applied.
- Classification quality was equal, so `LOCAL_CLASSIFIER_MODEL=qwen2.5:3b`
  halves latency, at the cost of keeping a second model resident (~2 GB more RAM).
  Left at the judge model by default so only one model is loaded.
- Sample is small and synthetic. Re-measure on real mail before widening use.
- Classifier errors fall back to "not financial" (same as the cloud path
  today), so a model outage can silently drop an email. The UID cursor still advances.

## Document OCR (same server + Tesseract in the API image)

With `LOCAL_JUDGE_BASE_URL` set, uploaded documents and email attachments are read
locally (`apps/api/src/ocr/local-ocr.ts`, `extract.ts`): images go through the
Tesseract binary, PDFs through their text layer, then the self-hosted model fills a
fixed set of fields. Nothing is sent to a cloud vision model. `LOCAL_OCR_MODEL`
overrides the model for this task only.

Measured on 8 synthetic documents (life policy, pension, mortgage, payslip; each
rendered clean and degraded with rotation, blur and noise), 4 CPU cores:

| Model | Category | Fields | Avg/doc (model, after OCR) |
|---|---|---|---|
| qwen2.5:3b | 8/8 | 32/32 | ~28s |
| qwen2.5:7b | 8/8 | 30/32 | ~39s |

- Tesseract read all 32 key tokens correctly on both clean and degraded renders
  (~0.3s per image).
- **3b beat 7b here**: 7b is more conservative and left the payslip employer out.
  `LOCAL_OCR_MODEL=qwen2.5:3b` is the better choice for documents.
- Not covered: handwriting, phone photos with perspective or glare, non-English
  text, tables spanning pages, scanned PDFs (still skipped, as before). The
  synthetic renders are cleaner than real scans, and the cloud vision model was
  not available to compare against. Re-measure on real uploads before relying on it.
- Needs `tesseract-ocr` in the API image (added to `apps/api/Dockerfile`, not
  build-tested here).

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

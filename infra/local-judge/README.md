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
- **Failures are retried, not dropped.** A model failure is a distinct `failed`
  result, not a "not financial" verdict. The scan holds its cursor before the
  first unclassified email so the next scan retries it, and stops after 3
  consecutive failures (a down model would otherwise cost a full timeout per
  email). Attempts are only counted against an email when others succeed in the
  same scan (a poison pill, not an outage), and after 5 the email is given up on
  and logged so it cannot block the mailbox forever. Emails after a held cursor
  that were already handled are skipped by message-id dedup; not-financial ones
  are re-classified (cheap: most are skipped by the prefilter).

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
- **Failures are retried.** An OCR-engine or model failure marks the document
  `status: 'error'` with a `retry_count` (never a fake "extracted" result). A cron
  (`document-ocr-retry`, every 10 min, under the cron lock) retries documents that
  failed at least 5 minutes ago, up to 3 attempts total and 5 documents per sweep.
  After that the document stays in `error` for a human; `POST /documents/:id/reprocess`
  still works. Documents that failed before `retry_count` existed are not retried.
- Needs `tesseract-ocr` in the API image (added to `apps/api/Dockerfile`, not
  build-tested here).

## Interactive text: Ask Oak, support, drafts, prep notes (explicit opt-in)

Unlike the paths above, these are interactive, so they stay on the cloud router
unless you set `LOCAL_TEXT_ENABLED=true` (with `LOCAL_JUDGE_BASE_URL`).
`LOCAL_TEXT_MODEL` overrides the model. When enabled there is no cloud fallback:
the output is screened and a rejected answer becomes the route's existing safe
fallback (`isLive: false` for Ask Oak, `null` for drafts).

Output guard (`apps/api/src/local-model.ts`): rejects regulated advice, affirmative
provider steering, PII/credentials, a well-known provider name the prompt did not
supply, and any figure of 3+ digits that is neither in the prompt nor the sum or
difference of two figures in it. Percent and division results are rejected on
purpose: they are the projections the assistant is told never to make.

Measured on 8 prompts (grounded question, two "which insurer / should I switch"
baits, "email my insurer for me", an injection asking for guaranteed returns, a
"what if income drops 20%" with no calculator result, a draft and a prep note),
4 CPU cores:

| Model | Shown to user | Blocked by guard | Avg latency |
|---|---|---|---|
| qwen2.5:3b | 5/8 | 3 (injection, invented projection, fabricated prep-note budget) | ~14s |
| qwen2.5:7b | 6/8 | 2 (injection, invented projection) | ~26s |

What this showed:
- Both models broke the "never invent a projection" rule and computed figures
  that were not in the data; 3b also invented rent/utilities amounts in a prep
  note. Without the grounding check those would have reached users.
- Both refused to name an insurer, and refused to act on the family's behalf.
- Answers are slow for chat: 6-50s depending on model and answer length.
- The guard first flagged a compliant refusal ("I cannot recommend a specific
  insurer", which mentions "the best insurer") and a correct shortfall (7,500 -
  6,000 = 1,500). Both were fixed, which is why the numbers above use the refined
  guard. Expect further false positives in real use: they fail safe (fallback
  shown) but cost usefulness.
- 8 prompts, one run each, and model output varies between runs. Quality of the
  answers that passed was read by hand, not scored, and was not compared with
  the cloud model. Treat this as a go/no-go smoke test, not a quality evaluation.

Recommendation: keep the judge, email, and OCR on the local model (background,
latency irrelevant) and leave `LOCAL_TEXT_ENABLED` off until a larger
side-by-side against the cloud model shows acceptable quality and you accept the
latency. Marketing posts and the operator console carry no family data and stay
on the cloud router.

## Capacity and scaling (measured)

On 4 CPU cores with `qwen2.5:3b`, sending 6 email classifications at 1, 2 and 4
concurrent calls:

| Concurrent calls | Throughput | Avg time per call |
|---|---|---|
| 1 | 3.8 emails/min | 15.8s |
| 2 | 3.9 emails/min | 28.2s |
| 4 | 3.8 emails/min | 47.3s |

- **One CPU model instance is a fixed ~3.8 emails/min (about 5,500/day) at 3b.**
  Parallel calls only add latency and timeout risk. Hence
  `LOCAL_MODEL_MAX_CONCURRENT` defaults to 1 per API process, and the model service
  runs with `--concurrency=1`.
- **Throughput scales by adding model instances**, not client concurrency. Set
  `LOCAL_MODEL_MAX_CONCURRENT` to the number of instances the autoscaler can
  provide, and note it is per API process (total in flight = value x API replicas).
  Excess requests queue at the load balancer, so their wait counts against the
  120s per-call timeout: watch `agentoak_local_model_queue_wait_seconds`.
- **Email scan fan-out** (`EMAIL_SCAN_FANOUT=true`) runs one queue job per mailbox
  with `EMAIL_SCAN_CONCURRENCY` workers per process (default 2). The queue itself
  scales linearly (real Redis, 8 jobs of 1s: 9.0s, 5.0s, 3.0s at concurrency 1, 2, 4),
  but a scan is model-bound, so fan-out only helps if model capacity grows with it.
  With a single model instance leave it off.
- 7b is slower than 3b (about 1.5-2x per call here), so budget fewer calls per
  instance if you keep it for the judge.
- Numbers come from one 4-core sandbox and a small email sample; load-test on the
  real instance type before sizing production.

## Metrics

Exposed on the Prometheus endpoint: `agentoak_local_model_calls_total{purpose,outcome}`,
`agentoak_local_model_latency_seconds{purpose}`,
`agentoak_local_model_queue_wait_seconds{purpose}`,
`agentoak_output_guard_blocks_total{reason}`,
`agentoak_email_classify_failures_total`,
`agentoak_document_extraction_retries_total`. Suggested alerts: error ratio of
`local_model_calls_total` above a few percent, a rising p95 of queue wait (model
undersized), and a sustained non-zero `email_classify_failures_total`.
Labels are reason and purpose codes only, never tenant ids, email text or figures.

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

# Model card — fastino/GLiNER2.5-Decide (policy-relevance encoder)

| | |
|---|---|
| Source | `huggingface.co/fastino/GLiNER2.5-Decide` |
| Pinned as | HF revision `9d1bfb848cd16d93ee56ccbc59cd92bf0f284d90` (see `ai-bom.yaml`) |
| Licence | Apache-2.0 |
| Params | ~435M (DeBERTa-v3-large encoder, no generation) |
| Runtime | `infra/encoder-service` (CPU, behind Cloud Run IAM) |

## What it does here

Single fixed-purpose endpoint `POST /v1/policy-relevance`: is an inbound
email about an insurance/pension/mortgage/estate policy the household
already holds. Label wording is tuned and frozen in
`infra/encoder-service/server.py` — changing it invalidates the eval
numbers. `EMAIL_ENCODER_MODE` runs it `shadow` (measure only) or `gate`.

## What data it sees

Email from/subject/body — family content, on our own CPU service. Nothing
leaves our infrastructure.

## Evidence and limits

`infra/encoder-eval/README.md`: 20/20 on a frozen held-out set, zero false
positives, ~455 ms/email — ~25–50× faster than the generative path on the
same hardware. Caveats recorded there apply: the set is small, synthetic
and single-author; field extraction (`extract_json`) was partial and is not
used.

## Update process

Bump `pin.value` in `ai-bom.yaml` and `ENCODER_MODEL_REVISION` in
`infra/encoder-service/Dockerfile` (tripwire enforces the match); re-run
the held-out eval before redeploying the service.

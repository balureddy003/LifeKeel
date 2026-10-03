# encoder-service

A small CPU service that answers one question: *is this email about an insurance,
pension, mortgage or estate policy the household holds?* It runs
`fastino/GLiNER2.5-Decide` (an encoder, not a text generator), so a call takes ~0.4s
instead of the ~10-20s an LLM needs on the same CPU. Evidence and caveats:
[`../encoder-eval/README.md`](../encoder-eval/README.md). Read them: the numbers are
from small synthetic sets.

It is a **gate or a shadow in front of the LLM classifier, never a replacement**: it only
decides relevance. Summary, action and policy-field extraction stay with the LLM (the
encoder's extraction was partial).

## How the API uses it

Off by default. Set `EMAIL_ENCODER_URL` and `EMAIL_ENCODER_MODE`:

| Mode | Behaviour | Effect on results |
|---|---|---|
| `off` / unset | not used | none |
| `shadow` | the LLM decides as before; the encoder is compared afterwards, never awaited by the decision | none |
| `gate` | an email the encoder calls irrelevant skips the LLM; relevant ones still go to the LLM | fewer LLM calls |

**Roll-out:** run `shadow` first, then move to `gate` only when
`agentoak_email_encoder_total{outcome="encoder_missed"}` stays at zero over real volume.
`encoder_missed` means the LLM found a policy email the encoder called irrelevant, which in
gate mode would be a silently dropped email. The other outcomes: `agree`, `encoder_extra`
(costs an LLM call in gate mode, not safety), `gated_skip`, `gated_pass`, `shadow_error`,
`error_fell_back`.

**Failure behaviour:** an encoder error, timeout or bad response never drops an email; the LLM
path runs as if no encoder were configured. Latency and errors appear under
`agentoak_local_model_*{purpose="encoder"}`.

## Run locally

```
python -m venv venv && venv/bin/pip install torch==2.14.1 --index-url https://download.pytorch.org/whl/cpu
venv/bin/pip install -r requirements.txt
PORT=8080 venv/bin/python server.py          # /healthz is 503 until the model has loaded
python3 -m unittest test_server -v           # request-handling tests; need no torch or model
```

Measured on 4 CPU cores: ready in ~20s when the model files are warm in the disk cache, and
over 2.5 minutes on the first cold start, so measure cold start in the real container.
Classification takes ~0.4s. Loading works with `HF_HUB_OFFLINE=1` once the files are present.

## Deploy

Same pattern as the model service (see `../local-judge/README.md`): Cloud Run with
`--no-allow-unauthenticated`, `--concurrency=1`, and the API's service account granted
`roles/run.invoker`. The API reuses `LOCAL_JUDGE_AUTH=cloudrun-iam` for the identity token.
It needs far less than the LLM service (about 2 GiB and 2 vCPU should suffice, **unmeasured**:
check memory in the real container). There is no deploy workflow for it yet, and the
Dockerfile has not been built (no Docker daemon in the dev environment).

## Limits to know

- One endpoint, one fixed label set (`server.py`), tuned on the 16-email set and frozen.
  Changing the wording invalidates the eval numbers.
- Packaging is fragile: `gliner2==2.0.0` omits several dependencies (pinned in
  `requirements.txt`) and `fastino/gliner2.5-base-v1` fails to load with it.
- Licences are unreviewed: the paper states CC-BY-4.0; check the model card, the DeBERTa
  base and the Python package before production use.
- Confidence is weakly calibrated: correct positives scored 0.40-0.81, so the service
  returns the top label rather than relying on a confidence threshold.

# Encoder model experiment (GLiNER2) for email classification

Question: can a small open **encoder** model (no text generation) replace the LLM for
email classification, at a fraction of the CPU cost? This directory holds the
experiment so the result can be reproduced and challenged. **It is not wired into the
API.**

## Results (4 CPU cores, `fastino/GLiNER2.5-Decide`, ~435M params, DeBERTa-v3-large encoder)

| Set | Labels | Correct | Recall | False positives | Latency |
|---|---|---|---|---|---|
| tuning-emails.json (16) | broad negatives | 14/16 | 8/8 | 2 (SIPP promo, "statement available") | ~400 ms/email |
| tuning-emails.json (16) | sharper negatives | 16/16 | 8/8 | 0 | ~400 ms/email |
| **heldout-emails.json (20), labels frozen** | sharper negatives | **20/20** | **10/10** | **0** | ~455 ms/email |

For comparison, the generative models measured earlier (same 4 cores, different 16-email
set): qwen2.5 3b 15/16, 0 false positives, ~10-14 s/email; 7b ~19-22 s/email. That is
roughly 25-50x slower. A like-for-like LLM run on the held-out set did not finish
inside the time cap, so **the LLM-vs-encoder comparison is not on the same emails**.

Extraction (`extract_json`, ~490 ms/email) was partial: provider found in 5/7 policy
emails, but premium, policy number and several dates were missed. It is not good enough
to replace the LLM for field extraction without more work.

## Caveats (read before trusting the numbers)

- **Synthetic and small.** 16 + 20 emails, short, written by the same author. Real mail
  is longer, messier and more adversarial; expect lower accuracy. The held-out set is
  held out from *label tuning*, not from the author's style.
- **Label wording matters a lot.** The same model scored 14/16 with broad negatives and
  16/16 with sharper ones. Tuning was done on the 16-email set; the 20-email result is the
  honest one.
- **Confidence is weakly calibrated** with a multi-label setup: correct positives scored
  0.40-0.81, so a high-confidence threshold is not usable. Use the top label, or a margin.
- **Packaging is fragile.** `gliner2==2.0.0` does not declare `transformers`, `peft`,
  `accelerate` or `datasets`; `fastino/gliner2.5-base-v1` fails to load with that package
  version (`'ExtractorConfig' object has no attribute 'max_width'`). Pin versions and test
  the image before relying on it.
- **Not run:** prompt-injection robustness beyond the one fixture, long emails, non-English,
  licence review (the paper states CC-BY-4.0; the base encoder and the model card are
  separate and unchecked), memory footprint and cold start in a container.

## Reproduce

```
python -m venv venv && venv/bin/pip install torch --index-url https://download.pytorch.org/whl/cpu
venv/bin/pip install gliner2 transformers peft accelerate datasets
venv/bin/python eval_encoder.py fastino/GLiNER2.5-Decide heldout-emails.json
```

## What was built from this

`../encoder-service` wraps this model in a small CPU service, and the API can use it as a
gate or shadow in front of the LLM email classifier (`EMAIL_ENCODER_MODE`, off by default).
End to end through the real service and the Node client, gate mode avoided 18 of 36 LLM calls
(every irrelevant email) and dropped 0 of 18 policy emails. Still needed before gate mode is
trusted: a held-out set of **real, de-identified** email and a shadow period on live traffic.

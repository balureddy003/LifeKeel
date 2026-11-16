# catboost-service

Tabular anomaly helper for intent 97 slice 8 — **flag-off scaffold**. It
flags months whose money-in/money-out total is unusual vs the household's
own history, using a CatBoost forecaster trained only on the committed
synthetic fixtures (`fixtures/anomaly/`). Rule 3: synthetic data only;
real household pooling needs the intent-96 opt-in.

**Status:** nothing calls this. The API-side baseline
(`apps/api/src/resilience/anomaly-flag.ts`) ships the deterministic
median/MAD rule; CatBoost must beat it on the fixture eval by the
owner-set margin or it is dropped.

## Eval (the gating artifact)

```
pip install -r infra/catboost-service/requirements.txt
python3 infra/catboost-service/evaluate.py
```

Leave-one-household-out: trains on the other 11 synthetic households,
predicts the held-out one, flags residual outliers, prints recall and
false-flag rate next to the baseline's measured numbers.

## Service (if a call site is ever wired)

```
POST /v1/flag-anomalies   {"months": [{"period", "money_in_minor", "money_out_minor"}, ...]}
  -> {"flags": [{"period", "metric", "direction", "score"}]}
GET  /healthz
```

Flags carry no amounts and no applicable value — information for a person,
never an input to an estimate. Deploy internal-only like docling-service;
never a consumer endpoint.

## Tests

```
python3 -m unittest discover -s infra/catboost-service -p 'test_server.py' -v
```

runs without catboost installed (the model is never touched).

# docling-service

CPU worker that turns a stored document (PDF or DOCX bytes) into structured
text and tables for the extraction pipeline — the intended upgrade over the
local `unpdf`/mammoth text layer for scanned or complex-layout statements
(intent 97, slice 3).

**Status: scaffold, flag-off.** Nothing routes here until the owner decides
hosting and the cost ceiling, and until synthetic fixtures prove the parse +
field-extraction + mechanical-check chain beats the current path. The API side
(`apps/api/src/extraction/docling.ts`) only calls this when
`DOCLING_SERVICE_URL` is set, and always falls back to the local path on any
failure.

## Contract

```
POST /v1/parse-document    raw bytes, header X-Document-Mime: application/pdf|docx
  -> {"text": str, "tables": int, "model": str, "latency_ms": int}
GET  /healthz              -> 200 once the converter is loaded
```

- Internal/service-network only: deploy `--no-allow-unauthenticated`; the API
  calls it with its service identity. Never a consumer endpoint.
- No persistent files: input goes to a temp file deleted in `finally`.
- No content in logs: access logging is silenced and errors return a fixed
  string. Queue payloads stay `{documentId, tenantId}` — content never enters
  a queue.
- Output is held for the job only; it is not stored as a new artifact.

## Tests

```
python3 -m unittest discover -s infra/docling-service -p 'test_server.py' -v
```

runs without docling installed (conversion is injected). CI runs the same
command in the `python-services` job, and `images.yml` builds the image and
runs the tests inside it (`docling-image` job).

## Deployment: Cloud Run sidecar (owner decision 2026-11-16)

Docling runs as a **sidecar container in the API's Cloud Run service** — one
deployable, two containers. It cannot share the Node process (Python vs
TypeScript); the sidecar is the closest honest equivalent.

- The API calls it at `http://localhost:<port>` — set
  `DOCLING_SERVICE_URL=http://localhost:8080` in the service env. The flag
  stays off until that var exists, so the sidecar can deploy dark.
- The sidecar needs its own CPU/memory allocation (Docling + torch wants
  ~2-4 GiB); size it in the container spec, not the API's.
- Cloud Run routes ingress to the API container only; the sidecar port is
  internal to the instance. Still deploy the service with authenticated
  ingress off for the sidecar's port — it binds localhost inside the
  instance regardless.
- Apply via `gcloud run services replace` with a two-container spec (export
  the current service YAML, add the docling container under `containers:`,
  keep the API container first). Deploys remain human-gated as usual.
- Cost note: sidecar CPU is billed while the instance runs; with
  `min-instances=0` it only costs during requests/scale-down tail. Docling's
  model load is lazy (`load_converter` thread) so idle instances stay cheap.

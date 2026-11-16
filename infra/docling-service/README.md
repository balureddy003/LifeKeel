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
command in the `python-services` job.

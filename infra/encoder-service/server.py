"""
Policy-relevance classifier service (GLiNER2 encoder), CPU only.

One fixed-purpose endpoint, so the tuned label wording lives here and callers cannot
misuse the model as a general classifier:

    POST /v1/policy-relevance   {"from": "...", "subject": "...", "text": "..."}
      -> {"relevant": bool, "label": str, "confidence": float, "model": str, "latency_ms": int}
    GET  /healthz               -> 200 once the model is loaded

Auth is NOT handled here: deploy with Cloud Run --no-allow-unauthenticated so Cloud Run
rejects requests without a Google identity token (see ../local-judge/README.md).
Inference is serialised with a lock: one CPU model serves one call at a time.
"""
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MODEL_ID = os.environ.get("ENCODER_MODEL", "fastino/GLiNER2.5-Decide")
# HF commit pin (ai-bom.yaml, encoder-model). Set by the Dockerfile; when
# unset the loader resolves `main`, which is mutable — log loudly.
MODEL_REVISION = os.environ.get("ENCODER_MODEL_REVISION")
MAX_BODY_BYTES = 64 * 1024
MAX_FIELD_CHARS = 4000

# Label wording tuned on infra/encoder-eval/tuning-emails.json and frozen before the
# held-out run (see infra/encoder-eval/README.md). Changing it invalidates those numbers.
POSITIVE = "a notice about an insurance, pension, mortgage or estate policy the household already holds"
NEGATIVES = [
    "a bank or card transaction alert or statement notice",
    "a marketing promotion or offer for a new product",
    "an order, receipt or subscription message",
    "a social or app notification",
    "a software usage or quota alert",
]
LABELS = [POSITIVE] + NEGATIVES

_model = None
_model_lock = threading.Lock()   # serialises inference
_ready = threading.Event()


class BadRequest(Exception):
    pass


def load_model():
    """Loaded lazily so the request logic is testable without torch installed."""
    global _model
    from gliner2 import GLiNER2  # imported here on purpose
    if not MODEL_REVISION:
        print("WARNING: ENCODER_MODEL_REVISION unset — loading mutable `main`", flush=True)
    _model = GLiNER2.from_pretrained(MODEL_ID, revision=MODEL_REVISION)
    _model.classify_text("warmup", {"kind": LABELS})
    _ready.set()


def parse_request(raw: bytes) -> dict:
    if len(raw) > MAX_BODY_BYTES:
        raise BadRequest("body too large")
    try:
        body = json.loads(raw)
    except (ValueError, UnicodeDecodeError):
        raise BadRequest("body must be JSON")
    if not isinstance(body, dict):
        raise BadRequest("body must be a JSON object")
    out = {}
    for key in ("from", "subject", "text"):
        value = body.get(key, "")
        if not isinstance(value, str):
            raise BadRequest(f"{key} must be a string")
        out[key] = value[:MAX_FIELD_CHARS]
    if not (out["subject"].strip() or out["text"].strip()):
        raise BadRequest("subject or text is required")
    return out


def classify(model, req: dict) -> dict:
    doc = f"From: {req['from']}\nSubject: {req['subject']}\n\n{req['text']}"
    started = time.time()
    with _model_lock:
        result = model.classify_text(doc, {"kind": LABELS}, include_confidence=True)["kind"]
    label = result["label"] if isinstance(result, dict) else result
    confidence = float(result.get("confidence", 0.0)) if isinstance(result, dict) else 0.0
    return {
        "relevant": label == POSITIVE,
        "label": label,
        "confidence": round(confidence, 3),
        "model": MODEL_ID,
        "latency_ms": int((time.time() - started) * 1000),
    }


class Handler(BaseHTTPRequestHandler):
    def _send(self, status: int, payload: dict) -> None:
        data = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/healthz":
            self._send(200 if _ready.is_set() else 503, {"ready": _ready.is_set()})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/v1/policy-relevance":
            return self._send(404, {"error": "not found"})
        if not _ready.is_set():
            return self._send(503, {"error": "model loading"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > MAX_BODY_BYTES:
                raise BadRequest("missing or oversized body")
            req = parse_request(self.rfile.read(length))
            self._send(200, classify(_model, req))
        except BadRequest as e:
            self._send(400, {"error": str(e)})
        except Exception:
            # Never leak internals or email text in an error.
            self._send(500, {"error": "classification failed"})

    def log_message(self, fmt, *args):  # access logs would contain request paths only, but keep quiet
        pass


def main():
    port = int(os.environ.get("PORT", "8080"))
    threading.Thread(target=load_model, daemon=True).start()
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()


if __name__ == "__main__":
    main()

"""
Docling document-parsing worker (intent 97, slice 3) — SCAFFOLD, flag-off.

One fixed-purpose endpoint so callers cannot misuse the parser:

    POST /v1/parse-document   raw file bytes, X-Document-Mime: application/pdf|docx
      -> {"text": str, "tables": int, "model": str, "latency_ms": int}
    GET  /healthz              -> 200 once the converter is loaded

The API only calls this when DOCLING_SERVICE_URL is set; hosting and the
cost ceiling are an open owner decision (intent 97 §decisions), so nothing
routes here by default. Auth is NOT handled here: deploy with Cloud Run
--no-allow-unauthenticated so Cloud Run rejects unauthenticated requests
(same boundary as infra/encoder-service). The service writes no persistent
files — the upload goes to a temp file that is deleted in `finally` — and
never logs document content; access logging is silenced below.
"""
import json
import os
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MODEL_ID = os.environ.get("DOCLING_MODEL", "docling-project/docling-layout-heron")
# PDF uploads are capped at 50 MB upstream; leave headroom for the envelope.
MAX_BODY_BYTES = 55 * 1024 * 1024
ALLOWED_MIMES = {"application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"}
TEXT_LIMIT = 60_000  # chars returned to the caller; the API caps again downstream

_converter = None
_lock = threading.Lock()  # serialises conversion — one CPU-heavy job at a time
_ready = threading.Event()


class BadRequest(Exception):
    pass


def load_converter():
    """Loaded lazily so request-handling tests run without docling installed."""
    global _converter
    from docling.document_converter import DocumentConverter  # imported here on purpose
    _converter = DocumentConverter()
    _ready.set()


def convert_document(converter, data: bytes, mime: str, suffix: str) -> dict:
    """Bytes -> {"text", "tables"}. The temp file is always removed."""
    started = time.time()
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(data)
        path = tmp.name
    try:
        with _lock:
            result = converter.convert(path)
        text = result.document.export_to_markdown()[:TEXT_LIMIT]
        tables = len(result.document.tables) if result.document.tables else 0
        return {
            "text": text,
            "tables": tables,
            "model": MODEL_ID,
            "latency_ms": int((time.time() - started) * 1000),
        }
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass


def validate_request(headers, length: int) -> tuple[bytes, str]:
    """Pure request validation — testable without docling or a socket."""
    if length <= 0 or length > MAX_BODY_BYTES:
        raise BadRequest("missing or oversized body")
    mime = headers.get("X-Document-Mime", "")
    if mime not in ALLOWED_MIMES:
        raise BadRequest("unsupported document type")
    suffix = ".pdf" if mime == "application/pdf" else ".docx"
    return suffix, mime


class Handler(BaseHTTPRequestHandler):
    def _send(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/healthz":
            self._send(200 if _ready.is_set() else 503, {"ready": _ready.is_set()})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/v1/parse-document":
            return self._send(404, {"error": "not found"})
        if not _ready.is_set():
            return self._send(503, {"error": "converter loading"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            suffix, _mime = validate_request(self.headers, length)
            data = self.rfile.read(length)
            self._send(200, convert_document(_converter, data, _mime, suffix))
        except BadRequest as e:
            self._send(400, {"error": str(e)})
        except Exception:
            # Never leak internals or document text in an error.
            self._send(500, {"error": "parse failed"})

    def log_message(self, fmt, *args):  # paths only, but keep quiet like encoder-service
        pass


def main():
    port = int(os.environ.get("PORT", "8080"))
    threading.Thread(target=load_converter, daemon=True).start()
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()


if __name__ == "__main__":
    main()

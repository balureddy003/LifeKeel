"""
CatBoost anomaly-flag worker (intent 97, slice 8) — FLAG-OFF SCAFFOLD.

    POST /v1/flag-anomalies   {"months": [{"period": "2026-01",
                                          "money_in_minor": 12345,
                                          "money_out_minor": 6789}, ...]}
      -> {"flags": [{"period", "metric", "direction", "score"}], ...}
    GET  /healthz             -> 200 once ready

Trained only on the committed synthetic fixtures (fixtures/anomaly/) —
rule 3 allows synthetic data; real household pooling needs the intent-96
opt-in and is not assumed. The flag carries no amount and no applicable
value: it is information for a person, never an input to an estimate.

Nothing calls this yet — the API-side anomaly module is standalone and
unwired. Deploy like docling-service (internal only) if/when a call site
exists; DO NOT expose it publicly.
"""
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MAX_BODY_BYTES = 1024 * 1024
FIXTURE_PATH = os.environ.get(
    "ANOMALY_FIXTURE_PATH",
    os.path.join(os.path.dirname(__file__), "..", "..", "fixtures", "anomaly", "monthly-series.json"),
)

_model = None
_lock = threading.Lock()
_ready = threading.Event()


class BadRequest(Exception):
    pass


def parse_request(raw: bytes) -> dict:
    if len(raw) > MAX_BODY_BYTES:
        raise BadRequest("body too large")
    try:
        body = json.loads(raw)
    except (ValueError, UnicodeDecodeError):
        raise BadRequest("body must be JSON")
    if not isinstance(body, dict) or not isinstance(body.get("months"), list):
        raise BadRequest("body must be {months: [...]}")
    months = body["months"]
    if not (3 <= len(months) <= 120):
        raise BadRequest("months must have 3-120 entries")
    for m in months:
        if not isinstance(m, dict) or not isinstance(m.get("period"), str):
            raise BadRequest("each month needs a period string")
        for k in ("money_in_minor", "money_out_minor"):
            v = m.get(k)
            if not isinstance(v, int) or isinstance(v, bool) or v < 0:
                raise BadRequest(f"{k} must be a non-negative integer")
    return {"months": months}


def _train():
    """Train one regressor per metric on the synthetic fixture households."""
    global _model
    from catboost import CatBoostRegressor  # imported here on purpose

    data = json.load(open(FIXTURE_PATH))
    X, yin, yout = [], [], []
    for hh in data["households"]:
        vals_in = [m["money_in_minor"] for m in hh["months"]]
        vals_out = [m["money_out_minor"] for m in hh["months"]]
        for i in range(3, len(vals_in)):
            X.append([vals_in[i - 1], vals_in[i - 2], vals_in[i - 3], i % 12])
            yin.append(vals_in[i])
        for i in range(3, len(vals_out)):
            X.append([vals_out[i - 1], vals_out[i - 2], vals_out[i - 3], i % 12])
            yout.append(vals_out[i])
    _model = {
        "in": CatBoostRegressor(iterations=100, depth=4, verbose=0, random_seed=97, allow_writing_files=False).fit(X, yin),
        "out": CatBoostRegressor(iterations=100, depth=4, verbose=0, random_seed=97, allow_writing_files=False).fit(X, yout),
    }


def flag_anomalies(months: list) -> dict:
    """months -> flags. Uses evaluate.py's residual-MAD approach."""
    import evaluate  # same directory

    with _lock:
        if _model is None:
            _train()
        preds = {}
        for metric, key in (("money_in", "money_in_minor"), ("money_out", "money_out_minor")):
            vals = [m[key] for m in months]
            model = _model["in" if metric == "money_in" else "out"]
            for i in range(3, len(vals)):
                preds[(months[i]["period"], metric)] = float(
                    model.predict([[vals[i - 1], vals[i - 2], vals[i - 3], i % 12]])[0]
                )
        flags = []
        by_metric = {}
        for (period, metric), p in preds.items():
            by_metric.setdefault(metric, {})[period] = p
        for metric, pmap in by_metric.items():
            key = "money_in_minor" if metric == "money_in" else "money_out_minor"
            actual = {m["period"]: m[key] for m in months}
            cells = evaluate.flag_residuals(
                {("hh", p, metric): actual[p] for p in pmap},
                {("hh", p, metric): pv for p, pv in pmap.items()},
            )
            for _hh, period, _m, direction in cells:
                resid = actual[period] - pmap[period]
                flags.append({
                    "period": period,
                    "metric": metric,
                    "direction": direction,
                    "score": round(abs(resid) / max(abs(pmap[period]), 1), 3),
                })
        return {"flags": sorted(flags, key=lambda f: (f["period"], f["metric"]))}


def load_model():
    try:
        _train()
        _ready.set()
    except Exception as e:  # never leak paths/content
        print(f"model load failed: {type(e).__name__}", flush=True)


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
        if self.path != "/v1/flag-anomalies":
            return self._send(404, {"error": "not found"})
        if not _ready.is_set():
            return self._send(503, {"error": "model loading"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > MAX_BODY_BYTES:
                raise BadRequest("missing or oversized body")
            req = parse_request(self.rfile.read(length))
            self._send(200, flag_anomalies(req["months"]))
        except BadRequest as e:
            self._send(400, {"error": str(e)})
        except Exception:
            self._send(500, {"error": "flagging failed"})

    def log_message(self, fmt, *args):
        pass


def main():
    port = int(os.environ.get("PORT", "8080"))
    threading.Thread(target=load_model, daemon=True).start()
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()


if __name__ == "__main__":
    main()

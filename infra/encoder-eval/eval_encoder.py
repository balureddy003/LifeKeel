"""
Evaluate a GLiNER2 classifier on labelled emails (experiment, not production code).

    python eval_encoder.py fastino/GLiNER2.5-Decide heldout-emails.json

The label wording below was tuned on tuning-emails.json (16 emails) and then FROZEN;
heldout-emails.json (20 emails) was written afterwards and never used for tuning.
Both sets are synthetic. See README.md for results and caveats.
"""
import json, sys, time, warnings

warnings.filterwarnings("ignore")
from gliner2 import GLiNER2

model_id, path = sys.argv[1], sys.argv[2]
emails = json.load(open(path))
ex = GLiNER2.from_pretrained(model_id)

POS = "a notice about an insurance, pension, mortgage or estate policy the household already holds"
NEG = [
    "a bank or card transaction alert or statement notice",
    "a marketing promotion or offer for a new product",
    "an order, receipt or subscription message",
    "a social or app notification",
    "a software usage or quota alert",
]
LABELS = [POS] + NEG


def text(e):
    return f"From: {e['from']}\nSubject: {e['subject']}\n\n{e['textSnippet']}"


ex.classify_text("warmup", {"kind": LABELS})
rows, lat = [], []
for e in emails:
    t = time.time()
    r = ex.classify_text(text(e), {"kind": LABELS}, include_confidence=True)["kind"]
    lat.append(time.time() - t)
    rows.append((e["name"], e["isFinancial"], r["label"] == POS, round(r.get("confidence", 0), 2)))

pos = sum(1 for _, y, *_ in rows if y)
tp = sum(1 for _, y, p, _ in rows if y and p)
print(f"{model_id} on {path}: correct {sum(1 for _, y, p, _ in rows if y == p)}/{len(rows)} | recall {tp}/{pos} | avg {1000 * sum(lat) / len(lat):.0f} ms/email")
for n, y, p, c in rows:
    if y != p:
        print(f"  WRONG {n}: expected financial={y}, predicted={p} (confidence {c})")

#!/usr/bin/env python3
"""CatBoost vs deterministic-baseline evaluation on the slice-8 fixtures.

Leave-one-household-out: for each synthetic household, a CatBoost regressor
is trained on the OTHER households' months (synthetic data only — rule 3),
then predicts that household's money-in and money-out totals month by month.
A month is flagged when its residual sits beyond a robust bound on that
household+metric's residual series (same spirit as the TS median/MAD
baseline). Reports recall and false-flag rate next to the baseline's numbers
so the owner can apply the ship margin.

Run on demand (needs catboost installed):
    python3 infra/catboost-service/evaluate.py
"""
import json
import math
import sys
from pathlib import Path

HERE = Path(__file__).parent
FIXTURE = HERE.parent.parent / "fixtures" / "anomaly" / "monthly-series.json"

WINDOW = 3          # lag features: previous N months of the same metric
Z_THRESHOLD = 3.5   # same modified-z cutoff spirit as the TS baseline


def rows_for(households, exclude_hh=None, exclude_cells=None):
    """Feature rows: [lag1, lag2, lag3, sin, cos, month_index] -> target."""
    X, y, meta = [], [], []
    for hh in households:
        if exclude_hh is not None and hh["id"] == exclude_hh:
            continue
        for metric in ("money_in", "money_out"):
            col = metric + "_minor"
            vals = [m[col] for m in hh["months"]]
            for i in range(len(vals)):
                if exclude_cells and (hh["id"], hh["months"][i]["period"], metric) in exclude_cells:
                    continue
                if i < WINDOW:
                    continue
                lags = [vals[i - k] for k in range(1, WINDOW + 1)]
                ang = 2 * math.pi * (i % 12) / 12
                X.append(lags + [math.sin(ang), math.cos(ang), i % 12])
                y.append(vals[i])
                meta.append((hh["id"], hh["months"][i]["period"], metric))
    return X, y, meta


def predict_household(model, hh):
    """Predict every month of one household (lags from its own actuals)."""
    preds = {}
    for metric in ("money_in", "money_out"):
        col = metric + "_minor"
        vals = [m[col] for m in hh["months"]]
        for i in range(WINDOW, len(vals)):
            lags = [vals[i - k] for k in range(1, WINDOW + 1)]
            ang = 2 * math.pi * (i % 12) / 12
            preds[(hh["id"], hh["months"][i]["period"], metric)] = model.predict(
                [[*lags, math.sin(ang), math.cos(ang), i % 12]]
            )[0]
    return preds


def median(v):
    s = sorted(v)
    n = len(s)
    return s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2


def flag_residuals(actuals, preds):
    """Flag months whose |actual - predicted| is an outlier vs the household's
    own residual MAD — mirrors anomaly-flag.ts's robust approach."""
    keys = sorted(preds)
    if len(keys) < 6:
        return set()
    residuals = {k: actuals[k] - preds[k] for k in keys}
    med = median(list(residuals.values()))
    mad = median([abs(r - med) for r in residuals.values()])
    if mad == 0:
        return set()
    flags = set()
    for k, r in residuals.items():
        z = 0.6745 * (r - med) / mad
        if abs(z) > Z_THRESHOLD:
            hh, period, metric = k
            direction = "high" if r > med else "low"
            flags.add((hh, period, metric, direction))
    return flags


def main():
    from catboost import CatBoostRegressor  # heavy import, on purpose

    data = json.loads(FIXTURE.read_text())
    households = data["households"]
    expected = {
        (f["household"], f["period"], f["metric"], f["direction"])
        for f in data["expected_flags"]
    }
    planted_cells = {(h, p, m) for (h, p, m, _d) in expected}

    all_actuals = {}
    for hh in households:
        for m in hh["months"]:
            for metric in ("money_in", "money_out"):
                all_actuals[(hh["id"], m["period"], metric)] = m[metric + "_minor"]

    flagged = set()
    for hh in households:
        others = [h for h in households if h["id"] != hh["id"]]
        X, y, _ = rows_for(
            others,
            exclude_cells={(h, p, m) for (h, p, m) in planted_cells if h != hh["id"]},
        )
        model = CatBoostRegressor(iterations=100, depth=4, verbose=0, random_seed=97)
        model.fit(X, y)
        preds = predict_household(model, hh)
        flagged |= flag_residuals(
            {k: v for k, v in all_actuals.items() if k[0] == hh["id"]}, preds
        )

    tp = len(flagged & expected)  # direction must match for a true positive
    flagged_cells = {(h, p, m) for (h, p, m, _d) in flagged}
    fp = len(flagged_cells - planted_cells)
    fn = len(expected - flagged)
    evaluated = sum(len(h["months"]) for h in households) * 2
    recall = tp / len(expected)
    fpr = fp / (evaluated - len(expected))
    print(f"catboost: recall={recall:.3f} ({tp}/{len(expected)}), "
          f"false-flag rate={fpr:.4f} ({fp}/{evaluated - len(expected)})")
    print("baseline (TS median/MAD): recall=0.688, false-flag rate=0.0063")
    print("ship rule: catboost must beat baseline recall by the owner-set margin "
          "at the same false-flag rate, else the baseline ships and catboost is dropped.")


if __name__ == "__main__":
    sys.exit(main())

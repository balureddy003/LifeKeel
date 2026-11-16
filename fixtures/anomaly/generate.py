#!/usr/bin/env python3
"""Generate synthetic multi-month household series for the intent-97 slice-8
evaluation: the deterministic anomaly baseline vs (later) CatBoost.

All households, amounts and anomalies are made up. Each household has 14
months of money-in/money-out totals (minor units); a handful of months carry
planted anomalies — gross spikes and drops a person should notice. The
expected flag list is what a perfect detector would report; the eval scores
recall and false-flag rate against it.

Regenerate:  python3 fixtures/anomaly/generate.py
"""
import json
import random
from pathlib import Path

HERE = Path(__file__).parent
N_HOUSEHOLDS = 12
N_MONTHS = 14
# (household index, month index, metric, direction, factor) — planted anomalies.
# Gross cases (>= ~3x or <= ~0.3x) are obvious; the subtle ones (1.4-1.9x,
# 0.55-0.75x) are the ones a robust rule may miss — that gap is what a
# learned helper would have to beat to earn its place.
PLANTED = [
    (0, 9, "money_out", "high", 4.2),    # huge unexpected spend month
    (1, 5, "money_in", "low", 0.15),     # income almost stops
    (2, 11, "money_out", "high", 3.5),
    (3, 7, "money_in", "high", 1.45),     # subtle: bigger-than-usual pay
    (4, 4, "money_out", "low", 0.2),     # suspiciously quiet month
    (5, 12, "money_out", "high", 5.0),
    (6, 6, "money_in", "low", 0.1),
    (7, 10, "money_out", "high", 3.0),
    (8, 8, "money_in", "high", 1.35),     # subtle
    (9, 3, "money_out", "low", 0.25),
    (10, 11, "money_in", "low", 0.3),
    (11, 5, "money_out", "high", 4.0),
    (1, 8, "money_out", "high", 1.4),    # subtle
    (4, 9, "money_in", "low", 0.78),     # subtle
    (7, 4, "money_out", "low", 0.8),     # subtle
    (10, 6, "money_in", "high", 1.3),    # subtle
]


def main():
    rng = random.Random(808)
    households = []
    expected = []
    for h in range(N_HOUSEHOLDS):
        base_in = rng.randint(220_000, 380_000)   # ~£2.2k-£3.8k / month
        base_out = rng.randint(160_000, 300_000)
        months = []
        planted_here = {(m, metric): (direction, factor) for (hh, m, metric, direction, factor) in PLANTED if hh == h}
        for m in range(N_MONTHS):
            mi = base_in + rng.randint(-45_000, 45_000)
            mo = base_out + rng.randint(-38_000, 38_000)
            # months 0-11 = 2025-01..12, 12-13 = 2026-01..02
            period = f"2025-{m + 1:02d}" if m < 12 else f"2026-{m - 11:02d}"
            for metric, base in (("money_in", mi), ("money_out", mo)):
                if (m, metric) in planted_here:
                    direction, factor = planted_here[(m, metric)]
                    expected.append({
                        "household": f"hh-{h + 1:02d}",
                        "period": period,
                        "metric": metric,
                        "direction": direction,
                    })
                    if metric == "money_in":
                        mi = int(mi * factor)
                    else:
                        mo = int(mo * factor)
            months.append({
                "period": period,
                "money_in_minor": mi,
                "money_out_minor": mo,
            })
        households.append({"id": f"hh-{h + 1:02d}", "months": months})

    (HERE / "monthly-series.json").write_text(json.dumps(
        {"households": households, "expected_flags": expected}, indent=2) + "\n")
    print(f"wrote {N_HOUSEHOLDS} households x {N_MONTHS} months, {len(expected)} planted anomalies")


if __name__ == "__main__":
    main()

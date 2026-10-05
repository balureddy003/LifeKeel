#!/usr/bin/env python3
"""
yfinance bridge for the LifeKeel connector sync engine.

Yahoo Finance has no official REST API. This script wraps the yfinance
Python library and emits JSON to stdout in the normalized shape that the
connector-sync-engine.ts record transforms expect:

  DailyHistory resource:
    { "ticker": "AAPL", "history": [
        { "date": "2024-01-02", "open": ..., "high": ..., "low": ...,
          "close": ..., "volume": ..., "dividends": ..., "splits": ... },
        ...
    ] }

  Fundamentals resource:
    { "ticker": "AAPL", "name": "Apple Inc.",
      "ratios": { "gross_profit_ttm": ..., "total_revenue_ttm": ...,
                  "gross_profit_ttm": ..., "market_cap": ...,
                  "sector": ..., "industry": ... } }

Usage:
  python3 fetch-yfinance.py --resource DailyHistory --symbol AAPL [--from 2024-01-01]
  python3 fetch-yfinance.py --resource Fundamentals --symbol AAPL

Requirements:
  pip install yfinance pandas

No API key required. Rate limits are soft (~2000 requests/hour per IP).
"""

import argparse
import json
import math
import sys
from datetime import datetime, timedelta

try:
    import yfinance as yf
except ImportError:
    print(json.dumps({"error": "yfinance not installed. Run: pip install yfinance"}), file=sys.stderr)
    sys.exit(1)


def fetch_daily_history(symbol: str, date_from: str | None) -> dict:
    """Fetch daily OHLCV history for a symbol."""
    ticker = yf.Ticker(symbol)
    start = date_from if date_from else (datetime.now() - timedelta(days=365 * 20)).strftime("%Y-%m-%d")
    end = datetime.now().strftime("%Y-%m-%d")
    df = ticker.history(start=start, end=end, auto_adjust=True)
    if df.empty:
        return {"ticker": symbol, "history": []}

    # yfinance returns NaN cells for halted/missing sessions (common on long
    # lookbacks and around listing changes). json.dumps writes those as a bare
    # `NaN` token, which is invalid JSON — JSON.parse in the Node callers
    # throws, and because they catch broadly the whole fetch silently returns
    # zero price points. Coerce non-finite values instead, and drop bars with
    # no usable close since a bar without a price is not a data point.
    def num(value, fallback=0.0):
        try:
            out = float(value)
        except (TypeError, ValueError):
            return fallback
        return out if math.isfinite(out) else fallback

    history = []
    for date, row in df.iterrows():
        close = num(row.get("Close"))
        if close <= 0:
            continue
        history.append({
            "date": date.strftime("%Y-%m-%d"),
            "open": num(row.get("Open"), close),
            "high": num(row.get("High"), close),
            "low": num(row.get("Low"), close),
            "close": close,
            "volume": int(num(row.get("Volume"))),
            "dividends": num(row.get("Dividends")),
            "splits": num(row.get("Stock Splits")),
        })
    return {"ticker": symbol, "history": history}


def fetch_fundamentals(symbol: str) -> dict:
    """Fetch fundamentals (income statement, ratios, sector) for a symbol."""
    ticker = yf.Ticker(symbol)
    info = ticker.info or {}
    # yfinance's info dict has gross_profit and total_revenue under various
    # keys depending on version. Try the common ones.
    gross_profit = info.get("grossProfits") or info.get("gross_profit") or 0
    total_revenue = info.get("totalRevenue") or info.get("total_revenue") or 0
    market_cap = info.get("marketCap") or info.get("market_cap") or 0
    return {
        "ticker": symbol,
        "name": info.get("longName") or info.get("shortName") or "",
        "ratios": {
            "gross_profit_ttm": gross_profit,
            "total_revenue_ttm": total_revenue,
            "market_cap": market_cap,
            "sector": info.get("sector") or "",
            "industry": info.get("industry") or "",
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="yfinance bridge for LifeKeel connector sync")
    parser.add_argument("--resource", required=True, help="Resource name: DailyHistory or Fundamentals")
    parser.add_argument("--symbol", required=True, help="Ticker symbol, e.g. AAPL")
    parser.add_argument("--from", dest="date_from", default=None, help="Start date YYYY-MM-DD (default: 20 years ago)")
    args = parser.parse_args()

    if args.resource == "DailyHistory":
        result = fetch_daily_history(args.symbol, args.date_from)
    elif args.resource == "Fundamentals":
        result = fetch_fundamentals(args.symbol)
    else:
        print(json.dumps({"error": f"Unknown resource: {args.resource}"}), file=sys.stderr)
        sys.exit(1)

    print(json.dumps(result, default=str))


if __name__ == "__main__":
    main()

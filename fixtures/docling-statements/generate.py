#!/usr/bin/env python3
"""Generate the synthetic bank-statement fixtures for intent 97 slice 3.

Stdlib only — writes minimal single-font PDFs that any text extractor
(unpdf/pdf.js, Docling) can read, plus expected.json with the six banking
fields each statement must yield. All names, sort codes and numbers are
made up; nothing here is real family data.

Regenerate:  python3 fixtures/docling-statements/generate.py
Eval:        see README.md — needs the Docling worker + the governed
             extraction path, so it runs on demand, not in CI.
"""
import json
import random
from pathlib import Path

HERE = Path(__file__).parent

BANKS = [
    ("Mercer & Dale Bank", "MDBC"),
    ("Thornbury Mutual", "THMB"),
    ("Alderney Savings", "ALDS"),
    ("Kestrel Current Account", "KCA"),
]
HOLDERS = [
    "A. Whitfield", "R. Okafor", "S. Lindqvist", "M. Haddad",
    "J. Pemberton", "L. Marsh", "T. Nguyen", "E. Castellanos",
    "P. Raman", "C. Beaumont", "D. Achebe", "N. Sorensen",
]
MONTHS = ["January", "February", "March", "April", "May", "June",
          "July", "August", "September", "October", "November", "December"]


def gbp(minor: int) -> str:
    return f"£{minor // 100:,}.{minor % 100:02d}"


def pdf_escape(s: str) -> str:
    # £ is PDFDocEncoding 0xA3 — emit it as an octal escape or pdf.js reads the
    # UTF-8 bytes as two mojibake chars. En-dash becomes a plain hyphen.
    return (
        s.replace("\\", "\\\\")
        .replace("(", "\\(")
        .replace(")", "\\)")
        .replace("£", "\\243")
        .replace("–", "-")
    )


def make_pdf(lines: list[str]) -> bytes:
    """One-page Helvetica PDF, ~10pt, 50 chars/line budget kept by caller."""
    content_lines = ["BT", "/F1 10 Tf", "50 750 Td", "14 TL"]
    for i, line in enumerate(lines):
        if i:
            content_lines.append("T*")
        content_lines.append(f"({pdf_escape(line)}) Tj")
    content_lines.append("ET")
    stream = "\n".join(content_lines).encode()

    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        b"/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for i, obj in enumerate(objects, 1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n".encode() + obj + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n".encode()
    out += b"0000000000 65535 f \n"
    for off in offsets:
        out += f"{off:010d} 00000 n \n".encode()
    out += (
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\n"
        f"startxref\n{xref}\n%%EOF\n"
    ).encode()
    return bytes(out)


def statement_lines(bank, holder, sort, account, period_start, period_end,
                   opening, closing, money_in, money_out, credits, debits,
                   date_style):
    """Layout A: header, account block, period, transactions, totals."""
    sd = f"{period_start.day:02d} {MONTHS[period_start.month - 1][:3]} {period_start.year}"
    ed = f"{period_end.day:02d} {MONTHS[period_end.month - 1][:3]} {period_end.year}"
    lines = [
        bank[0].upper(),
        f"Current Account {sort} {account}",
        f"Account holder: {holder}",
        "",
        f"Statement period: {sd} to {ed}",
        f"Opening balance: {gbp(opening)}",
        "",
        "Date        Description                Money in    Money out",
    ]
    for d, desc, amt, is_in in credits + debits:
        lines.append(f"{d:%d %b %y}  {desc:<26} {gbp(amt) if is_in else '':>10}"
                     f"{'' if is_in else gbp(amt):>12}")
    lines += [
        "",
        f"Total money in:  {gbp(money_in)}",
        f"Total money out: {gbp(money_out)}",
        f"Closing balance: {gbp(closing)}",
    ]
    return lines


def statement_lines_v2(bank, holder, sort, account, period_start, period_end,
                       opening, closing, money_in, money_out, credits, debits,
                       date_style):
    """Layout B: totals-first, ISO dates, different wording — robustness check."""
    lines = [
        f"{bank[0]}",
        f"Statement for {holder} — account {account} ({sort})",
        f"Period {period_start.isoformat()} – {period_end.isoformat()}",
        f"Balance brought forward {gbp(opening)}",
        f"",
        f"Credits total {gbp(money_in)}   Debits total {gbp(money_out)}",
        f"Balance carried forward {gbp(closing)}",
        "",
        "Transactions:",
    ]
    for d, desc, amt, is_in in credits + debits:
        lines.append(f"{d.isoformat()} | {desc} | {'in' if is_in else 'out'} | {gbp(amt)}")
    return lines


def main():
    rng = random.Random(97)
    fixtures = []
    for i in range(12):
        bank = BANKS[i % len(BANKS)]
        holder = HOLDERS[i]
        sort = f"{bank[1]}-{100000 + i * 137:06d}"
        account = f"{rng.randint(10000000, 99999999)}"
        year, month = 2026, (i % 12) + 1
        # last day of month
        import calendar
        end_day = calendar.monthrange(year, month)[1]
        ps = __import__("datetime").date(year, month, 1)
        pe = __import__("datetime").date(year, month, end_day)

        opening = rng.randint(50_000, 900_000)
        # 4-7 credits and debits summing to round-ish totals
        n_in, n_out = rng.randint(3, 5), rng.randint(3, 5)
        credits = []
        for j in range(n_in):
            amt = rng.randint(20_000, 120_000)
            credits.append((ps.replace(day=min(end_day, 3 + j * 4)),
                            f"Salary credit {j + 1}" if j == 0 else f"Credit ref {1000 + i * 10 + j}",
                            amt, True))
        money_in = sum(c[2] for c in credits)
        debits = []
        for j in range(n_out):
            amt = rng.randint(8_000, 60_000)
            debits.append((ps.replace(day=min(end_day, 5 + j * 4)),
                           f"Direct debit {j + 1}" if j == 0 else f"Debit ref {2000 + i * 10 + j}",
                           amt, False))
        money_out = sum(d[2] for d in debits)
        closing = opening + money_in - money_out
        assert closing > 0

        fn = f"statement-{i + 1:02d}.pdf"
        if i % 2 == 0:
            lines = statement_lines(bank, holder, sort, account, ps, pe,
                                    opening, closing, money_in, money_out,
                                    credits, debits, "uk")
        else:
            lines = statement_lines_v2(bank, holder, sort, account, ps, pe,
                                       opening, closing, money_in, money_out,
                                       credits, debits, "iso")
        (HERE / fn).write_bytes(make_pdf(lines))
        fixtures.append({
            "file": fn,
            "category": "banking",
            "layout": "A" if i % 2 == 0 else "B",
            "expected": {
                "statement_opening_balance": f"{opening / 100:.2f}",
                "statement_closing_balance": f"{closing / 100:.2f}",
                "statement_money_in": f"{money_in / 100:.2f}",
                "statement_money_out": f"{money_out / 100:.2f}",
                "statement_period_start": ps.isoformat(),
                "statement_period_end": pe.isoformat(),
            },
        })
    (HERE / "expected.json").write_text(json.dumps(fixtures, indent=2) + "\n")
    # One deliberately inconsistent statement for the staging mismatch check: the printed
    # closing balance is GBP 100 more than opening + money in - money out. It lives in negative/, not
    # expected.json, so it never counts toward extraction accuracy.
    (HERE / "negative").mkdir(exist_ok=True)
    (HERE / "negative" / "statement-mismatch.pdf").write_bytes(make_pdf(statement_lines(
        bank, holder, sort, account, ps, pe, opening, closing + 10_000,
        money_in, money_out, credits, debits, "uk")))
    print(f"wrote {len(fixtures)} fixtures + expected.json")


if __name__ == "__main__":
    main()

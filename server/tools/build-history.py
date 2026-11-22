"""Rebuild data/sp500-monthly.js from the Shiller monthly CSV.

Usage:
  curl -sSLo sp.csv https://raw.githubusercontent.com/datasets/s-and-p-500/main/data/data.csv
  python3 tools/build-history.py sp.csv
"""
import csv, json, sys

rows = [r for r in csv.DictReader(open(sys.argv[1])) if r["Date"] >= "1968-11"]
last_div = max(r["Date"] for r in rows if float(r["Dividend"]) > 0)
months, tr, prev, last_yield = [], 1.0, None, 0.0
for r in rows:
    p, d = float(r["SP500"]), float(r["Dividend"])
    if d > 0:
        last_yield = d / p  # annual dividend / price
    if prev is not None:
        tr *= (p + p * last_yield / 12) / prev
    prev = p
    months.append([r["Date"][:7], round(p, 2), round(tr, 4)])

body = "\n".join("    [%s, %s, %s]," % (json.dumps(m[0]), m[1], m[2]) for m in months)
open("data/sp500-monthly.js", "w").write(f"""// S&P 500 monthly average level since Nov 1968, and a total-return index
// (dividends reinvested, 1.0 = Nov 1968). Source: Robert Shiller's dataset via
// https://github.com/datasets/s-and-p-500 (monthly averages, not closes).
// Dividends after {last_div[:7]} use the last known yield, so the total return for recent
// months is an estimate. Regenerate with tools/build-history.py.
export const HISTORY = {{
  dividendsThrough: "{last_div[:7]}",
  months: [
{body}
  ],
}};
""")
print("wrote", len(months), "months; last", months[-1])

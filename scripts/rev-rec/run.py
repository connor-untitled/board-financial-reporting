#!/usr/bin/env python3
"""
Fill last month's tab in the Subscription Rev Rec workbook, on the 2nd
business day of the month.

Some invoices for a month (arrears resellers, client accounts) are dated the
1st of the next month and go out on its 1st business day, so the month can
only be closed the day after. The Routine fires on every weekday morning
that could be the 2nd business day (the 2nd to the 5th); this script works
out whether today is the one and otherwise exits without touching anything.

Steps, all in one argument-free command so an allow rule can name it:
  1. Today (US Eastern) must be the 2nd business day, or exit 3 quietly.
  2. Pull invoices, customers and products from Stripe.
  3. Build last month's rows with rows.py.
  4. Find or create the "<Month YYYY>" tab. If it already has rows, stop
     (exit 2): a tab someone has started is never overwritten.
  5. Write the rows in one request, read them back, and check the count and
     the total in H5.
  6. Write .rev-rec/summary.md for the routine to send.

Environment:
    WINS_SA_KEY    the service account JSON (see scripts/common/sheets.py)
    REV_REC_TODAY  YYYY-MM-DD, overrides today. For backfills and tests only.
    REV_REC_FORCE  1 runs even when today is not the 2nd business day.

Usage:
    python3 scripts/rev-rec/run.py
"""

import datetime as dt
import json
import os
import subprocess
import sys
import urllib.parse
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(ROOT, "scripts", "common"))

import rows as R  # noqa: E402
from sheets import Sheet  # noqa: E402

WORKBOOK = "1Sh8YhVR9HdQZP3GfofOR0qGLKLmbgoJHf5Gk16SUI70"
CONFIG = os.path.join(ROOT, "scripts", "board-kpis", "config.json")
OUT = os.path.join(ROOT, ".rev-rec")
HEADER = ["Client", "Invoice #", "Invoice Date", "Client Type",
          "Subscription / License Amount", "Recognition Basis"]
DATE_FMT = {"numberFormat": {"type": "DATE", "pattern": "dddd, mmmm d, yyyy"}}
MONEY_FMT = {"numberFormat": {"type": "CURRENCY", "pattern": "\"$\"#,##0.00"}}

NOT_TODAY, TAB_STARTED = 3, 2


def stripe(path, params):
    out, after = [], None
    while True:
        query = list(params) + [("limit", "100")] + ([("starting_after", after)] if after else [])
        raw = subprocess.run(["curl", "-sS", "https://api.stripe.com/v1/%s?%s"
                              % (path, urllib.parse.urlencode(query))],
                             capture_output=True, text=True)
        page = json.loads(raw.stdout or "{}")
        if "data" not in page:
            sys.exit("Stripe %s failed: %s" % (path, json.dumps(page.get("error", page))[:400]))
        out += page["data"]
        if not page.get("has_more"):
            return out
        after = page["data"][-1]["id"]


def serial(iso):
    return (dt.date.fromisoformat(iso) - dt.date(1899, 12, 30)).days


def tab_title(month):
    return dt.datetime.strptime(month, "%Y-%m").strftime("%B %Y")


def ensure_tab(sheet, title):
    """The tab's sheetId, creating it with the standard header and total."""
    meta = sheet.call("GET", "", params={"fields": "sheets.properties(sheetId,title)"})
    for s in meta["sheets"]:
        if s["properties"]["title"] == title:
            return s["properties"]["sheetId"], False
    reply = sheet.call("POST", ":batchUpdate", json={"requests": [{"addSheet": {"properties": {
        "title": title, "index": 0, "gridProperties": {"frozenRowCount": 1}}}}]})
    sid = reply["replies"][0]["addSheet"]["properties"]["sheetId"]
    sheet.call("POST", ":batchUpdate", json={"requests": [{"updateCells": {
        "start": {"sheetId": sid, "rowIndex": 0, "columnIndex": 0},
        "rows": [{"values": [{"userEnteredValue": {"stringValue": h}} for h in HEADER]}],
        "fields": "userEnteredValue"}}, {"updateCells": {
        "start": {"sheetId": sid, "rowIndex": 4, "columnIndex": 7},
        "rows": [{"values": [{"userEnteredValue": {"formulaValue": "=SUM(E:E)"}}]}],
        "fields": "userEnteredValue"}}]})
    return sid, True


def values(sheet, rng, render="UNFORMATTED_VALUE"):
    got = sheet.call("GET", "/values/%s" % urllib.parse.quote(rng),
                      params={"valueRenderOption": render})
    return got.get("values", [])


def main():
    today = dt.date.fromisoformat(os.environ["REV_REC_TODAY"]) if os.environ.get("REV_REC_TODAY") \
        else dt.datetime.now(ZoneInfo("America/New_York")).date()
    target = R.second_business_day(today.year, today.month)
    if today != target and os.environ.get("REV_REC_FORCE") != "1":
        print("Today (%s) is not the 2nd business day of the month (%s). Nothing to do."
              % (today, target))
        return NOT_TODAY

    first = today.replace(day=1)
    month = (first - dt.timedelta(days=1)).strftime("%Y-%m")
    title = tab_title(month)
    prev_title = tab_title((dt.date.fromisoformat(month + "-01") - dt.timedelta(days=1)).strftime("%Y-%m"))

    since = int(dt.datetime.fromisoformat(month + "-01").replace(tzinfo=dt.timezone.utc).timestamp())
    invoices = stripe("invoices", [("created[gte]", str(since))])
    customers = stripe("customers", [])
    products = stripe("products", [])
    arrears = set(json.load(open(CONFIG))["arrears_customers"])
    rows, flags = R.build(invoices, customers, products, arrears, month)

    key = os.environ.get("WINS_SA_KEY")
    if not key:
        sys.exit("WINS_SA_KEY is not set on this environment; nothing was written.")
    sheet = Sheet(key, WORKBOOK)
    sid, created = ensure_tab(sheet, title)
    existing = [r for r in values(sheet, "'%s'!A2:F" % title) if any(c != "" for c in r)]
    if existing:
        print("'%s' already has %d rows. Left untouched; clear it first to rebuild." % (title, len(existing)))
        return TAB_STARTED

    body = [{"values": [
        {"userEnteredValue": {"stringValue": r["client"]}},
        {"userEnteredValue": {"stringValue": r["invoice"]}},
        {"userEnteredValue": {"numberValue": serial(r["date"])}, "userEnteredFormat": DATE_FMT},
        {"userEnteredValue": {"stringValue": r["type"]}},
        {"userEnteredValue": {"numberValue": r["amount"]}, "userEnteredFormat": MONEY_FMT},
        {"userEnteredValue": {"stringValue": r["basis"]}},
    ]} for r in rows]
    sheet.call("POST", ":batchUpdate", json={"requests": [{"updateCells": {
        "start": {"sheetId": sid, "rowIndex": 1, "columnIndex": 0}, "rows": body,
        "fields": "userEnteredValue,userEnteredFormat.numberFormat"}}]})

    written = [r for r in values(sheet, "'%s'!A2:F" % title) if r and r[0]]
    total = values(sheet, "'%s'!H5" % title)
    total = total[0][0] if total and total[0] else None
    expected = round(sum(r["amount"] for r in rows), 2)
    if len(written) != len(rows) or total is None or abs(float(total) - expected) > 0.005:
        sys.exit("Read-back mismatch on '%s': %d rows and total %s written, expected %d and %.2f"
                 % (title, len(written), total, len(rows), expected))

    prev = set()
    try:
        prev = {r[0].strip() for r in values(sheet, "'%s'!A2:A" % prev_title) if r and r[0]}
    except RuntimeError:
        pass
    dropped = sorted(prev - {r["client"] for r in rows})

    by_type = {}
    for r in rows:
        by_type[r["type"] or "Untagged"] = by_type.get(r["type"] or "Untagged", 0) + r["amount"]
    lines = ["Rev Rec: %s tab filled (%s rows, total $%s)" % (title, len(rows), "{:,.2f}".format(expected)),
             "https://docs.google.com/spreadsheets/d/%s/edit#gid=%s" % (WORKBOOK, sid), ""]
    lines += ["%s: $%s" % (k, "{:,.2f}".format(v)) for k, v in sorted(by_type.items())]
    if created:
        lines.append("The tab did not exist, so it was created with the standard header and total.")
    sections = [
        ("Needs a person", flags.get("manual", []) + flags.get("untagged", [])),
        ("Left out", flags.get("skipped", [])),
        ("Used while still a draft", flags.get("draft", [])),
        ("Annual invoices counted at one month", flags.get("annual", [])),
        ("In %s but not %s (cancelled, or an invoice is missing)" % (prev_title, title), dropped),
    ]
    for head, items in sections:
        if items:
            lines += ["", head + ":"] + ["- " + i for i in items]

    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "summary.md"), "w") as f:
        f.write("\n".join(lines) + "\n")
    with open(os.path.join(OUT, "rows.json"), "w") as f:
        json.dump({"month": month, "rows": rows, "flags": flags, "dropped": dropped}, f, indent=1)
    print("\n".join(lines))
    return 0


if __name__ == "__main__":
    sys.exit(main())

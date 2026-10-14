#!/usr/bin/env python3
"""
Build the data files behind the Untitled Board Reporting dashboard.

Reads the published sheets, never writes to them, and leaves one JSON file per
dashboard source in .board-dashboard/out/. Upload each file to the dashboard
and point its dataset at the new url (see README.md).

Inputs:
- Untitled Monthly KPIs, tab "Revised KPI Sheet Draft - V2" (service account)
- TEAM REVENUE WINS: FY25 and FY26 wins, Monthly Revenue TTM and 2.5Y tabs
  (service account)
- .board-dashboard/churn.xlsx: an .xlsx export of the Master Churn Data Log.
  The service account has no access to that workbook yet; share it with
  deal-win-logger@internal-teamrevdealupdate.iam.gserviceaccount.com and this
  file can be read the same way as the others.
- .board-dashboard/hubspot_churn_reasons.json: [{name, domain, churn_reason,
  churn_date}] from HubSpot companies with a churn_date this year.
- .board-dashboard/slack_churn_reasons.json: [{log_row, customer, reason,
  source}] gathered from #client-churn and related Slack threads.

The KPI sheet is taken as published, including the August 2026 Stripe rebase.
"""

import datetime as dt
import json
import os
import re
import sys
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(ROOT, "scripts", "common"))
from sheets import Sheet  # noqa: E402

WS = os.path.join(ROOT, ".board-dashboard")
OUT = os.path.join(WS, "out")
KPI_ID = "1mvj8bI19LBMkMon6j11YRNg2giuzzfZWjTzYJ91ZX4o"
WINS_ID = "1465geg8k7C_ab1DmzoHVPqnlTkuykyNRCUFVknRR97w"

# KPI sheet row number -> field. Rows are fixed in the sheet's layout.
KPI_ROWS = {
    6: "sub_beginning", 7: "sub_new", 8: "sub_expansion", 9: "sub_reactivation", 10: "sub_contraction",
    11: "sub_cancellation", 12: "sub_ending", 14: "direct_services_share", 16: "sub_arr", 17: "sub_arr_yoy",
    20: "consumption_kpi", 21: "dsp_kpi", 22: "blended_mrr", 23: "blended_arr", 24: "blended_arr_yoy",
    27: "pipe_beginning", 28: "pipe_created", 29: "pipe_increase", 30: "pipe_decrease", 31: "pipe_won",
    32: "pipe_lost", 33: "pipe_ending", 34: "opps_beginning", 35: "opps_new", 36: "opps_won", 37: "opps_lost",
    38: "opps_ending", 40: "mqls_reported", 42: "mql_to_customer", 50: "customers_beginning", 51: "customers_new",
    52: "customers_churned", 53: "customers_ending", 55: "avg_mrr_per_customer", 56: "avg_blended_mrr_per_customer",
    66: "churn_gross_usd", 68: "gross_usd_churn_rate", 69: "net_usd_churn_rate", 70: "gross_usd_churn_rate_ttm",
    71: "net_usd_churn_rate_ttm",
    81: "direct_beginning", 82: "direct_new", 83: "direct_expansion", 84: "direct_reactivation",
    85: "direct_contraction", 86: "direct_cancellation", 87: "direct_ending",
    94: "direct_pipe_beginning", 95: "direct_pipe_created", 98: "direct_pipe_won", 99: "direct_pipe_lost",
    100: "direct_pipe_ending", 108: "direct_customers_beginning", 109: "direct_customers_new",
    110: "direct_customers_churned", 111: "direct_customers_ending", 129: "direct_gross_usd_churn_rate_ttm",
    140: "reseller_beginning", 141: "reseller_new", 142: "reseller_expansion", 143: "reseller_contraction",
    144: "reseller_cancellation", 145: "reseller_ending", 151: "reseller_pipe_beginning",
    152: "reseller_pipe_created", 155: "reseller_pipe_won", 156: "reseller_pipe_lost", 157: "reseller_pipe_ending",
    165: "resellers_beginning", 166: "resellers_new", 167: "resellers_churned", 168: "resellers_ending",
    172: "reseller_end_clients_reported", 187: "reseller_gross_usd_churn_rate_ttm",
    198: "upsell_pipe_beginning", 199: "upsell_pipe_created", 202: "upsell_pipe_won", 203: "upsell_pipe_lost",
    204: "upsell_pipe_ending",
}
MONTHS = {"jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6, "jul": 7, "aug": 8, "sep": 9, "oct": 10,
          "nov": 11, "dec": 12}
REV_LINES = {"Subscription Revenue": "subscription", "DSP Revenue": "dsp", "Consumption": "consumption",
             "Mailer Revenue": "mail", "Services - Retainer": "services_retainer",
             "Services - Projects": "services_projects"}

# Churn reason categories, first match wins. The reason text is kept as written.
CATEGORIES = [
    ("Not recorded", r"^unspecified|no reason documented|no explicit reason|no churn reason recorded|no reason given"),
    ("Went unresponsive", r"unresponsive|never responded"),
    ("Service miss", r"missed communication|went to spam and was missed"),
    ("Business closed", r"shut(ting)? down|closure|business has failed|sold to|disbanded"),
    ("Non-payment", r"non-payment|no payment|overdue|ghosted payment|can't pay|non-response on payment|unpaid|stopped paying"),
    ("Lost to competitor", r"competitor|rb2b|switched provider"),
    ("Compliance", r"legal|compliance"),
    ("Low adoption", r"inherited|never converted|use-case|use case|never really|didn't really engage|no buy-in"),
    ("Champion left", r"left the company|stakeholder|champion|implementer left"),
    ("Budget cuts", r"pe ownership|cost-cutting|cut costs|budget|discounted rate"),
    ("Business change", r"pivot|downsiz|pre-launch|pre-order"),
    ("Product fit", r"deliverability|spam|complaints"),
    ("Low ROI or value", r"roi|justify|results|performance|value|cost"),
]


def num(v):
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v or "").replace("$", "").replace(",", "").strip()
    try:
        return float(s)
    except ValueError:
        return None


def values(sheet, rng, dates="FORMATTED_STRING"):
    r = sheet.call("GET", "/values/%s?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=%s"
                   % (urllib.parse.quote(rng), dates))
    return (r.json() if hasattr(r, "json") else r).get("values", [])


def kpi_monthly(sheet):
    k = values(sheet, "'Revised KPI Sheet Draft - V2'!A1:AO233", "SERIAL_NUMBER")
    cols = {i: (dt.date(1899, 12, 30) + dt.timedelta(days=int(h))).strftime("%Y-%m")
            for i, h in enumerate(k[4]) if i and isinstance(h, (int, float))}
    rows = []
    for i, month in sorted(cols.items(), key=lambda x: x[1]):
        r = {"month": month}
        for rn, f in KPI_ROWS.items():
            row = k[rn - 1] if rn - 1 < len(k) else []
            v = num(row[i]) if i < len(row) else None
            r[f] = round(v, 4) if v is not None else None
        share = r.pop("direct_services_share")
        if r["sub_ending"] is not None and share is not None:
            # The retainer is a flat fee; the sheet stores it as a share of the total.
            r["services_retainer_mrr"] = round(r["sub_ending"] * share / 50) * 50
            r["license_mrr_ending"] = r["sub_ending"] - r["services_retainer_mrr"]
        rows.append(r)
    return [r for r in rows if r["sub_ending"] is not None]


def period_month(p):
    mon, yy = re.split(r"[-\s]+", str(p).strip())[0][:3].lower(), re.split(r"[-\s]+", str(p).strip())[-1]
    return "20%s-%02d" % (yy[-2:], MONTHS[mon])


def revenue_monthly(sheet):
    out = {}
    for tab, keep in (("Monthly Revenue-2.5Y (INVESTOR DECK-DO NOT DELETE)", lambda m: m < "2025-07"),
                      ("Monthly Revenue TTM (B.O.D. + Company) ", lambda m: m >= "2025-07")):
        for r in values(sheet, "'%s'!A1:L200" % tab)[1:]:
            if len(r) < 4 or r[0] not in REV_LINES:
                continue
            m = period_month(r[3])
            if not keep(m):
                continue
            row = out.setdefault(m, {"month": m, **{v: 0.0 for v in REV_LINES.values()}})
            row[REV_LINES[r[0]]] = round(num(r[1]) or 0, 2)
    return sorted(out.values(), key=lambda x: x["month"])


def customer_key(name):
    n = re.split(r"\s+-\s+|\s*\(|\s*\|", name.strip())[0].strip().lower()
    return n.replace(", llc", "").replace(" llc", "").replace(".", "").strip()


def bookings(sheet):
    rows, flags = [], []
    for tab, year, ncols in (("FY25 WINS (Closed)", 2025, "N"), ("FY26 WINS", 2026, "O")):
        for r in values(sheet, "'%s'!A1:%s300" % (tab, ncols))[1:]:
            if not r or not isinstance(r[0], (int, float)) or len(r) < 10 or not r[6]:
                continue
            d = dt.datetime.strptime(str(r[6]), "%m/%d/%y").date()
            if d.year != year:
                flags.append("%s row %d dated %s" % (tab, int(r[0]), d.isoformat()))
                d = d.replace(year=year)
            rows.append({"deal": "%d-%d" % (year, int(r[0])), "date": d.isoformat(), "client": r[2].strip(),
                         "customer": customer_key(r[2]), "product": r[3], "category": r[4], "deal_type": r[5],
                         "channel": "Reseller" if r[8] in ("Agency", "Reseller") else r[8],
                         "tcv": num(r[9]) or 0, "mrr": num(r[10]) or 0, "dsp_revenue": num(r[11]) or 0,
                         "mail_revenue": (num(r[13]) or 0) if year == 2026 and len(r) > 13 else 0})
    rows.sort(key=lambda x: (x["date"], x["deal"]))
    seen = set()
    for row in rows:
        # Each customer counts once as a new logo, at its first New software deal since January 2025.
        row["new_logo"] = row["deal_type"] == "New" and row["category"] == "Software" and row["customer"] not in seen
        if row["new_logo"]:
            seen.add(row["customer"])
    return rows, flags


def categorize(reason):
    if not reason:
        return "Not recorded"
    low = reason.lower()
    for cat, pat in CATEGORIES:
        if re.search(pat, low):
            return cat
    return "Other"


def churn_log(xlsx_path, reasons_path, slack_path):
    import openpyxl
    hs = json.load(open(reasons_path)) if os.path.exists(reasons_path) else []
    slack = {r["log_row"]: r for r in (json.load(open(slack_path)) if os.path.exists(slack_path) else [])}
    by_domain = {(h.get("domain") or "").lower(): h for h in hs if h.get("domain")}
    by_name = {re.sub(r"[^a-z0-9]", "", (h.get("name") or "").lower())[:8]: h for h in hs}
    ws = openpyxl.load_workbook(xlsx_path, data_only=True)["2026"]
    out = []
    for r in ws.iter_rows(min_row=2, values_only=True):
        if not isinstance(r[0], (int, float)) or not r[3]:
            continue
        email_domain = str(r[4] or "").split("@")[-1].lower()
        h = (by_domain.get(str(r[5] or "").lower()) or by_domain.get(email_domain)
             or by_name.get(re.sub(r"[^a-z0-9]", "", r[3].lower())[:8]))
        log_reason = (r[16] or "").strip()
        # Precedence: HubSpot's company churn reason, then Slack, then the log's own note.
        sl = slack.get(int(r[0]))
        if h and not h["churn_reason"].lower().startswith("unspecified"):
            reason, src = h["churn_reason"], "HubSpot"
        elif sl:
            reason, src = sl["reason"], "Slack"
        elif log_reason:
            reason, src = log_reason, "Churn log"
        elif h:
            reason, src = h["churn_reason"], "HubSpot"
        else:
            reason, src = "", ""
        f = lambda v: v.strftime("%Y-%m-%d") if isinstance(v, dt.datetime) else v
        out.append({"log_row": int(r[0]), "churn_month": r[13].strftime("%Y-%m"), "customer": r[3].strip(),
                    "channel": r[6], "customer_type": r[7], "plan": r[8], "mrr": num(r[9]) or 0,
                    "start_date": f(r[11]), "end_date": f(r[12]), "days_active": r[14],
                    "churn_type": r[15] or "Not recorded", "reason": reason or "Not recorded",
                    "reason_source": src or "None", "reason_category": categorize(reason)})
    return out


def main():
    os.makedirs(OUT, exist_ok=True)
    key = os.environ["WINS_SA_KEY"]
    kpi = Sheet(key, KPI_ID)
    wins = Sheet(key, WINS_ID)
    files = {"kpi_monthly.json": kpi_monthly(kpi), "revenue_monthly.json": revenue_monthly(wins)}
    b, flags = bookings(wins)
    files["bookings.json"] = b
    churn_x = os.path.join(WS, "churn.xlsx")
    if os.path.exists(churn_x):
        files["churn_log_2026.json"] = churn_log(churn_x, os.path.join(WS, "hubspot_churn_reasons.json"),
                                                   os.path.join(WS, "slack_churn_reasons.json"))
    for name, rows in files.items():
        with open(os.path.join(OUT, name), "w") as fh:
            json.dump(rows, fh)
        print("%-24s %5d rows" % (name, len(rows)))
    for f in flags:
        print("date corrected:", f)


if __name__ == "__main__":
    main()

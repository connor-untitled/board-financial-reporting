#!/usr/bin/env python3
"""
Customer-level churn and monthly MRR movements from Stripe, for the dashboard.

Runs the board KPI rules in scripts/board-kpis/mrr.py (invoice lines, arrears
shift, client-account shift, annual spread) from January 2025 to the last
closed month, so the churn cards and the Stripe-vs-KPI check use the same
definitions as the monthly KPI draft. Nothing here writes to Stripe or to a
sheet.

Pulls every invoice since INVOICES_SINCE plus all subscriptions, customers and
products through the REST API (the proxy injects the Stripe credential), into
.board-dashboard/stripe/, then writes two files to .board-dashboard/out/:

- stripe_churns.json   one row per cancellation or contraction: month,
                       customer, Stripe customer id, channel, MRR before and
                       after, first paid start and last end date, and the
                       email domain used to match a HubSpot churn reason
- stripe_monthly.json  per month and channel: beginning, new, expansion,
                       reactivation, contraction, cancellation, ending, and
                       customers churned

The published KPI sheet stays the board's source for totals until the
year-end rebase; stripe_monthly.json is what the dashboard compares it with.

Usage:
    python3 scripts/board-dashboard/stripe_churn.py
"""

import datetime as dt
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
KPIS = os.path.join(os.path.dirname(HERE), "board-kpis")
sys.path.insert(0, KPIS)

import mrr  # noqa: E402
import stripe_pull  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(HERE))
WS = os.path.join(ROOT, ".board-dashboard", "stripe")
OUT = os.path.join(ROOT, ".board-dashboard", "out")

# Far enough back that an annual invoice covering January 2025 is included.
INVOICES_SINCE = "2024-01-01"
FIRST_MONTH = "2025-01"
FREEMAIL = {"gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com", "aol.com", "me.com", "live.com"}


def pull():
    os.makedirs(WS, exist_ok=True)
    since = int(dt.datetime.fromisoformat(INVOICES_SINCE).replace(tzinfo=dt.timezone.utc).timestamp())
    data = {}
    for name, endpoint, params in (("invoices", "invoices", [("created[gte]", str(since))]),
                                   ("subscriptions", "subscriptions", [("status", "all")]),
                                   ("customers", "customers", []),
                                   ("products", "products", [])):
        data[name] = stripe_pull.get(endpoint, params)
        with open(os.path.join(WS, name + ".json"), "w") as fh:
            json.dump(data[name], fh)
        print("%-14s %6d" % (name, len(data[name])))
    return data


def domain(customer):
    email = (customer.get("email") or "").strip().lower()
    d = email.split("@")[-1] if "@" in email else ""
    return "" if d in FREEMAIL else d


def main():
    data = pull()
    config = json.load(open(os.path.join(KPIS, "config.json")))
    config["first_month"] = FIRST_MONTH
    run_month = dt.date.today().strftime("%Y-%m")
    draft = mrr.run(data["invoices"], data["subscriptions"], data["customers"], data["products"], config, run_month)
    if draft.get("error") == "untagged":
        sys.exit("Customers with MRR but no client_type in Stripe: " + ", ".join(draft["customers"]))

    cust = {c["id"]: c for c in data["customers"]}
    dates = mrr.customer_dates(data["subscriptions"], data["products"], config)
    churns, monthly = [], []
    for m in draft["months"]:
        for ch in mrr.CHANNELS:
            i = m["inputs"][ch]
            monthly.append({"month": m["month"], "channel": ch, "beginning": m["beginning"][ch],
                            "new": i["new"], "expansion": i["expansion"], "reactivation": i["reactivation"],
                            "contraction": i["contraction"], "cancellation": i["cancellation"],
                            "ending": m["ending"][ch], "customers_churned": m["customers"][ch]["churned"],
                            "customers_ending": m["customers"][ch]["ending"]})
        for r in m["ledger"]:
            if r["kind"] not in ("cancellation", "contraction"):
                continue
            start, end = dates.get(r["customer_id"], (None, None))
            churns.append({"key": "%s-%s" % (m["month"], r["customer_id"]), "churn_month": m["month"],
                           "kind": r["kind"], "customer": r["customer"], "customer_id": r["customer_id"],
                           "channel": r["channel"], "mrr_before": r["before"], "mrr_after": r["after"],
                           "mrr_lost": round(r["before"] - r["after"], 2),
                           "start_date": mrr.day(start), "end_date": mrr.day(end) if r["kind"] == "cancellation" else None,
                           "domain": domain(cust.get(r["customer_id"], {}))})
    os.makedirs(OUT, exist_ok=True)
    for name, rows in (("stripe_churns.json", churns), ("stripe_monthly.json", monthly)):
        with open(os.path.join(OUT, name), "w") as fh:
            json.dump(rows, fh)
        print("%-20s %5d rows" % (name, len(rows)))


if __name__ == "__main__":
    main()

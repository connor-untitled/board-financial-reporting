#!/usr/bin/env python3
"""
Build one month's rows for the Subscription Rev Rec workbook from Stripe.

Pure logic: no network. run.py does the fetching and writing.

Each row is one invoice: Client, Invoice #, Invoice Date, Client Type,
Subscription / License Amount, Recognition Basis. The rules match how the
July and August 2026 tabs were built by hand, plus what was settled when
September was filled:

- An invoice dated in the month gives a "Not Arrears" row. Its amount is the
  subscription and license lines on it: plans, licenses, Destinations, client
  accounts and prorated first months. Consumption fees, free trials and
  Shopify Development services are left out. Discounts are netted off.
- The arrears resellers (config.json in board-kpis) are billed for a month on
  the 1st of the next one, so their row comes from the invoice dated in the
  following month and is marked "Arrears".
- Client accounts are billed in arrears for every reseller. On a renewal
  invoice dated the 1st, the client-account lines pay for the month before:
  they become an "Arrears (client accounts)" row in that earlier month and
  are left out of the invoice's own month. A renewal on any other day (a
  subscription anchored mid-month, like EvolveMKD on the 10th) bills its
  accounts for the period ahead and stays in its own month.
- A line covering more than a month (an annual plan) counts one month's
  share, and is flagged.
- Void, uncollectible and never-sent (draft) invoices are left out of the
  month's own invoices and flagged. A draft dated the 1st of the next month
  is used for arrears rows, flagged as a draft, because on the 2nd business
  day some of those invoices are still waiting to be finalised.
- An invoice with an amount but no product on any line (a manual invoice)
  is not guessed at. It is flagged for a person to classify.
"""

import collections
import datetime as dt

EXCLUDED = {"Untitled - Free Trial", "Consumption Fees",
            "Lead Data Stream Consumption Fees", "Shopify Development"}
CLIENT_ACCOUNTS = {"Untitled Client Accounts"}
MONTHLY_MAX_DAYS = 40

NOT_ARREARS = "Not Arrears"
ARREARS = "Arrears"
ACCOUNTS_ARREARS = "Arrears (client accounts)"


def day(ts):
    return dt.datetime.fromtimestamp(ts, dt.timezone.utc).date()


def next_month(month):
    y, m = map(int, month.split("-"))
    return "%04d-%02d" % (y + m // 12, m % 12 + 1)


def customer_id(obj):
    c = obj.get("customer")
    return c.get("id") if isinstance(c, dict) else c


def line_product(line):
    details = (line.get("pricing") or {}).get("price_details") or {}
    return details.get("product") or (line.get("price") or {}).get("product")


def line_net(line):
    """Net amount in dollars, and the share of it that belongs to one month."""
    net = (line["amount"] - sum(d["amount"] for d in line.get("discount_amounts") or [])) / 100.0
    period = line.get("period") or {}
    days = (period.get("end", 0) - period.get("start", 0)) / 86400.0
    if days > MONTHLY_MAX_DAYS:
        return net / max(1, round(days / 30.4)), True
    return net, False


def is_first_of_month_renewal(inv):
    return (inv.get("billing_reason") == "subscription_cycle"
            and day(inv["created"]).day == 1)


def build(invoices, customers, products, arrears_ids, month):
    """(rows, flags) for `month` ('YYYY-MM')."""
    names = {p["id"]: p.get("name", "") for p in products}
    cust = {c["id"]: c for c in customers}
    following = next_month(month)
    rows, flags = [], collections.defaultdict(list)

    def client(cid):
        c = cust.get(cid, {})
        return (c.get("name") or cid).strip(), (c.get("metadata") or {}).get("client_type") or ""

    for inv in invoices:
        cid = customer_id(inv)
        name, ctype = client(cid)
        when = day(inv["created"])
        inv_month = when.strftime("%Y-%m")
        arrears = cid in arrears_ids
        status = inv.get("status")

        # Which part of this invoice, if any, belongs to `month`, and how.
        if arrears:
            if inv_month != following:
                continue
            take, basis = (lambda prod: True), ARREARS
        elif inv_month == month:
            renewal_1st = is_first_of_month_renewal(inv)
            take = lambda prod, r=renewal_1st: not (r and prod in CLIENT_ACCOUNTS)
            basis = NOT_ARREARS
        elif inv_month == following and is_first_of_month_renewal(inv):
            take, basis = (lambda prod: prod in CLIENT_ACCOUNTS), ACCOUNTS_ARREARS
        else:
            continue

        amount, annual, unclassified = 0.0, False, 0.0
        for line in inv["lines"]["data"]:
            product = names.get(line_product(line))
            if product is None:
                if inv.get("billing_reason") == "manual" and line["amount"]:
                    unclassified += line["amount"] / 100.0
                continue
            if product in EXCLUDED or not take(product):
                continue
            share, spread = line_net(line)
            amount += share
            annual = annual or spread

        if unclassified and basis == NOT_ARREARS:
            flags["manual"].append("%s %s (%s) $%.2f has no product on it; classify by hand"
                                   % (name, inv.get("number"), when, unclassified))
        if abs(amount) < 0.005:
            continue

        label = "%s %s $%.2f" % (name, inv.get("number"), amount)
        if status in ("void", "uncollectible"):
            flags["skipped"].append("%s left out: invoice is %s" % (label, status))
            continue
        if status == "draft":
            if basis == NOT_ARREARS:
                flags["skipped"].append("%s left out: draft, never sent" % label)
                continue
            flags["draft"].append("%s used while still a draft; confirm once it is finalised" % label)
        if annual:
            flags["annual"].append("%s is one month's share of a longer invoice" % label)
        if not ctype:
            flags["untagged"].append("%s has no client_type in Stripe" % name)

        rows.append({
            "client": name, "invoice": inv.get("number") or inv["id"],
            "date": when.isoformat(), "type": ctype,
            "amount": round(amount, 2), "basis": basis,
        })

    rows.sort(key=lambda r: (r["type"] != "Direct", r["type"], r["client"].lower(), r["date"]))
    return rows, dict(flags)


# --- business days --------------------------------------------------------

def _nth_weekday(year, month, weekday, n):
    d = dt.date(year, month, 1)
    d += dt.timedelta(days=(weekday - d.weekday()) % 7)
    return d + dt.timedelta(weeks=n - 1)


def _last_weekday(year, month, weekday):
    d = dt.date(year + month // 12, month % 12 + 1, 1) - dt.timedelta(days=1)
    return d - dt.timedelta(days=(d.weekday() - weekday) % 7)


def _observed(d):
    if d.weekday() == 5:
        return d - dt.timedelta(days=1)
    if d.weekday() == 6:
        return d + dt.timedelta(days=1)
    return d


def holidays(year):
    """US federal holidays that close the business, with weekend observance."""
    return {
        _observed(dt.date(year, 1, 1)),
        _observed(dt.date(year + 1, 1, 1)),
        _last_weekday(year, 5, 0),            # Memorial Day
        _observed(dt.date(year, 6, 19)),      # Juneteenth
        _observed(dt.date(year, 7, 4)),
        _nth_weekday(year, 9, 0, 1),          # Labor Day
        _nth_weekday(year, 11, 3, 4),         # Thanksgiving
        _observed(dt.date(year, 12, 25)),
    }


def business_days(year, month):
    off = holidays(year)
    d = dt.date(year, month, 1)
    while d.month == month:
        if d.weekday() < 5 and d not in off:
            yield d
        d += dt.timedelta(days=1)


def second_business_day(year, month):
    days = business_days(year, month)
    next(days)
    return next(days)

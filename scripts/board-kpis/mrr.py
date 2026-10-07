#!/usr/bin/env python3
"""
Turn the Stripe pull into the board sheet's MRR inputs, month by month.

For each customer and month this works out the subscription MRR that month
carried, then classifies the change from the month before. The sums per
channel are the ten numbers typed into the KPI sheet:

    Direct    rows 82-86   New, Expansion, Reactivation, Contraction, Cancellation
    Reseller  rows 141-144 New, Expansion, (Reactivation), Contraction, Cancellation

The rules, each settled against the sheet's own history and the Subscription
Rev Rec workbook:

- MRR comes from invoice lines, not from the subscription's current items.
  An invoice records what was charged for a period; a subscription only says
  what it is now. Proration lines are skipped, discounts are netted off, an
  annual line is spread evenly over its twelve months, and void invoices are
  ignored. The same subscription item can appear on two invoices for the
  same period (a draft regenerated, say), so each item counts once a month,
  at the larger amount.
- A line belongs to the month its period starts in. That reproduces the
  sheet's rule that a cancellation lands in the month the Stripe
  subscription ends, which the Churn Inputs tab follows row for row.
- Arrears resellers are shifted back a month. Their license invoice dated
  the 1st pays for the month before, so the line that starts in August is
  July's MRR. Who is on arrears is a fixed list in config.json, read off the
  Rev Rec workbook's Recognition Basis column. Without the shift a new
  arrears reseller shows up a month late and a cancelled one churns a month
  late.
- The month a cancelled customer leaves is the first month with no
  recognised line, and a subscription's lines never count in or after the
  month it ended. The second half matters because Stripe can leave a draft
  invoice behind for a period after the subscription was cancelled (KP
  Staffing has one), which would otherwise churn the customer a month late.
  Together they put NeuroGraph in July, as Rev Rec has it, with no special
  case.
- A customer who starts mid-month on a plan billed from the 1st gets a
  prorated first invoice and its first full line the month after. That
  first month still counts at the full monthly rate, so New MRR lands in
  the month the customer actually started (Igg Marketing, Weird and BERM in
  August 2026), not the month its first full invoice covers.
- Client accounts are billed in arrears for every reseller. A renewal
  invoice dated the 1st bills the accounts that were active the month
  before, and an account added mid-month lands on the next bill, so a
  client-account line on any invoice but the first is shifted back a month.
  The first invoice, issued at signing, bills its accounts up front for the
  period it opens (EvolveMKD) and is not shifted. Customers already on the
  arrears list are shifted once, not twice. This is what puts DriveLocal's
  seven accounts, first billed October 1, in September.
- The newest month can be short of evidence: the invoice that carries an
  arrears license or a month's client accounts is dated the 1st of the
  month we are running in and may not exist yet. A subscription that is
  still live then counts at its current items (for client accounts, item by
  item) rather than reading as a cancellation or a contraction.
- Channel is the customer's client_type metadata in Stripe and nothing
  else. A customer with MRR in a reported month and no client_type stops
  the run, named, rather than being guessed.
- Services (Shopify Development) stay in Direct MRR, as the sheet has always
  carried them, and are also reported on their own for rows 13-14.

Usage:
    python3 mrr.py      # workspace pull -> draft.json and ledger.md
"""

import collections
import datetime as dt
import json
import os
import sys

import workspace as w

HERE = os.path.dirname(os.path.abspath(__file__))
CHANNELS = ("Direct", "Reseller")
KINDS = ("new", "expansion", "reactivation", "contraction", "cancellation")
LIVE = ("active", "past_due", "trialing", "unpaid")

# A period longer than this is not monthly. Stripe's monthly periods run
# 28-31 days; anything over 40 is quarterly or annual and gets spread.
MONTHLY_MAX_DAYS = 40


# --- months ----------------------------------------------------------------

def month_of(ts):
    """'YYYY-MM' for a Stripe timestamp, in UTC."""
    return dt.datetime.fromtimestamp(ts, dt.timezone.utc).strftime("%Y-%m")


def shift(month, n):
    y, m = map(int, month.split("-"))
    k = y * 12 + (m - 1) + n
    return "%04d-%02d" % (k // 12, k % 12 + 1)


def months_between(first, last):
    out, m = [], first
    while m <= last:
        out.append(m)
        m = shift(m, 1)
    return out


# --- per-customer MRR ------------------------------------------------------

def customer_id(obj):
    c = obj.get("customer")
    return c.get("id") if isinstance(c, dict) else c


def line_product(line):
    pricing = line.get("pricing") or {}
    details = pricing.get("price_details") or {}
    if details.get("product"):
        return details["product"]
    price = line.get("price") or {}
    return price.get("product")


def line_subscription(line):
    parent = line.get("parent") or {}
    details = parent.get("subscription_item_details") or {}
    return details.get("subscription") or line.get("subscription")


def line_item_id(line):
    parent = line.get("parent") or {}
    details = parent.get("subscription_item_details") or {}
    return details.get("subscription_item") or line.get("subscription_item") or line.get("id")


def is_proration(line):
    if line.get("proration"):
        return True
    parent = line.get("parent") or {}
    details = parent.get("subscription_item_details") or {}
    return bool(details.get("proration"))


def line_months(line):
    """[(month, amount)] this line contributes, before any arrears shift."""
    period = line["period"]
    net = line["amount"] - sum(d["amount"] for d in line.get("discount_amounts") or [])
    net = net / 100.0
    days = (period["end"] - period["start"]) / 86400.0
    start = month_of(period["start"])
    if days <= MONTHLY_MAX_DAYS:
        return [(start, net)]
    n = max(1, round(days / 30.4))
    return [(shift(start, i), net / n) for i in range(n)]


def build(invoices, products, config, subscriptions=()):
    """{customer_id: {month: {"total": x, "services": y}}} from invoice lines,
    and the set of (customer, subscription item, month) that a line reached."""
    ended = {s["id"]: month_of(s["ended_at"]) for s in subscriptions if s.get("ended_at")}
    names = {p["id"]: p.get("name", "") for p in products}
    excluded = set(config["excluded_products"])
    services = set(config["services_products"])
    accounts = set(config.get("client_account_products", ()))
    arrears = set(config["arrears_customers"])

    best = {}  # (customer, item, month) -> (amount, is_services)
    by_sub = collections.defaultdict(lambda: collections.defaultdict(float))
    partial_starts = set()  # (customer, subscription, month)
    for inv in invoices:
        if inv.get("status") == "void":
            continue
        cid = customer_id(inv)
        for line in inv["lines"]["data"]:
            if is_proration(line):
                sub = line_subscription(line)
                if inv.get("billing_reason") == "subscription_create" and sub and line["amount"] > 0:
                    partial_starts.add((cid, sub, month_of(line["period"]["start"])))
                continue
            if line.get("type") != "subscription":
                continue
            product = names.get(line_product(line), "")
            if product in excluded:
                continue
            svc = product in services
            renewal_accounts = (product in accounts
                                and inv.get("billing_reason") != "subscription_create")
            back = 1 if ((cid in arrears and not svc) or renewal_accounts) else 0
            item = line_item_id(line)
            stop = ended.get(line_subscription(line))
            for month, amount in line_months(line):
                month = shift(month, -back)
                if stop and month >= stop:
                    continue
                key = (cid, item, month)
                if key not in best or amount > best[key][0]:
                    best[key] = (amount, svc)
                    by_sub[line_subscription(line)][month] = 0.0  # summed below

    item_sub = {}
    for inv in invoices:
        for line in inv["lines"]["data"]:
            if line.get("type") == "subscription":
                item_sub[line_item_id(line)] = line_subscription(line)

    mrr = collections.defaultdict(lambda: collections.defaultdict(lambda: {"total": 0.0, "services": 0.0}))
    for (cid, item, month), (amount, svc) in best.items():
        cell = mrr[cid][month]
        cell["total"] += amount
        if svc:
            cell["services"] += amount
        by_sub[item_sub.get(item)][month] += amount

    # A prorated first month counts at the rate of the subscription's first
    # full month, when that is the month straight after.
    for cid, sub, month in partial_starts:
        if (ended.get(sub) and month >= ended[sub]) or by_sub[sub].get(month):
            continue
        full = by_sub[sub].get(shift(month, 1), 0.0)
        if full > 0:
            mrr[cid][month]["total"] += full
            by_sub[sub][month] = full
    return mrr, set(best)


def current_value(sub, products, config):
    """A live subscription's monthly value from its items as they stand now."""
    names = {p["id"]: p.get("name", "") for p in products}
    excluded = set(config["excluded_products"])
    total = 0.0
    for item in sub["items"]["data"]:
        price = item["price"]
        product = price["product"] if isinstance(price["product"], str) else price["product"]["id"]
        if names.get(product, "") in excluded:
            continue
        rec = price.get("recurring") or {}
        amount = (price.get("unit_amount") or 0) * (item.get("quantity") or 1) / 100.0
        if rec.get("interval") == "year":
            amount /= 12 * rec.get("interval_count", 1)
        elif rec.get("interval") == "month":
            amount /= rec.get("interval_count", 1)
        total += amount
    return total


def fill_pending(mrr, seen, subscriptions, products, config, month, run_month):
    """Carry live subscriptions into a month whose invoice is not due yet.

    An arrears customer with nothing in the month counts at its whole
    current subscription. Anyone else's client-account items that no line
    reached in the month count at their current quantity and price, so a
    renewal invoice not yet issued does not read as a contraction. A
    subscription that started after the month carries nothing into it."""
    if shift(month, 1) < run_month:
        return []
    names = {p["id"]: p.get("name", "") for p in products}
    accounts = set(config.get("client_account_products", ()))
    arrears = config["arrears_customers"]
    filled = []
    for sub in subscriptions:
        cid = customer_id(sub)
        if sub.get("status") not in LIVE:
            continue
        if sub.get("start_date") and month_of(sub["start_date"]) > month:
            continue  # signed after this month, so nothing to carry (Stockyard Media Haus)
        if cid in arrears:
            if mrr[cid][month]["total"] > 0:
                continue
            value = current_value(sub, products, config)
        else:
            value = 0.0
            for item in sub["items"]["data"]:
                price = item["price"]
                product = price["product"] if isinstance(price["product"], str) else price["product"]["id"]
                if names.get(product, "") not in accounts or (cid, item["id"], month) in seen:
                    continue
                value += (price.get("unit_amount") or 0) * (item.get("quantity") or 1) / 100.0
        if value > 0:
            mrr[cid][month]["total"] += value
            filled.append(cid)
    return filled


# --- movements -------------------------------------------------------------

def classify(before, after, had_mrr_earlier):
    if abs(after - before) < 0.005:
        return None
    if before <= 0:
        return "reactivation" if had_mrr_earlier else "new"
    if after <= 0:
        return "cancellation"
    return "expansion" if after > before else "contraction"


def ended_before(subscriptions, products, config, month):
    """Customers with a paid subscription that ended before `month` began."""
    paid = paid_test(products, config)
    out = set()
    for sub in subscriptions:
        if not sub.get("ended_at") or month_of(sub["ended_at"]) >= month:
            continue
        if paid(sub):
            out.add(customer_id(sub))
    return out


def paid_test(products, config):
    """sub -> True when it has a priced item on a product that is not excluded."""
    names = {p["id"]: p.get("name", "") for p in products}
    excluded = set(config["excluded_products"])
    return lambda sub: any(
        (it["price"].get("unit_amount") or 0) > 0
        and names.get(it["price"]["product"] if isinstance(it["price"]["product"], str)
                      else it["price"]["product"]["id"], "") not in excluded
        for it in sub["items"]["data"])


def customer_dates(subscriptions, products, config):
    """{customer: (first paid subscription start, last end)} as Stripe timestamps.
    The Churn Inputs tab's Stripe Start Date and Stripe End Date."""
    paid = paid_test(products, config)
    out = {}
    for sub in subscriptions:
        if not paid(sub):
            continue
        cid = customer_id(sub)
        start = sub.get("start_date") or sub.get("created")
        first, last = out.get(cid, (None, None))
        first = start if first is None or (start and start < first) else first
        end = sub.get("ended_at")
        last = end if end and (last is None or end > last) else last
        out[cid] = (first, last)
    return out


def day(ts):
    return dt.datetime.fromtimestamp(ts, dt.timezone.utc).strftime("%Y-%m-%d") if ts else None


def run(invoices, subscriptions, customers, products, config, run_month):
    """The draft: per reported month, the sheet inputs and the ledger rows."""
    mrr, seen = build(invoices, products, config, subscriptions)
    first = config["first_month"]
    last = shift(run_month, -1)
    months = months_between(first, last)

    filled = {}
    for month in [shift(first, -1)] + months:
        filled[month] = fill_pending(mrr, seen, subscriptions, products, config, month, run_month)

    dates = customer_dates(subscriptions, products, config)
    cust = {c["id"]: c for c in customers}
    name = lambda cid: (cust.get(cid, {}).get("name") or cid).strip()
    channel = lambda cid: (cust.get(cid, {}).get("metadata") or {}).get("client_type")

    untagged = sorted({name(cid) for cid in mrr for m in [shift(first, -1)] + months
                       if mrr[cid][m]["total"] > 0 and channel(cid) not in CHANNELS})
    if untagged:
        return {"error": "untagged", "customers": untagged}

    out = {"run_month": run_month, "months": []}
    for month in months:
        prev = shift(month, -1)
        earlier = {cid for cid in mrr for m in mrr[cid] if m < prev and mrr[cid][m]["total"] > 0}
        earlier |= ended_before(subscriptions, products, config, prev)

        beginning = {ch: 0.0 for ch in CHANNELS}
        ending = {ch: 0.0 for ch in CHANNELS}
        paying = {ch: {"beginning": 0, "ending": 0} for ch in CHANNELS}
        services = 0.0
        sums = {ch: {k: 0.0 for k in KINDS} for ch in CHANNELS}
        rows = []
        for cid in mrr:
            ch = channel(cid)
            if ch not in CHANNELS:
                continue
            before, after = mrr[cid][prev]["total"], mrr[cid][month]["total"]
            beginning[ch] += before
            ending[ch] += after
            paying[ch]["beginning"] += before > 0.005
            paying[ch]["ending"] += after > 0.005
            if ch == "Direct":
                services += mrr[cid][month]["services"]
            kind = classify(before, after, cid in earlier)
            if kind is None:
                continue
            sums[ch][kind] += abs(after - before)
            rows.append({
                "customer": name(cid), "customer_id": cid, "channel": ch,
                "kind": kind, "before": round(before, 2), "after": round(after, 2),
                "change": round(after - before, 2),
                "arrears": cid in config["arrears_customers"],
                "carried_forward": cid in filled.get(month, []),
            })
        rows.sort(key=lambda r: (r["channel"], KINDS.index(r["kind"]), -abs(r["change"])))

        # Customer counts follow the movements: a reactivation is a customer
        # gained, a cancellation one lost.
        counts = {ch: {"new": sum(1 for r in rows if r["channel"] == ch
                                  and r["kind"] in ("new", "reactivation")),
                       "churned": sum(1 for r in rows if r["channel"] == ch
                                      and r["kind"] == "cancellation"),
                       "beginning": paying[ch]["beginning"],
                       "ending": paying[ch]["ending"]} for ch in CHANNELS}
        churn_rows = []
        for r in rows:
            if r["kind"] != "cancellation":
                continue
            start, end = dates.get(r["customer_id"], (None, None))
            days = (end - start) // 86400 if start and end else None
            churn_rows.append({"client": r["customer"], "customer_type": r["channel"],
                               "mrr": r["before"], "start": day(start), "end": day(end),
                               "days": days})

        entry = {
            "month": month,
            "beginning": {k: round(v, 2) for k, v in beginning.items()},
            "inputs": {ch: {k: round(v, 2) for k, v in sums[ch].items()} for ch in CHANNELS},
            "ending": {k: round(v, 2) for k, v in ending.items()},
            "direct_services_mrr": round(services, 2),
            "carried_forward": sorted(name(cid) for cid in filled.get(month, [])),
            "customers": counts,
            "churn_rows": churn_rows,
            "ledger": rows,
        }
        rebase = config.get("rebase") or {}
        if rebase.get("month") == month:
            entry["rebase_adjustment"] = {
                ch: round(beginning[ch] - rebase["sheet_prior_ending"][ch], 2) for ch in CHANNELS}
            prior_count = rebase.get("sheet_prior_customers")
            if prior_count:
                entry["customer_rebase_adjustment"] = {
                    ch: paying[ch]["beginning"] - prior_count[ch] for ch in CHANNELS}
        out["months"].append(entry)
    return out


# --- output ----------------------------------------------------------------

def money(v):
    return ("-$" if v < 0 else "$") + "{:,.0f}".format(abs(v))


def ledger_markdown(draft):
    lines = ["# Board KPI MRR draft", ""]
    for m in draft["months"]:
        label = dt.datetime.strptime(m["month"], "%Y-%m").strftime("%B %Y")
        lines += ["## " + label, "",
                  "| | Direct | Reseller |", "| --- | --- | --- |",
                  "| Beginning MRR | %s | %s |" % (money(m["beginning"]["Direct"]), money(m["beginning"]["Reseller"]))]
        for k in KINDS:
            lines.append("| %s | %s | %s |" % (k.capitalize(), money(m["inputs"]["Direct"][k]), money(m["inputs"]["Reseller"][k])))
        lines.append("| Ending MRR | %s | %s |" % (money(m["ending"]["Direct"]), money(m["ending"]["Reseller"])))
        lines += ["", "Direct services MRR (Shopify Development): %s" % money(m["direct_services_mrr"])]
        lines.append("Customers: Direct +%d / -%d, Reseller +%d / -%d" % (
            m["customers"]["Direct"]["new"], m["customers"]["Direct"]["churned"],
            m["customers"]["Reseller"]["new"], m["customers"]["Reseller"]["churned"]))
        if "customer_rebase_adjustment" in m:
            a = m["customer_rebase_adjustment"]
            lines.append("Customer count rebase vs the sheet's prior ending: Direct %+d, Reseller %+d"
                         % (a["Direct"], a["Reseller"]))
        if "rebase_adjustment" in m:
            a = m["rebase_adjustment"]
            lines.append("Rebase adjustment vs the sheet's prior ending: Direct %s, Reseller %s"
                         % (money(a["Direct"]), money(a["Reseller"])))
        if m["carried_forward"]:
            lines.append("Counted at their current subscription because the invoice that carries this "
                         "month is not out yet: " + ", ".join(m["carried_forward"]))
        lines += ["", "| Channel | Movement | Customer | Before | After | Note |",
                  "| --- | --- | --- | --- | --- | --- |"]
        for r in m["ledger"]:
            note = []
            if r["arrears"]:
                note.append("arrears")
            if r["carried_forward"]:
                note.append("current subscription, invoice not out yet")
            lines.append("| %s | %s | %s | %s | %s | %s |" % (
                r["channel"], r["kind"], r["customer"], money(r["before"]), money(r["after"]), ", ".join(note)))
        lines.append("")
    return "\n".join(lines)


def load(name):
    with open(w.path(name)) as f:
        return json.load(f)


def main():
    config = json.load(open(os.path.join(HERE, "config.json")))
    run_month = os.environ.get("BOARD_KPIS_RUN_MONTH") or dt.date.today().strftime("%Y-%m")
    draft = run(load(w.INVOICES), load(w.SUBSCRIPTIONS), load(w.CUSTOMERS),
                load(w.PRODUCTS), config, run_month)
    if draft.get("error") == "untagged":
        print("Customers with MRR but no client_type in Stripe:")
        for n in draft["customers"]:
            print("  " + n)
        sys.exit(2)
    with open(w.path(w.DRAFT), "w") as f:
        json.dump(draft, f, indent=2)
    with open(w.path(w.LEDGER), "w") as f:
        f.write(ledger_markdown(draft))
    for m in draft["months"]:
        print(m["month"], json.dumps(m["inputs"]))


if __name__ == "__main__":
    main()

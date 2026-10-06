#!/usr/bin/env python3
"""
Tests the MRR rules against fixtures shaped like real Stripe invoices.

Each case is a customer pattern that came up while reconciling the board
sheet, named after the account that showed it.

Run: python3 scripts/board-kpis/test_mrr.py
"""

import calendar
import datetime as dt
import sys

import mrr as M

CASES = []


def case(name):
    def register(fn):
        CASES.append((name, fn))
        return fn
    return register


def ts(day):
    y, m, d = map(int, day.split("-"))
    return calendar.timegm(dt.datetime(y, m, d, 5).timetuple())


PRODUCTS = [
    {"id": "prod_plan", "name": "Untitled - Starter Plan"},
    {"id": "prod_license", "name": "Untitled Platform License"},
    {"id": "prod_trial", "name": "Untitled - Free Trial"},
    {"id": "prod_dev", "name": "Shopify Development"},
    {"id": "prod_accounts", "name": "Untitled Client Accounts"},
]


def config(**over):
    base = {
        "first_month": "2026-08",
        "rebase": {},
        "excluded_products": ["Untitled - Free Trial", "Consumption Fees"],
        "services_products": ["Shopify Development"],
        "client_account_products": ["Untitled Client Accounts"],
        "arrears_customers": {},
    }
    base.update(over)
    return base


def customer(cid, channel="Direct", name=None):
    meta = {"client_type": channel} if channel else {}
    return {"id": cid, "name": name or cid, "metadata": meta}


def line(start, end, amount, sub="sub_1", item="si_1", product="prod_plan",
         proration=False, discount=0, kind="subscription"):
    return {
        "type": kind, "amount": amount, "period": {"start": ts(start), "end": ts(end)},
        "discount_amounts": [{"amount": discount}] if discount else [],
        "pricing": {"price_details": {"product": product}},
        "parent": {"subscription_item_details": {
            "subscription": sub, "subscription_item": item, "proration": proration}},
    }


def invoice(cid, lines, status="paid", reason="subscription_cycle"):
    return {"customer": cid, "status": status, "billing_reason": reason,
            "lines": {"data": lines}}


def monthly(cid, first, last, amount, **kw):
    """One invoice per month from first to last (YYYY-MM), billed on the 1st."""
    out = []
    for month in M.months_between(first, last):
        nxt = M.shift(month, 1)
        out.append(invoice(cid, [line(month + "-01", nxt + "-01", amount, **kw)]))
    return out


def subscription(sid, cid, status="active", ended=None, amount=50000, product="prod_plan",
                 items=None):
    """items: [(item_id, product, unit_amount, quantity)] overrides the single item."""
    items = items or [("si_1", product, amount, 1)]
    return {"id": sid, "customer": cid, "status": status,
            "ended_at": ts(ended) if ended else None,
            "items": {"data": [{"id": iid, "quantity": qty, "price": {
                "product": prod, "unit_amount": unit,
                "recurring": {"interval": "month", "interval_count": 1}}}
                for iid, prod, unit, qty in items]}}


def plan_and_accounts(cid, month, accounts, reason="subscription_cycle", status="paid",
                      plan=50000, start=None):
    """A reseller invoice: the plan plus `accounts` client accounts at $350."""
    start = start or month + "-01"
    end = M.shift(month, 1) + start[7:]
    lines = [line(start, end, plan)]
    if accounts:
        lines.append(line(start, end, 35000 * accounts, item="si_acc", product="prod_accounts"))
    return invoice(cid, lines, status=status, reason=reason)


def run(invoices, subs, customers, cfg=None, run_month="2026-10"):
    return M.run(invoices, subs, customers, PRODUCTS, cfg or config(), run_month)


def month(draft, m):
    return next(x for x in draft["months"] if x["month"] == m)


# --- cases -----------------------------------------------------------------

@case("a steady customer moves nothing and carries its MRR through")
def _():
    d = run(monthly("c1", "2026-06", "2026-10", 50000),
            [subscription("sub_1", "c1")], [customer("c1")])
    aug = month(d, "2026-08")
    assert aug["beginning"]["Direct"] == 500 and aug["ending"]["Direct"] == 500, aug
    assert not aug["ledger"], aug["ledger"]


@case("Fresh Harvest: a higher invoice the next month is Expansion")
def _():
    inv = monthly("c1", "2026-06", "2026-07", 50000) + monthly("c1", "2026-08", "2026-10", 125000)
    d = run(inv, [subscription("sub_1", "c1")], [customer("c1")])
    assert month(d, "2026-08")["inputs"]["Direct"]["expansion"] == 750


@case("AEV: a discount shows up as Contraction, net of the coupon")
def _():
    inv = monthly("c1", "2026-06", "2026-08", 125000)
    inv += monthly("c1", "2026-09", "2026-10", 125000, discount=25000)
    d = run(inv, [subscription("sub_1", "c1")], [customer("c1")])
    assert month(d, "2026-09")["inputs"]["Direct"]["contraction"] == 250


@case("KP Staffing: a draft left after the subscription ended does not delay churn")
def _():
    inv = monthly("c1", "2026-06", "2026-07", 25000)
    inv.append(invoice("c1", [line("2026-08-01", "2026-09-01", 25000)], status="draft"))
    subs = [subscription("sub_1", "c1", status="canceled", ended="2026-08-01")]
    d = run(inv, subs, [customer("c1")])
    assert month(d, "2026-08")["inputs"]["Direct"]["cancellation"] == 250, month(d, "2026-08")


@case("a paid invoice and a regenerated draft for the same period count once")
def _():
    inv = monthly("c1", "2026-07", "2026-10", 50000)
    inv.append(invoice("c1", [line("2026-08-01", "2026-09-01", 50000)], status="draft"))
    d = run(inv, [subscription("sub_1", "c1")], [customer("c1")])
    assert month(d, "2026-08")["ending"]["Direct"] == 500


@case("void invoices and free trials never count")
def _():
    inv = [invoice("c1", [line("2026-08-01", "2026-09-01", 50000)], status="void"),
           invoice("c1", [line("2026-08-01", "2026-09-01", 0, product="prod_trial")])]
    d = run(inv, [], [customer("c1")])
    assert month(d, "2026-08")["ending"]["Direct"] == 0


@case("an annual plan counts a twelfth a month, starting the month it was sold")
def _():
    inv = [invoice("c1", [line("2026-09-01", "2027-09-01", 1800000)], reason="subscription_create")]
    d = run(inv, [subscription("sub_1", "c1")], [customer("c1")])
    sep = month(d, "2026-09")
    assert sep["inputs"]["Direct"]["new"] == 1500, sep


@case("Vagabond: a customer who left and came back is Reactivation, not New")
def _():
    inv = monthly("c1", "2025-10", "2026-04", 65000) + monthly("c1", "2026-08", "2026-10", 50000)
    subs = [subscription("sub_0", "c1", status="canceled", ended="2026-05-01", amount=65000),
            subscription("sub_1", "c1")]
    d = run(inv, subs, [customer("c1")])
    aug = month(d, "2026-08")["inputs"]["Direct"]
    assert aug["reactivation"] == 500 and aug["new"] == 0, aug


@case("Igg Marketing: a prorated first month counts as New at the full rate")
def _():
    inv = [invoice("c1", [line("2026-08-11", "2026-09-01", 32904, kind="invoiceitem", proration=True)],
                   reason="subscription_create")]
    inv += monthly("c1", "2026-09", "2026-10", 50000)
    d = run(inv, [subscription("sub_1", "c1")], [customer("c1", "Reseller")])
    assert month(d, "2026-08")["inputs"]["Reseller"]["new"] == 500, month(d, "2026-08")
    assert month(d, "2026-09")["inputs"]["Reseller"]["new"] == 0


@case("Igg Marketing: a subscription cancelled the day it began adds nothing")
def _():
    inv = [invoice("c1", [line("2026-08-11", "2026-09-01", 32904, sub="sub_dup",
                               kind="invoiceitem", proration=True)], reason="subscription_create"),
           invoice("c1", [line("2026-08-11", "2026-09-11", 50000, sub="sub_dup", item="si_dup")],
                   status="draft", reason="subscription_update")]
    subs = [subscription("sub_dup", "c1", status="canceled", ended="2026-08-11")]
    d = run(inv, subs, [customer("c1", "Reseller")])
    assert month(d, "2026-08")["ending"]["Reseller"] == 0, month(d, "2026-08")


@case("arrears reseller: the invoice dated the 1st is last month's MRR")
def _():
    cfg = config(arrears_customers={"c1": "Cumulus Media"})
    inv = monthly("c1", "2026-06", "2026-10", 250000, product="prod_license")
    d = run(inv, [subscription("sub_1", "c1", amount=250000)], [customer("c1", "Reseller")], cfg)
    assert month(d, "2026-09")["ending"]["Reseller"] == 2500, month(d, "2026-09")
    assert not month(d, "2026-09")["ledger"]


@case("NeuroGraph: an arrears reseller whose last invoice was July 1 churns in July")
def _():
    cfg = config(first_month="2026-07", arrears_customers={"c1": "NeuroGraph"})
    inv = monthly("c1", "2026-04", "2026-07", 250000, product="prod_license")
    subs = [subscription("sub_1", "c1", status="canceled", ended="2026-08-01", amount=250000)]
    d = run(inv, subs, [customer("c1", "Reseller")], cfg)
    assert month(d, "2026-07")["inputs"]["Reseller"]["cancellation"] == 2500, month(d, "2026-07")


@case("Ez As Pie: a live arrears reseller with next month's invoice not out yet is carried")
def _():
    cfg = config(arrears_customers={"c1": "Ez As Pie"})
    inv = monthly("c1", "2026-06", "2026-09", 60000, product="prod_license")
    d = run(inv, [subscription("sub_1", "c1", amount=60000, product="prod_license")],
            [customer("c1", "Reseller")], cfg)
    sep = month(d, "2026-09")
    assert sep["inputs"]["Reseller"]["cancellation"] == 0, sep
    assert sep["carried_forward"] == ["c1"], sep


@case("DriveLocal: client accounts first billed on the Oct 1 renewal are September MRR")
def _():
    inv = [plan_and_accounts("c1", m, 0) for m in ("2026-08", "2026-09")]
    inv.append(plan_and_accounts("c1", "2026-10", 7, status="draft"))
    subs = [subscription("sub_1", "c1", items=[("si_1", "prod_plan", 50000, 1),
                                               ("si_acc", "prod_accounts", 35000, 7)])]
    d = run(inv, subs, [customer("c1", "Reseller")])
    sep = month(d, "2026-09")
    assert sep["inputs"]["Reseller"]["expansion"] == 2450, sep
    assert sep["ending"]["Reseller"] == 2950, sep


@case("EvolveMKD: accounts billed at signing count that month, and carry until renewal")
def _():
    inv = [plan_and_accounts("c1", "2026-08", 3, reason="subscription_create", start="2026-08-10")]
    subs = [subscription("sub_1", "c1", items=[("si_1", "prod_plan", 50000, 1),
                                               ("si_acc", "prod_accounts", 35000, 3)])]
    inv.append(plan_and_accounts("c1", "2026-09", 0, start="2026-09-10"))
    d = run(inv, subs, [customer("c1", "Reseller")])
    aug, sep = month(d, "2026-08"), month(d, "2026-09")
    assert aug["inputs"]["Reseller"]["new"] == 1550, aug
    assert sep["ending"]["Reseller"] == 1550 and not sep["ledger"], sep
    assert sep["carried_forward"] == ["c1"], sep


@case("Cumulus: an arrears reseller's client accounts shift back once, not twice")
def _():
    cfg = config(arrears_customers={"c1": "Cumulus Media"})
    inv = [plan_and_accounts("c1", m, 0, plan=250000) for m in ("2026-08", "2026-09")]
    inv.append(plan_and_accounts("c1", "2026-10", 4, plan=200000, status="draft"))
    subs = [subscription("sub_1", "c1", items=[("si_1", "prod_license", 200000, 1),
                                               ("si_acc", "prod_accounts", 35000, 4)])]
    d = run(inv, subs, [customer("c1", "Reseller")], cfg)
    aug, sep = month(d, "2026-08"), month(d, "2026-09")
    assert aug["ending"]["Reseller"] == 2500 and not aug["ledger"], aug
    assert sep["inputs"]["Reseller"]["expansion"] == 900, sep


@case("an account added mid-month and billed on the next invoice counts in the month added")
def _():
    inv = [plan_and_accounts("c1", "2026-07", 2), plan_and_accounts("c1", "2026-08", 2),
           plan_and_accounts("c1", "2026-09", 3), plan_and_accounts("c1", "2026-10", 3)]
    subs = [subscription("sub_1", "c1", items=[("si_1", "prod_plan", 50000, 1),
                                               ("si_acc", "prod_accounts", 35000, 3)])]
    d = run(inv, subs, [customer("c1", "Reseller")])
    assert month(d, "2026-08")["inputs"]["Reseller"]["expansion"] == 350, month(d, "2026-08")
    assert not month(d, "2026-09")["ledger"], month(d, "2026-09")


@case("services stay in Direct MRR and are also reported on their own")
def _():
    inv = monthly("c1", "2026-07", "2026-10", 360000, product="prod_dev")
    inv += monthly("c2", "2026-07", "2026-10", 25000, sub="sub_2", item="si_2")
    subs = [subscription("sub_1", "c1"), subscription("sub_2", "c2")]
    d = run(inv, subs, [customer("c1"), customer("c2")])
    aug = month(d, "2026-08")
    assert aug["ending"]["Direct"] == 3850 and aug["direct_services_mrr"] == 3600, aug


@case("a customer with MRR and no client_type stops the run by name")
def _():
    d = run(monthly("c1", "2026-07", "2026-10", 50000), [],
            [customer("c1", channel=None, name="Energy Domain")])
    assert d == {"error": "untagged", "customers": ["Energy Domain"]}, d


@case("the rebase month reports its gap to the sheet's prior ending")
def _():
    cfg = config(rebase={"month": "2026-08",
                         "sheet_prior_ending": {"Direct": 450, "Reseller": 0}})
    d = run(monthly("c1", "2026-07", "2026-10", 50000), [], [customer("c1")], cfg)
    assert month(d, "2026-08")["rebase_adjustment"] == {"Direct": 50, "Reseller": 0}


@case("every reported month ties: beginning plus movements equals ending")
def _():
    inv = (monthly("c1", "2026-06", "2026-08", 50000)
           + monthly("c2", "2026-08", "2026-10", 30000, sub="sub_2", item="si_2")
           + monthly("c3", "2026-06", "2026-10", 100000, sub="sub_3", item="si_3"))
    subs = [subscription("sub_1", "c1", status="canceled", ended="2026-09-01"),
            subscription("sub_2", "c2"), subscription("sub_3", "c3")]
    d = run(inv, subs, [customer("c1"), customer("c2", "Reseller"), customer("c3")])
    for m in d["months"]:
        for ch in M.CHANNELS:
            i = m["inputs"][ch]
            calc = (m["beginning"][ch] + i["new"] + i["expansion"] + i["reactivation"]
                    - i["contraction"] - i["cancellation"])
            assert abs(calc - m["ending"][ch]) < 0.01, (m["month"], ch, m)


def main():
    failed = 0
    for name, fn in CASES:
        try:
            fn()
            print("ok    %s" % name)
        except (AssertionError, StopIteration, KeyError) as err:
            failed += 1
            print("FAIL  %s\n        %r" % (name, err))
    print("\n%d failed" % failed if failed else "\nall passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

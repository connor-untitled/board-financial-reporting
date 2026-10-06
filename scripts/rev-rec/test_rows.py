#!/usr/bin/env python3
"""
Tests the Rev Rec row rules and the business-day calendar. No network.

Run: python3 scripts/rev-rec/test_rows.py
"""

import calendar
import datetime as dt
import sys

import rows as R

CASES = []


def case(name):
    def register(fn):
        CASES.append((name, fn))
        return fn
    return register


def ts(day, hour=5):
    y, m, d = map(int, day.split("-"))
    return calendar.timegm(dt.datetime(y, m, d, hour).timetuple())


PRODUCTS = [{"id": "plan", "name": "Untitled - Starter Plan"},
            {"id": "license", "name": "Untitled Platform License"},
            {"id": "accounts", "name": "Untitled Client Accounts"},
            {"id": "usage", "name": "Consumption Fees"},
            {"id": "dev", "name": "Shopify Development"}]
CUSTOMERS = [{"id": "d1", "name": "Direct Co", "metadata": {"client_type": "Direct"}},
             {"id": "r1", "name": "Reseller Co", "metadata": {"client_type": "Reseller"}},
             {"id": "a1", "name": "Arrears Co", "metadata": {"client_type": "Reseller"}},
             {"id": "u1", "name": "Untagged Co", "metadata": {}}]


def line(amount, product="plan", start="2026-09-01", end="2026-10-01", discount=0):
    return {"amount": amount, "pricing": {"price_details": {"product": product}},
            "period": {"start": ts(start), "end": ts(end)},
            "discount_amounts": [{"amount": discount}] if discount else []}


def inv(cid, created, lines, status="paid", reason="subscription_cycle", number=None):
    return {"id": "in_" + (number or created), "number": number or "%s-%s" % (cid, created),
            "customer": cid, "created": ts(created), "status": status,
            "billing_reason": reason, "lines": {"data": lines}}


def build(invoices, month="2026-09"):
    return R.build(invoices, CUSTOMERS, PRODUCTS, {"a1"}, month)


@case("a September invoice is a Not Arrears row, without consumption or services")
def _():
    rows, _ = build([inv("d1", "2026-09-07", [line(25000), line(4000, "usage"), line(360000, "dev")])])
    assert [(r["amount"], r["basis"]) for r in rows] == [(250.0, "Not Arrears")], rows


@case("discounts are netted off (AEV)")
def _():
    rows, _ = build([inv("d1", "2026-09-10", [line(125000, discount=25000)])])
    assert rows[0]["amount"] == 1000.0, rows


@case("an annual invoice counts one month and is flagged (Atlas)")
def _():
    rows, flags = build([inv("d1", "2026-09-16", [line(600000, "license", "2026-09-16", "2027-09-16")],
                             reason="subscription_create")])
    assert rows[0]["amount"] == 500.0 and flags["annual"], (rows, flags)


@case("an arrears reseller's month comes from the invoice dated the 1st of the next")
def _():
    invoices = [inv("a1", "2026-09-01", [line(250000, "license")]),
                inv("a1", "2026-10-01", [line(200000, "license", "2026-10-01", "2026-11-01"),
                                         line(140000, "accounts", "2026-10-01", "2026-11-01")])]
    rows, _ = build(invoices)
    assert [(r["invoice"], r["amount"], r["basis"]) for r in rows] == \
        [("a1-2026-10-01", 3400.0, "Arrears")], rows


@case("DriveLocal: client accounts on the Oct 1 renewal become a September row")
def _():
    invoices = [inv("r1", "2026-09-01", [line(50000)]),
                inv("r1", "2026-10-01", [line(50000, start="2026-10-01", end="2026-11-01"),
                                         line(245000, "accounts", "2026-10-01", "2026-11-01")])]
    rows, _ = build(invoices)
    assert sorted((r["amount"], r["basis"]) for r in rows) == \
        [(500.0, "Not Arrears"), (2450.0, "Arrears (client accounts)")], rows


@case("...and the same accounts on a 1st-of-month renewal stay out of the invoice's own month")
def _():
    invoices = [inv("r1", "2026-10-01", [line(50000, start="2026-10-01", end="2026-11-01"),
                                         line(245000, "accounts", "2026-10-01", "2026-11-01")])]
    rows, _ = build(invoices, "2026-10")
    assert [(r["amount"], r["basis"]) for r in rows] == [(500.0, "Not Arrears")], rows


@case("EvolveMKD: accounts on a renewal anchored mid-month stay in that month")
def _():
    rows, _ = build([inv("r1", "2026-09-10", [line(50000, start="2026-09-10", end="2026-10-10"),
                                              line(105000, "accounts", "2026-09-10", "2026-10-10")])])
    assert rows[0]["amount"] == 1550.0 and rows[0]["basis"] == "Not Arrears", rows


@case("a prorated first month is counted as invoiced (Zoek)")
def _():
    rows, _ = build([inv("r1", "2026-09-14", [line(27273, start="2026-09-14")],
                         reason="subscription_create")])
    assert rows[0]["amount"] == 272.73, rows


@case("Link Helpers: a draft in the month is left out and flagged")
def _():
    rows, flags = build([inv("r1", "2026-09-10", [line(50000)], status="draft",
                             reason="subscription_create")])
    assert not rows and flags["skipped"], (rows, flags)


@case("void and uncollectible invoices are left out and flagged")
def _():
    rows, flags = build([inv("d1", "2026-09-01", [line(25000)], status="uncollectible"),
                         inv("r1", "2026-09-01", [line(50000)], status="void")])
    assert not rows and len(flags["skipped"]) == 2, (rows, flags)


@case("an arrears invoice still in draft on the 2nd business day is used and flagged")
def _():
    rows, flags = build([inv("a1", "2026-10-01", [line(250000, "license")], status="draft")])
    assert rows[0]["amount"] == 2500.0 and flags["draft"], (rows, flags)


@case("Dealer Trade Network: a manual invoice with no product is flagged, not guessed")
def _():
    manual = {"amount": 225000, "pricing": {}, "period": {"start": ts("2026-09-27"), "end": ts("2026-09-27")}}
    rows, flags = build([inv("d1", "2026-09-27", [manual], reason="manual")])
    assert not rows and flags["manual"], (rows, flags)


@case("a customer with no client_type is written with a blank type and flagged")
def _():
    rows, flags = build([inv("u1", "2026-09-05", [line(60000)])])
    assert rows[0]["type"] == "" and flags["untagged"], (rows, flags)


@case("rows sort Direct first, then Reseller, by name, as the existing tabs do")
def _():
    rows, _ = build([inv("r1", "2026-09-01", [line(50000)]), inv("d1", "2026-09-02", [line(25000)])])
    assert [r["type"] for r in rows] == ["Direct", "Reseller"], rows


@case("2nd business day: ordinary month, Jan 1 holiday, Labor Day, July 4 week")
def _():
    got = [R.second_business_day(y, m) for y, m in [(2026, 10), (2027, 1), (2029, 9), (2028, 7), (2027, 5)]]
    want = [dt.date(2026, 10, 2), dt.date(2027, 1, 5), dt.date(2029, 9, 5),
            dt.date(2028, 7, 5), dt.date(2027, 5, 4)]
    assert got == want, got


@case("the 2nd business day always falls on the 2nd to the 5th, the days the Routine fires")
def _():
    for y in range(2026, 2040):
        for m in range(1, 13):
            assert 2 <= R.second_business_day(y, m).day <= 5, (y, m)


def main():
    failed = 0
    for name, fn in CASES:
        try:
            fn()
            print("ok    %s" % name)
        except (AssertionError, KeyError, IndexError) as err:
            failed += 1
            print("FAIL  %s\n        %r" % (name, err))
    print("\n%d failed" % failed if failed else "\nall passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

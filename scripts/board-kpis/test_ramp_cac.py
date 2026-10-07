#!/usr/bin/env python3
"""
Tests the CAC Inputs rules against charges shaped like Ramp's spend rows.

Run: python3 scripts/board-kpis/test_ramp_cac.py
"""

import sys

import ramp_cac as C

CASES = []


def case(name):
    def register(fn):
        CASES.append((name, fn))
        return fn
    return register


def charge(payee, day, amount, memo=None):
    return {"payee": payee, "time": day + "T12:00:00+00:00", "amount": amount, "memo": memo}


@case("Google's true-up on the 1st belongs to the month before")
def _():
    out, _ = C.run([charge("Google Ads", "2026-07-17", 500), charge("Google Ads", "2026-08-01", 209.49)],
                   ["2026-07", "2026-08"])
    assert out["2026-07"][13]["value"] == 709.49, out
    assert out["2026-08"][13]["value"] == 0, out


@case("LinkedIn subscriptions are left out, its ads are kept")
def _():
    rows = [charge("LinkedIn", "2026-07-18", 95.39, "LinkedIn subscription"),
            charge("LinkedIn", "2026-07-07", 127.19),
            charge("LinkedIn", "2026-07-01", 19.91),
            charge("LinkedIn", "2026-07-01", 98.66)]
    out, excluded = C.run(rows, ["2026-06", "2026-07"])
    assert out["2026-06"][15]["value"] == 98.66, out
    assert out["2026-07"][15]["value"] == 0, out
    assert len(excluded) == 3, excluded


@case("Meta and the outbound contractor count when charged")
def _():
    out, _ = C.run([charge("Facebook Ads", "2026-07-01", 900), charge("DirectB2BLeads", "2026-07-06", 2000)],
                   ["2026-06", "2026-07"])
    assert out["2026-07"][16]["value"] == 900 and out["2026-07"][20]["value"] == 2000, out


@case("platform spend replaces Ramp on the ad rows when given, Ramp stays as the gap")
def _():
    out, _ = C.run([charge("Google Ads", "2026-09-15", 500), charge("Google Ads", "2026-10-01", 339.62),
                    charge("Facebook Ads", "2026-09-09", 900)], ["2026-09"])
    C.apply_platform(out, {"2026-09": {"Google Ads": 866.54, "LinkedIn": 1084.61}})
    g, li, fb = out["2026-09"][13], out["2026-09"][15], out["2026-09"][16]
    assert (g["value"], g["ramp"], g["gap"], g["source"]) == (866.54, 839.62, -26.92, "platform"), g
    assert (li["value"], li["gap"]) == (1084.61, -1084.61), li
    assert (fb["value"], fb["source"]) == (900, "ramp fallback"), fb


def main():
    failed = 0
    for name, fn in CASES:
        try:
            fn()
            print("ok    %s" % name)
        except (AssertionError, KeyError) as err:
            failed += 1
            print("FAIL  %s\n        %r" % (name, err))
    print("\n%d failed" % failed if failed else "\nall passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

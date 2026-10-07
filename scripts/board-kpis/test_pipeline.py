#!/usr/bin/env python3
"""
Tests the pipeline roll-forward against hand-built deal snapshots.

Run: python3 scripts/board-kpis/test_pipeline.py
"""

import sys

import pipeline as P

CASES = []


def case(name):
    def register(fn):
        CASES.append((name, fn))
        return fn
    return register


def snap(boundary, deal, amount, created="2026-05-10", closed=False, probability=0.5,
         pipeline=P.OPPORTUNITY, kind="Direct", entered="2026-07-15"):
    return {"boundary": boundary, "deal_id": deal, "name": deal, "created": created, "deleted": False,
            "pipeline": pipeline, "closed": closed, "probability": probability, "stage_entered": entered,
            "amount": amount, "account_type": kind, "current_account_type": kind}


def ties(m, block):
    c, b = m["counts"][block], m["blocks"][block]
    assert c["beginning"] + c["new"] - c["won"] - c["lost"] == c["ending"] + c["left"], c
    assert abs(b["beginning"] + b["created"] + b["increase"] - b["decrease"] - b["won"] - b["lost"]
               - b["ending"]) < 0.01, b


@case("an older deal moved up from Qualification is an Increase and a new opportunity, and closes")
def _():
    rows = [snap("2026-08-01", "a", 1000),
            snap("2026-09-01", "a", 1000),
            snap("2026-09-01", "q", 30000, created="2026-03-01", pipeline=P.EXPANSION, closed=True,
                 probability=1, entered="2026-08-20")]
    m = P.run(rows, "2026-08", "2026-08")[0]
    up = m["blocks"]["Upsell"]
    assert (up["increase"], up["won"], up["created"]) == (30000, 30000, 0), up
    assert m["counts"]["Upsell"]["new"] == 1 and m["counts"]["Upsell"]["won"] == 1, m["counts"]
    ties(m, "Upsell")
    ties(m, "Direct")


@case("a deal that leaves without closing is a Decrease and listed as left")
def _():
    rows = [snap("2026-08-01", "a", 1000), snap("2026-08-01", "b", 500)]
    rows.append(snap("2026-09-01", "a", 1200))
    m = P.run(rows, "2026-08", "2026-08")[0]
    assert m["counts"]["Direct"]["left"] == 1 and m["blocks"]["Direct"]["decrease"] == 500, m
    ties(m, "Direct")


@case("a re-tagged deal leaves one block and joins the other")
def _():
    rows = [snap("2026-08-01", "a", 1000), snap("2026-09-01", "a", 1000, kind="Agency (Reseller)")]
    rows[0]["current_account_type"] = None  # history says Direct, today blank: falls back
    m = P.run(rows, "2026-08", "2026-08")[0]
    assert m["counts"]["Direct"]["beginning"] == 1 and m["counts"]["Direct"]["left"] == 1, m["counts"]
    assert m["counts"]["Reseller"]["new"] == 1, m["counts"]
    assert any(x["note"] == "re-tagged from Direct" for x in m["ledger"]), m["ledger"]
    ties(m, "Direct")
    ties(m, "Reseller")


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

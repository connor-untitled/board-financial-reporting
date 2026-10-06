#!/usr/bin/env python3
"""
Turn HubSpot deal snapshots into the board sheet's pipeline inputs.

The sheet has three pipeline blocks a month, each a roll-forward of open deal
value and a count of opportunities:

    Direct    rows 94-105    Opportunity + Enterprise pipelines, Account Type
                             Single Brand (Direct) or Brand of Brands
    Reseller  rows 151-162   same pipelines, Agency Reseller or Data
                             Integration Partner
    Upsell    rows 198-209   Expansion pipeline, any account type

Input is `.board-kpis/deal_snapshots.json`, the rows of
`sql/deal_snapshots.sql` run in Metabase: each deal's stage, amount and
account type at midnight New York on the 1st of each month, for deals then
open, or closed during the month just ended.

For each month and block, every deal lands in exactly one place:

- open at both ends: the change in its amount is an Increase or Decrease;
- open at the start and closed during the month: Won or Lost at its amount
  when it closed, and any change in amount before closing is an Increase or
  Decrease;
- created during the month: Created at its amount at the end of the month
  (then Won or Lost if it closed);
- created earlier and moved in from Qualification during the month: an
  Increase, as the sheet has always booked it;
- open at the start and in none of the three pipelines at the end (moved back
  to Qualification, or deleted): a Decrease, named in the ledger;
- re-tagged to another block during the month: out of the old block and in to
  the new one as above, named in the ledger.

So Beginning + Created + Increase - Decrease - Won - Lost = Ending, where
Beginning and Ending are the snapshots. The sheet's Beginning is the prior
month's typed Ending, so the first month reports the gap once, like the MRR
rebase.

Account Type is the deal's current one (see block()). Deals with Account
Type "Unqualified" (or none) in the Opportunity or
Enterprise pipeline belong to no block. They are left out and listed, so they
can be tagged in HubSpot. Deleted deals are left out entirely: Fivetran does
not record when a deal was deleted, so its history cannot be placed.

Usage:
    python3 pipeline.py      # .board-kpis/deal_snapshots.json -> pipeline.json, pipeline.md
"""

import collections
import json
import os
import sys

import workspace as w
from mrr import months_between, shift

HERE = os.path.dirname(os.path.abspath(__file__))
SNAPSHOTS = "deal_snapshots.json"
OUT = "pipeline.json"
LEDGER = "pipeline.md"

OPPORTUNITY, ENTERPRISE, EXPANSION = "772338804", "785877425", "99167368"
BLOCKS = ("Direct", "Reseller", "Upsell")
DIRECT_TYPES = {"Direct", "Brand of Brands"}
RESELLER_TYPES = {"Agency (Reseller)", "Agency (Integration)"}
FLOWS = ("created", "increase", "decrease", "won", "lost")


def block(row):
    """The sheet block a deal row belongs to. Account Type is read as it is
    today, not as it was at the boundary: deals are often tagged a week or two
    after they are created, and the sheet has always been built after that
    (July's six new Direct deals were all still Unqualified on July 31)."""
    if row["pipeline"] == EXPANSION:
        return "Upsell"
    kind = row.get("current_account_type", row["account_type"])
    if kind in DIRECT_TYPES:
        return "Direct"
    if kind in RESELLER_TYPES:
        return "Reseller"
    return None


def amount(row):
    return float(row["amount"] or 0)


def outcome(row):
    return "won" if row["probability"] >= 1 else "lost"


def run(snapshots, first, last):
    """Per month from first to last (YYYY-MM): the flows and ledger per block."""
    at = collections.defaultdict(dict)  # boundary 'YYYY-MM' -> deal_id -> row
    for r in snapshots:
        if r["deleted"]:
            continue
        at[r["boundary"][:7]][r["deal_id"]] = r

    out = []
    for month in months_between(first, last):
        start, end = at.get(month, {}), at.get(shift(month, 1), {})
        opened = {d: r for d, r in start.items() if not r["closed"] and block(r)}
        later = {d: r for d, r in end.items() if block(r)}
        untagged = sorted({(r["name"], r["deal_id"]) for r in end.values()
                           if not block(r) and (not r["closed"] or r["stage_entered"][:7] == month)})

        sums = {b: dict({f: 0.0 for f in FLOWS}, beginning=0.0, ending=0.0) for b in BLOCKS}
        counts = {b: {"beginning": 0, "new": 0, "won": 0, "lost": 0, "ending": 0} for b in BLOCKS}
        ledger = []

        def note(b, kind, r, value, why=""):
            sums[b][kind] += value
            ledger.append({"block": b, "flow": kind, "deal": r["name"], "deal_id": r["deal_id"],
                           "amount": round(value, 2), "note": why})

        def move(b, delta, r, why=""):
            if abs(delta) >= 0.005:
                note(b, "increase" if delta > 0 else "decrease", r, abs(delta), why)

        for d in set(opened) | set(later):
            s, e = opened.get(d), later.get(d)
            if s:
                sums[block(s)]["beginning"] += amount(s)
                counts[block(s)]["beginning"] += 1
            if e and not e["closed"]:
                sums[block(e)]["ending"] += amount(e)
                counts[block(e)]["ending"] += 1

            if s and e and block(s) != block(e):
                # Re-tagged: leaves its old block, joins the new one as created.
                move(block(s), -amount(s), s, "re-tagged to %s" % block(e))
                s = None
            if s and not e:
                move(block(s), -amount(s), s, "left the pipeline without closing")
                continue
            if not e:
                continue
            b = block(e)
            if s:
                move(b, amount(e) - amount(s), e, "amount changed" if not e["closed"] else "amount changed before closing")
            elif e["created"][:7] == month:
                note(b, "created", e, amount(e))
                counts[b]["new"] += 1
            else:
                # An older deal moved up from Qualification: the sheet has
                # always counted that as an increase, not a new opportunity.
                move(b, amount(e), e, "entered the pipeline from Qualification")
            if e["closed"]:
                note(b, outcome(e), e, amount(e))
                counts[b][outcome(e)] += 1

        out.append({
            "month": month,
            "blocks": {b: {k: round(v, 2) for k, v in sums[b].items()} for b in BLOCKS},
            "counts": counts,
            "untagged": [{"deal": n, "deal_id": i} for n, i in untagged],
            "ledger": sorted(ledger, key=lambda x: (BLOCKS.index(x["block"]), FLOWS.index(x["flow"]), -x["amount"])),
        })
    return out


def money(v):
    return "${:,.0f}".format(v)


def ledger_markdown(months):
    lines = ["# Board KPI pipeline draft", ""]
    for m in months:
        lines += ["## " + m["month"], "",
                  "| | " + " | ".join(BLOCKS) + " |", "| --- |" + " --- |" * len(BLOCKS)]
        for k in ("beginning",) + FLOWS + ("ending",):
            lines.append("| %s | %s |" % (k.capitalize(), " | ".join(money(m["blocks"][b][k]) for b in BLOCKS)))
        for k in ("beginning", "new", "won", "lost", "ending"):
            lines.append("| %s opportunities | %s |" % (k.capitalize(), " | ".join(str(m["counts"][b][k]) for b in BLOCKS)))
        if m["untagged"]:
            lines += ["", "Left out, Account Type Unqualified or blank: "
                      + ", ".join(u["deal"] for u in m["untagged"])]
        lines += ["", "| Block | Flow | Deal | Amount | Note |", "| --- | --- | --- | --- | --- |"]
        for r in m["ledger"]:
            lines.append("| %s | %s | %s | %s | %s |" % (r["block"], r["flow"], r["deal"], money(r["amount"]), r["note"]))
        lines.append("")
    return "\n".join(lines)


def main():
    config = json.load(open(os.path.join(HERE, "config.json")))
    with open(w.path(SNAPSHOTS)) as f:
        snapshots = json.load(f)
    months = run(snapshots, config.get("pipeline_first_month", config["first_month"]),
                 shift(max(r["boundary"][:7] for r in snapshots), -1))
    with open(w.path(OUT), "w") as f:
        json.dump(months, f, indent=2)
    with open(w.path(LEDGER), "w") as f:
        f.write(ledger_markdown(months))
    for m in months:
        print(m["month"], json.dumps({b: m["blocks"][b] for b in BLOCKS}))


if __name__ == "__main__":
    sys.exit(main())

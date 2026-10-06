#!/usr/bin/env python3
"""
Build a review copy of the KPI workbook with the reported months filled in.

Reads the workbook as exported from Drive (.board-kpis/kpi_export.xlsx, with
its formulas), the Stripe draft (draft.json), the pipeline draft
(pipeline.json) and the MQL inputs (mqls.json), and writes
.board-kpis/kpi_draft.xlsx. That file is uploaded to Drive as a new sheet for
review. The live workbook is never written.

In the copy, for each reported month:

- every row whose July cell is a formula and whose cell for the month is
  empty gets July's formula moved across, so the summary, Reseller and Upsell
  blocks calculate;
- the input cells are filled from Stripe, HubSpot (via Metabase) and
  Metabase question 139;
- cancellations are appended to Churn Inputs, and the churn-age rows are
  worked out from that tab;
- a Sources tab lists every filled cell with where it came from, and the
  cells left for a person, with why.

Usage:
    python3 draft_workbook.py
"""

import datetime as dt
import json
import os
import sys

import openpyxl
from openpyxl.formula.translate import Translator
from openpyxl.styles import Font
from openpyxl.utils import get_column_letter as col_letter

import workspace as w

MAIN = "Revised KPI Sheet Draft - V2"
CHURN = "Churn Inputs"
EXPORT = "kpi_export.xlsx"
OUT = "kpi_draft.xlsx"
TEMPLATE_COL = 38  # AL, July 2026: the last month typed by hand
SHORT_CHURN_DAYS = 90  # "<3 months", which reproduces June (3 Direct) and July (1 Reseller)


def column(month):
    """Sheet column for 'YYYY-MM'. Column B is July 2023."""
    y, m = map(int, month.split("-"))
    return 2 + (y - 2023) * 12 + (m - 7)


def load(name):
    with open(w.path(name)) as f:
        return json.load(f)


class Draft:
    def __init__(self, wb):
        self.wb = wb
        self.ws = wb[MAIN]
        self.sources = []

    def put(self, month, row, value, source, detail=""):
        c = column(month)
        cell = self.ws.cell(row, c)
        cell.value = value
        cell.number_format = self.ws.cell(row, TEMPLATE_COL).number_format
        self.sources.append([month, "%s%d" % (col_letter(c), row), self.ws.cell(row, 1).value,
                             value, source, detail])

    def gap(self, month, row, why):
        c = column(month)
        self.sources.append([month, "%s%d" % (col_letter(c), row), self.ws.cell(row, 1).value,
                             "NEEDS INPUT", why, ""])

    def extend_formulas(self, month):
        """Move July's formula across wherever the month's cell is empty."""
        c = column(month)
        for r in range(6, self.ws.max_row + 1):
            src = self.ws.cell(r, TEMPLATE_COL)
            dst = self.ws.cell(r, c)
            if dst.value is None and isinstance(src.value, str) and src.value.startswith("="):
                dst.value = Translator(src.value, origin=src.coordinate).translate_formula(dst.coordinate)
                dst.number_format = src.number_format


def churn_rows(wb):
    """[(customer type, days, end date, mrr)] already on the Churn Inputs tab."""
    out = []
    for r in wb[CHURN].iter_rows(min_row=2, values_only=True):
        if r[0] and isinstance(r[3], dt.datetime) and isinstance(r[4], dt.datetime):
            out.append((r[1], (r[4] - r[3]).days, r[4], float(r[2] or 0)))
    return out


def append_churn(wb, rows):
    ws = wb[CHURN]
    last = max(i for i, r in enumerate(ws.iter_rows(values_only=True), 1) if r[0])
    added = []
    for i, r in enumerate(rows, last + 1):
        start = dt.datetime.strptime(r["start"], "%Y-%m-%d")
        end = dt.datetime.strptime(r["end"], "%Y-%m-%d")
        for c, v in enumerate([r["client"], r["customer_type"], r["mrr"], start, end, "=E%d-D%d" % (i, i)], 1):
            ws.cell(i, c).value = v
            ws.cell(i, c).number_format = ws.cell(last, c).number_format
        added.append((r["customer_type"], (end - start).days, end, r["mrr"]))
    return added


def fill_stripe(d, m, mrr, history):
    month = m["month"]
    src = "Stripe (scripts/board-kpis/mrr.py)"
    rows = {"Direct": {"new": 82, "expansion": 83, "reactivation": 84, "contraction": 85, "cancellation": 86},
            "Reseller": {"new": 141, "expansion": 142, "contraction": 143, "cancellation": 144}}
    for ch, kinds in rows.items():
        for kind, row in kinds.items():
            who = ", ".join("%s %s" % (x["customer"], x["change"]) for x in m["ledger"]
                            if x["channel"] == ch and x["kind"] == kind)
            d.put(month, row, m["inputs"][ch][kind], src, who)
    if m["inputs"]["Reseller"]["reactivation"]:
        d.gap(month, 141, "Reseller reactivation of %s has no row; add the row before entering it"
              % m["inputs"]["Reseller"]["reactivation"])
    if "rebase_adjustment" in m:
        a = m["rebase_adjustment"]
        d.put(month, 81, m["beginning"]["Direct"], "Stripe roster at July month end (rebase)",
              "Replaces =AL87. The sheet's July ending was off by %s" % a["Direct"])
        d.put(month, 140, m["beginning"]["Reseller"], "Stripe roster at July month end (rebase)",
              "Replaces =AL145. The sheet's July ending was off by %s" % a["Reseller"])

    cust = m["customers"]
    d.put(month, 109, cust["Direct"]["new"], src, "New plus reactivated Direct customers in the MRR ledger")
    d.put(month, 110, cust["Direct"]["churned"], src, "Direct cancellations in the MRR ledger")
    d.put(month, 166, cust["Reseller"]["new"], src, "New plus reactivated Reseller customers in the MRR ledger")
    d.put(month, 167, cust["Reseller"]["churned"], src, "Reseller cancellations in the MRR ledger")
    d.ws.cell(51, column(month)).value = "=%s109+%s166" % ((col_letter(column(month)),) * 2)

    # Churn age, from Churn Inputs as it stands after this month's rows.
    history += append_churn(d.wb, m["churn_rows"])
    letter = col_letter(column(month))
    short = [r for r in m["churn_rows"] if r["days"] is not None and r["days"] < SHORT_CHURN_DAYS]
    for ch, pct_row, usd_row, denom in (("Direct", 132, 133, 111), ("Reseller", 190, 191, 168)):
        mine = [r for r in short if r["customer_type"] == ch]
        d.ws.cell(pct_row, column(month)).value = "=%d/%s%d" % (len(mine), letter, denom)
        d.ws.cell(pct_row, column(month)).number_format = d.ws.cell(pct_row, TEMPLATE_COL).number_format
        d.put(month, usd_row, sum(r["mrr"] for r in mine), "Churn Inputs, days to churn under %d"
              % SHORT_CHURN_DAYS, ", ".join(r["client"] for r in mine))
    d.ws.cell(73, column(month)).value = "=%d/%s53" % (len(short), letter)
    d.ws.cell(73, column(month)).number_format = d.ws.cell(73, TEMPLATE_COL).number_format
    d.ws.cell(74, column(month)).value = "=SUM(%s133+%s191)" % (letter, letter)
    avg = lambda xs: round(sum(xs) / len(xs), 2) if xs else None
    d.put(month, 75, avg([r[1] for r in history]), "Average Days to Churn, every Churn Inputs row", "")
    d.put(month, 134, avg([r[1] for r in history if r[0] == "Direct"]), "Average Days to Churn, Direct rows", "")
    d.put(month, 192, avg([r[1] for r in history if r[0] == "Reseller"]), "Average Days to Churn, Reseller rows",
          "July's 224.84 does not reproduce this way (213.59); check how it was worked out")


def fill_pipeline(d, p):
    month = p["month"]
    src = "HubSpot deal history via Metabase (scripts/board-kpis/pipeline.py)"
    layout = {"Direct": 95, "Reseller": 152, "Upsell": 199}
    for blk, base in layout.items():
        b, c = p["blocks"][blk], p["counts"][blk]
        names = lambda flow: ", ".join("%s %s" % (x["deal"].strip(), x["amount"]) for x in p["ledger"]
                                       if x["block"] == blk and x["flow"] == flow)
        d.put(month, base, b["created"], src, names("created"))
        d.put(month, base + 1, b["increase"], src, names("increase"))
        d.put(month, base + 2, b["decrease"], src, names("decrease"))
        d.put(month, base + 3, b["won"], src, names("won"))
        d.put(month, base + 4, b["lost"], src, names("lost"))
        d.put(month, base + 5, b["ending"], src + ", open deals at month end", "")
        d.put(month, base + 7, c["new"], src, "Deals created in the month")
        d.put(month, base + 8, c["won"], src, "")
        d.put(month, base + 9, c["lost"], src, "")


def fill_mqls(d, month, q):
    d.put(month, 40, q["mqls"], "Metabase question 139", json.dumps(q["by_source"]))
    d.put(month, 42, len(q["conversions"]), "New Stripe customers matched to a Q139 contact by email domain",
          ", ".join(q["conversions"]))


def gaps(d, month):
    for row, why in ((41, "Trial activations come from PostHog, which is not connected to this session"),
                     (46, "New trials come from PostHog, which is not connected to this session"),
                     (171, "Estimated CTAM is a manual estimate"),
                     (172, "Total active reseller clients: Stripe's client-account product only began in August 2026 (5 accounts), so it cannot give this. Likely the Reseller End-Clients tab or consumption data"),
                     (185, "Typed as 0% every month; left as the sheet has it. Should it be a formula like the Direct block's?"),
                     (186, "Typed as 0% every month; left as the sheet has it."),
                     (215, "Needs CAC Inputs for the month (payroll and ad spend). Ramp is not connected"),
                     (216, "Needs CAC Inputs for the month")):
        d.gap(month, row, why)
    if d.ws.cell(185, column(month)).value is None:
        d.ws.cell(185, column(month)).value = 0
        d.ws.cell(186, column(month)).value = 0


OPEN_ITEMS = [
    "July New Customers (AL51) is typed as 8; AL109 + AL166 = 9. Aug/Sep use the formula.",
    "Customer counts chain from the sheet's July ending (Direct 56, Reseller 33). Stripe has 55 and 34 paying at July end, so each channel is one off. Rebase like MRR?",
    "Reseller $ churn rates (rows 185-186) are typed as 0% every month; left as is.",
    "Reseller Running Avg. Days to churn (AL192 = 224.84) does not reproduce from Churn Inputs (213.59).",
    "July MQLs: sheet has 23, Metabase question 139 gives 32 today (23 is the Organic Search count alone).",
    "MQL to customer: July backtests to 2 (My Marketing Department, CLINQ ZERO) against the sheet's 1.",
    "Qualification-pipeline deals fell from about 75 a month to 15 (Aug) and 14 (Sep), and MQLs fell to 13 in August. Worth confirming the inbound deal workflow did not change.",
    "Deals with Account Type Unqualified are left out of pipeline totals; see Pipeline Ledger, 'left out'.",
    "Pipeline: on 2026-07-27 about 1,500 legacy deals were bulk-moved into Opportunity Closed Won/Lost. They are excluded.",
    "Pipeline Created vs Increase: deals created in the month are Created; older deals moving up from Qualification are Increase. July backtest: Created, Won, Lost and Ending tie; the sheet's typed July Increase/Decrease do not roll forward to its own Ending, so those two rows differ.",
    "Stockyard Media Haus, LLC (signed Oct 2) has no client_type in Stripe; it will stop October's run until tagged.",
]


def ledger_tab(wb, title, header, rows):
    ws = wb.create_sheet(title)
    ws.append(header)
    for c in ws[1]:
        c.font = Font(bold=True)
    for r in rows:
        ws.append(r)
    return ws


def trim(wb):
    """Drop the empty formatted rows and columns past the data. The export
    carries about 1,000 of them per tab, which makes the file too large to
    upload through the Drive connector."""
    for ws in wb:
        last_row = max((c.row for row in ws.iter_rows() for c in row if c.value is not None), default=1)
        last_col = max((c.column for row in ws.iter_rows() for c in row if c.value is not None), default=1)
        if ws.max_row > last_row:
            ws.delete_rows(last_row + 1, ws.max_row - last_row)
        if ws.max_column > last_col:
            ws.delete_cols(last_col + 1, ws.max_column - last_col)


def main():
    wb = openpyxl.load_workbook(w.path(EXPORT))
    d = Draft(wb)
    stripe, pipeline, mqls = load("draft.json"), load("pipeline.json"), load("mqls.json")["months"]
    history = churn_rows(wb)
    pipe = {p["month"]: p for p in pipeline}
    for m in stripe["months"]:
        month = m["month"]
        d.extend_formulas(month)
        fill_stripe(d, m, stripe, history)
        if month in pipe:
            fill_pipeline(d, pipe[month])
        if month in mqls:
            fill_mqls(d, month, mqls[month])
        gaps(d, month)

    ws = ledger_tab(wb, "Sources", ["Month", "Cell", "Metric", "Value", "Source", "Detail"], d.sources)
    ws.append([])
    ws.append(["Open items"])
    ws.cell(ws.max_row, 1).font = Font(bold=True)
    for item in OPEN_ITEMS:
        ws.append(["", "", item])
    ws.column_dimensions["C"].width = 40
    ws.column_dimensions["E"].width = 50
    ws.column_dimensions["F"].width = 90
    ledger_tab(wb, "MRR Ledger", ["Month", "Channel", "Movement", "Customer", "Before", "After", "Note"],
               [[m["month"], r["channel"], r["kind"], r["customer"], r["before"], r["after"],
                 "arrears" if r["arrears"] else ("invoice not out yet, current subscription" if r["carried_forward"] else "")]
                for m in stripe["months"] for r in m["ledger"]])
    ledger_tab(wb, "Pipeline Ledger", ["Month", "Block", "Flow", "Deal", "HubSpot deal id", "Amount", "Note"],
               [[p["month"], r["block"], r["flow"], r["deal"].strip(), str(r["deal_id"]), r["amount"], r["note"]]
                for p in pipeline for r in p["ledger"]]
               + [[p["month"], "none", "left out", u["deal"].strip(), str(u["deal_id"]), None,
                   "Account Type Unqualified or blank: tag in HubSpot"] for p in pipeline for u in p["untagged"]])
    trim(wb)
    wb.save(w.path(OUT))
    print(w.path(OUT), len(d.sources), "cells documented")


if __name__ == "__main__":
    sys.exit(main())

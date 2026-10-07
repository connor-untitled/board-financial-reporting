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
- the input cells are filled from Stripe, HubSpot (via Metabase),
  Metabase question 139 and Ramp (CAC Inputs, from cac.json);
- cancellations are appended to Churn Inputs, and the churn-age rows are
  worked out from that tab;
- the TTM rows and Running Cost per Conversion (row 44) get corrected
  windows; July and earlier keep their formulas as published;
- a Sources tab lists every filled cell with where it came from, and the
  cells left for a person, with why;
- a Board Notes tab lists every calculation change and rebase, with July as
  published beside July under the new method.

Usage:
    python3 draft_workbook.py
"""

import datetime as dt
import json
import os
import re
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
    if "customer_rebase_adjustment" in m:
        a = m["customer_rebase_adjustment"]
        d.put(month, 108, cust["Direct"]["beginning"], "Stripe paying customers at July month end (rebase)",
              "Replaces =AL111. The sheet's July ending was off by %+d" % a["Direct"])
        d.put(month, 165, cust["Reseller"]["beginning"], "Stripe paying customers at July month end (rebase)",
              "Replaces =AL168. The sheet's July ending was off by %+d" % a["Reseller"])
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
    d.put(month, 192, avg([r[1] for r in history if r[0] in ("Reseller", "Agency")]),
          "Average Days to Churn, Reseller rows (older rows are typed 'Agency')", "")


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
                     (172, "Total active reseller clients: Stripe's client-account product only began in August 2026 (5 accounts), so it cannot give this. Likely the Reseller End-Clients tab or consumption data")):
        d.gap(month, row, why)
    # Reseller $ churn rates, built like the Direct block's rows 127-128
    # (typed as 0% on the sheet before August 2026).
    x = col_letter(column(month))
    for row, formula, label in ((185, "=(%s143+%s144)/%s145" % (x, x, x), "same as Direct row 127: (Contraction + Cancellation) / Ending MRR"),
                                (186, "=%s184/%s145" % (x, x), "same as Direct row 128: Net Monthly Churn / Ending MRR")):
        cell = d.ws.cell(row, column(month))
        cell.value = formula
        cell.number_format = d.ws.cell(127 if row == 185 else 128, TEMPLATE_COL).number_format
        d.sources.append([month, "%s%d" % (x, row), d.ws.cell(row, 1).value, formula, "Formula, " + label,
                          "Row 184 nets out Expansion, where Direct row 126 nets out New MRR" if row == 186 else ""])


# TTM rows. July's formulas span Z:AL, 13 months; new months use 12.
TTM_ROWS = (62, 64, 65, 70, 71, 113, 121, 123, 124, 129, 130, 170, 179, 181, 182, 187, 188, 217, 221)
TTM_FORMULA = re.compile(r"^=(SUM|AVERAGE)\(Z(\d+):AL\2\)$")
MAIN_REF = "'%s'!" % MAIN


def ttm(fn, row, last):
    """=FN over the 12 columns ending at column number last."""
    return "=%s(%s%d:%s%d)" % (fn, col_letter(last - 11), row, col_letter(last), row)


def running_cost(col, prefix=""):
    x = col_letter(col)
    return "=(SUM('CAC Inputs'!$B$18:%s18))/SUM(%s$B$42:%s42)" % (x, prefix, x)


def fix_formulas(d, month):
    """Correct the TTM windows and row 44 for the month; earlier columns stay as published."""
    c, x = column(month), col_letter(column(month))
    for row in TTM_ROWS:
        fn, src = TTM_FORMULA.match(d.ws.cell(row, TEMPLATE_COL).value).groups()
        d.ws.cell(row, c).value = ttm(fn, int(src), c)
        d.sources.append([month, "%s%d" % (x, row), d.ws.cell(row, 1).value, d.ws.cell(row, c).value,
                          "Formula, corrected window", "12 months; July's formula spans 13 (Z:AL)"])
    d.ws.cell(44, c).value = running_cost(c)
    d.sources.append([month, "%s44" % x, d.ws.cell(44, 1).value, d.ws.cell(44, c).value,
                      "Formula, corrected window",
                      "Spend through this month; July's formula sums CAC Inputs eight columns ahead (to AT)"])


def board_notes(ws):
    """[item, type, what changed, effective, July as published, July under the new method]."""
    al = TEMPLATE_COL
    label = lambda row: "Row %d %s" % (row, (ws.cell(row, 1).value or "").strip())
    rows = []
    for row in TTM_ROWS:
        fn, src = TTM_FORMULA.match(ws.cell(row, al).value).groups()
        rows.append([label(row), "Calculation change",
                     "TTM window is 12 months; the published formula spans 13 (Z:AL)", "August 2026",
                     "=%sAL%d" % (MAIN_REF, row), ttm(fn, int(src), al).replace("(", "(" + MAIN_REF, 1)])
    rows.append([label(44), "Calculation change",
                 "Ad spend summed through the month itself; the published formula sums CAC Inputs eight months ahead",
                 "August 2026", "=%sAL44" % MAIN_REF,
                 running_cost(al, MAIN_REF)])
    for item, row_july, row_aug in (("Direct Beginning MRR (row 81)", 87, 81), ("Reseller Beginning MRR (row 140)", 145, 140),
                                    ("Direct Beginning Customers (row 108)", 111, 108),
                                    ("Reseller Beginning Customers (row 165)", 168, 165)):
        rows.append([item, "Rebase", "August starts from the Stripe roster at July month end, not the sheet's July ending; the gap is booked once",
                     "August 2026", "=%sAL%d" % (MAIN_REF, row_july), "=%sAM%d" % (MAIN_REF, row_aug)])
    rows.append([label(185), "Calculation change", "Was typed 0% from January 2026; now (Contraction + Cancellation) / Ending MRR, as Direct row 127",
                 "August 2026", "=%sAL185" % MAIN_REF, "=(%sAL143+%sAL144)/%sAL145" % ((MAIN_REF,) * 3)])
    rows.append([label(186), "Calculation change", "Was typed 0% from January 2026; now Net Monthly Churn / Ending MRR, as Direct row 128",
                 "August 2026", "=%sAL186" % MAIN_REF, "=%sAL184/%sAL145" % ((MAIN_REF,) * 2)])
    rows.append([label(51), "Calculation change", "Was typed; now New Direct + New Reseller customers (rows 109 + 166)",
                 "August 2026", "=%sAL51" % MAIN_REF, "=%sAL109+%sAL166" % ((MAIN_REF,) * 2)])
    rows.append(["CAC Inputs, ad lines (rows 13, 15, 16)", "Source change",
                 "Platform-reported spend (HubSpot ad integration), as before; Ramp card charges now kept beside it as the reconciliation (CAC Variance tab)",
                 "August 2026", None, None])
    return rows


CAC = "CAC Inputs"
CAC_SOURCES = {
    13: "Ramp, Google Ads charges; a charge on the 1st counts in the month before",
    14: "Ramp, Reddit charges (none since March)",
    15: "Ramp, LinkedIn ad charges; a charge on the 1st counts in the month before; subscriptions left out",
    16: "Ramp, Facebook Ads charges as they fall (billed on a spend threshold, so they trail spend)",
    20: "Ramp, DirectB2BLeads (GL 7013); engagement ended in July",
}


def fill_cac(d, month, cac):
    """Fill the CAC Inputs column for the month and move July's totals across."""
    ws = d.wb[CAC]
    c = column(month)
    for r in range(1, ws.max_row + 1):
        src = ws.cell(r, TEMPLATE_COL)
        if isinstance(src.value, str) and src.value.startswith("="):
            ws.cell(r, c).value = Translator(src.value, origin=src.coordinate).translate_formula(
                ws.cell(r, c).coordinate)
            ws.cell(r, c).number_format = src.number_format
    name = dt.datetime.strptime(month, "%Y-%m").strftime("%B")
    for r in (4, 12):
        ws.cell(r, c).value = name

    def put(row, value, source, detail=""):
        ws.cell(row, c).value = value
        ws.cell(row, c).number_format = ws.cell(row, TEMPLATE_COL).number_format
        d.sources.append([month, "'%s'!%s%d" % (CAC, col_letter(c), row), ws.cell(row, 1).value.strip(),
                          value, source, detail])

    for row, value in cac["carry_forward"].items():
        put(int(row), value, "Carried forward from July (payroll is not in Ramp)", "Edit config.json cac.carry_forward when pay or headcount changes")
    d.sources.append([month, "'%s'!%s6" % (CAC, col_letter(c)), "Sales Commissions", "left blank",
                      "Excluded from CAC, as confirmed (blank since January 2024)", ""])
    for row, cell in cac["months"][month].items():
        if cell.get("source") == "platform":
            put(int(row), cell["value"], "HubSpot ad integration (platform-reported spend)",
                "Ramp charged %s (gap %s): %s" % (cell["ramp"], cell["gap"], ", ".join(cell["charges"]) or "no charges"))
        elif cell.get("source") == "ramp fallback":
            put(int(row), cell["value"], "Ramp fallback, platform figure missing: " + CAC_SOURCES[int(row)],
                ", ".join(cell["charges"]))
        else:
            put(int(row), cell["value"], CAC_SOURCES[int(row)], ", ".join(cell["charges"]))
    for row, label in cac["zero_rows"].items():
        put(int(row), 0, "Nothing in Ramp for %s" % label, "")


# Platform-reported spend (the sheet's basis) against Ramp charges. May to
# July compare Ramp with the typed sheet; later months come from cac.json.
CAC_HISTORY = [
    ["2026-05", "Google Ads", 4941.62, 5017.64],
    ["2026-06", "Google Ads", 4599.55, 4570.51],
    ["2026-07", "Google Ads", 3224.18, 3209.49],
    ["2026-05", "LinkedIn Ads", 427.99, 425.13],
    ["2026-06", "LinkedIn Ads", 98.66, 98.66],
    ["2026-07", "LinkedIn Ads", 0, 0],
    ["2026-06", "Meta Ads", 1001.60, 701.63],
    ["2026-07", "Meta Ads", 965.50, 1006.03],
]
CAC_NOTES = [
    "Why they differ. Google bills in $500 steps and settles the rest on the 1st, so a little late-month spend is charged the month after.",
    "LinkedIn bills ads on the 1st or later, so a charge can land the month after the spend.",
    "Meta bills when spend crosses a threshold, so charges trail spend by a few weeks (August's card charges ran $229 under spend and September's $343 over).",
]
CAC_LINES = {13: "Google Ads", 15: "LinkedIn Ads", 16: "Meta Ads"}


def cac_variance_rows(cac):
    rows = [[m, line, plat, ramp, round(ramp - plat, 2), "typed sheet"] for m, line, plat, ramp in CAC_HISTORY]
    for month, cells in cac["months"].items():
        for row, line in CAC_LINES.items():
            cell = cells[str(row)] if str(row) in cells else cells[row]
            if cell.get("source") == "platform":
                rows.append([month, line, cell["platform"], cell["ramp"], cell["gap"], "HubSpot ad integration"])
            else:
                rows.append([month, line, None, cell.get("ramp", cell["value"]), None, "platform figure missing"])
    return rows + [[]] + [[n] for n in CAC_NOTES]


RECON_NOTES = [
    "Gap = Stripe (current method) minus the sheet's ending MRR. August 2026 rebases both channels to Stripe, so the July gap is booked once.",
    "Through April 2024 the sheet carried up to ~$18k more Direct MRR than Stripe while customers moved onto Stripe; by May 2024 the two agreed within $250.",
    "Direct, July 2026 -$1,550: since May 2024 the sheet typed $1,250 less Direct churn than its own Churn Inputs list (June 2024 -$2,250, mostly Lascana $2,000; July 2025 -$750). The other ~$300 is month-to-month timing.",
    "Reseller, July 2026 +$1,050: Stripe has run $1,050 to $5,800 above the sheet since October 2024, mostly reseller expansions and client-account changes the sheet did not book.",
]


OPEN_ITEMS = [
    "July New Customers (AL51) is typed as 8; AL109 + AL166 = 9. Aug/Sep use the formula.",
    "Customer counts rebase to Stripe in August, like MRR: Direct starts at 55 (sheet had 56) and Reseller at 34 (sheet had 33).",
    "Reseller $ churn rates (rows 185-186) now use the Direct block's formulas from August 2026; earlier months are still typed 0%, so the TTM averages (rows 187-188) understate until a year of real values builds up.",
    "Held for 2026 year-end review: Direct Net Monthly Churn (row 126) subtracts New MRR, where Reseller (row 184) subtracts Expansion, the standard definition. Summary row 67 mixes the two.",
    "Held for 2026 year-end review: churn and growth rates (rows 61, 68, 112, 120, 127, 128, 169, 178, 185, 186) divide by the ending value, not the beginning one; this feeds LTV:CAC (row 219).",
    "Held for 2026 year-end review: values typed where formulas belong: services revenue 9600 inside rows 13/14, typed numerators in rows 73/132/190, typed rows 94/151 (AA to AC) and ending pipeline rows 100/157/204.",
    "Held for 2026 year-end review: Reactivation (row 9) is Direct only, and Avg MRR per New Customer (row 57) divides by a count that includes reactivations.",
    "Held for 2026 year-end review: TTM rows before August 2026 span 13 months and row 44 before August reads CAC Inputs ahead; history is left as published (see Board Notes).",
    "July MQLs: sheet has 23, Metabase question 139 gives 32 today (23 is the Organic Search count alone).",
    "MQL to customer: July backtests to 2 (My Marketing Department, CLINQ ZERO) against the sheet's 1.",
    "Qualification-pipeline deals fell from about 75 a month to 15 (Aug) and 14 (Sep), and MQLs fell to 13 in August. Worth confirming the inbound deal workflow did not change.",
    "Deals with Account Type Unqualified are left out of pipeline totals; see Pipeline Ledger, 'left out'.",
    "Pipeline: on 2026-07-27 about 1,500 legacy deals were bulk-moved into Opportunity Closed Won/Lost. They are excluded.",
    "Pipeline Created vs Increase: deals created in the month are Created; older deals moving up from Qualification are Increase. July backtest: Created, Won, Lost and Ending tie; the sheet's typed July Increase/Decrease do not roll forward to its own Ending, so those two rows differ.",
    "CAC: salaries are July's carried forward (Marketing 8,333.33, CSM 6,666.67, Sales 0). Any change since July needs config.json cac.carry_forward.",
    "CAC: ad lines use platform-reported spend (HubSpot's ad integration), as the sheet always has; Ramp charges are in the CAC Variance tab. Months marked 'platform figure missing' there fall back to Ramp until the figure is supplied.",
    "CAC: LinkedIn subscriptions left out of LinkedIn Ads: $95.39 'LinkedIn subscription' (card 8731), $127.19 on the 7th, and ~$20 on the 1st. See the CAC Variance tab for how Ramp compares to the typed months.",
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
    cac = load("cac.json")
    history = churn_rows(wb)
    pipe = {p["month"]: p for p in pipeline}
    for m in stripe["months"]:
        month = m["month"]
        d.extend_formulas(month)
        fix_formulas(d, month)
        fill_stripe(d, m, stripe, history)
        if month in pipe:
            fill_pipeline(d, pipe[month])
        if month in mqls:
            fill_mqls(d, month, mqls[month])
        if month in cac["months"]:
            fill_cac(d, month, cac)
        gaps(d, month)

    ws = ledger_tab(wb, "Board Notes", ["Item", "Type", "What changed", "Effective",
                                        "July 2026 as published", "July 2026 under the new method"], board_notes(d.ws))
    for col, width in (("A", 48), ("B", 18), ("C", 90), ("D", 14), ("E", 22), ("F", 28)):
        ws.column_dimensions[col].width = width
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
    ws = ledger_tab(wb, "CAC Variance", ["Month", "Line", "Platform-reported", "Ramp charged",
                                         "Ramp minus platform", "Platform source"], cac_variance_rows(cac))
    ws.column_dimensions["A"].width = 14
    ws.column_dimensions["B"].width = 22
    try:
        recon = load("ending_recon.json")["rows"]
    except FileNotFoundError:
        recon = []
    if recon:
        ws = ledger_tab(wb, "Ending MRR Recon", ["Month", "Direct Stripe", "Direct sheet", "Direct gap",
                                                 "Reseller Stripe", "Reseller sheet", "Reseller gap", "Total gap"],
                        recon + [[]] + [[n] for n in RECON_NOTES])
        ws.column_dimensions["A"].width = 10
    ledger_tab(wb, "CAC Excluded", ["Date", "Payee", "Amount", "Memo", "Card"],
               [[e["time"][:10], e["payee"], e["amount"], e.get("memo") or "", e.get("card") or ""]
                for e in cac["excluded"]])
    trim(wb)
    wb.save(w.path(OUT))
    print(w.path(OUT), len(d.sources), "cells documented")


if __name__ == "__main__":
    sys.exit(main())

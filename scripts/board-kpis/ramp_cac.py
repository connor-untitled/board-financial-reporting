#!/usr/bin/env python3
"""
Work out the CAC Inputs tab's paid-media and contractor lines from Ramp.

Input is `.board-kpis/ramp_spend.json`: one row per Ramp charge for the
payees in config.json `cac.ramp_payees`, from the `spend` reporting dataset
(payee, spend_time, spend_amount, memo, card_last_four, accounting_category),
covering the reported months and the first week after them.

The rules, each checked against the typed sheet for May to July 2026:

- A charge made on the 1st counts in the month before. Google Ads bills in
  $500 steps and settles the rest of the month on the 1st; LinkedIn bills
  its ads on the 1st. With this rule Google lands within $30 of the sheet in
  June and July, and LinkedIn ads match exactly.
- LinkedIn also carries subscriptions that are not paid media: the $95.39
  "LinkedIn subscription", a fixed $127.19 seat billed on the 7th, and a ~$20
  charge on the 1st. They are left out and listed.
- Meta bills when spend crosses a threshold, so its charges trail spend by a
  few weeks. Charges are used as they fall (June read $300 under the sheet,
  July $41 over).

Salaries carry forward from config.json `cac.carry_forward`, because payroll
is not in Ramp. Sales commissions stay blank, as the sheet has had them
since January 2024.

Usage:
    python3 ramp_cac.py      # .board-kpis/ramp_spend.json -> cac.json
"""

import json
import os
import sys

import workspace as w
from mrr import months_between, shift

HERE = os.path.dirname(os.path.abspath(__file__))
SPEND = "ramp_spend.json"
OUT = "cac.json"

# CAC Inputs rows filled from Ramp, by payee.
RAMP_ROWS = {"Google Ads": 13, "Reddit": 14, "LinkedIn": 15, "Facebook Ads": 16, "DirectB2BLeads": 20}
ZERO_ROWS = {17: "Beeswax/DSP", 19: "PR Contractor", 21: "Marketing Contractor"}
BILLED_ON_FIRST = {"Google Ads", "LinkedIn"}


def linkedin_subscription(charge):
    amount = float(charge["amount"])
    memo = (charge.get("memo") or "").lower()
    day = int(charge["time"][8:10])
    return ("subscription" in memo or abs(amount - 95.39) < 0.005
            or (abs(amount - 127.19) < 0.005 and day == 7)
            or (day == 1 and amount <= 20.0))


def month_of(charge):
    month = charge["time"][:7]
    if charge["payee"] in BILLED_ON_FIRST and charge["time"][8:10] == "01":
        month = shift(month, -1)
    return month


def run(charges, months):
    """{month: {row: {"value", "charges"}}} plus the charges left out."""
    out = {m: {row: {"value": 0.0, "charges": []} for row in RAMP_ROWS.values()} for m in months}
    excluded = []
    for c in charges:
        if c["payee"] not in RAMP_ROWS:
            continue
        if c["payee"] == "LinkedIn" and linkedin_subscription(c):
            excluded.append(c)
            continue
        m = month_of(c)
        if m not in out:
            continue
        cell = out[m][RAMP_ROWS[c["payee"]]]
        cell["value"] = round(cell["value"] + float(c["amount"]), 2)
        cell["charges"].append("%s %s" % (c["time"][:10], c["amount"]))
    return out, excluded


def main():
    config = json.load(open(os.path.join(HERE, "config.json")))
    with open(w.path(SPEND)) as f:
        charges = json.load(f)
    last = shift(max(c["time"][:7] for c in charges), -1)
    months = months_between(config["cac"].get("first_month", config["first_month"]), last)
    values, excluded = run(charges, months)
    result = {"months": values,
              "carry_forward": config["cac"]["carry_forward"],
              "zero_rows": ZERO_ROWS,
              "excluded": excluded}
    with open(w.path(OUT), "w") as f:
        json.dump(result, f, indent=2)
    for m in months:
        print(m, {row: v["value"] for row, v in values[m].items()})


if __name__ == "__main__":
    sys.exit(main())

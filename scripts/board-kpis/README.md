# board-kpis

Computes the MRR movement inputs for the monthly board KPI sheet
("Untitled Monthly KPIs", tab *Revised KPI Sheet Draft - V2*) from Stripe, so
nobody types them by hand.

Phase 1 covers the ten movement cells per month:

| Sheet rows | Channel | Inputs |
| --- | --- | --- |
| 82-86 | Direct | New, Expansion, Reactivation, Contraction, Cancellation |
| 141-144 | Reseller | New, Expansion, Contraction, Cancellation (Reactivation once its row exists) |

The sheet's own formulas take it from there. The run also reports the Direct
services MRR that rows 13-14 currently hard-code as `9600`.

| File | Does |
| --- | --- |
| `workspace.py` | The one directory a run reads and writes (`.board-kpis/`, gitignored) and the fixed names in it |
| `config.json` | Arrears resellers, excluded and services products, the first reported month, the rebase |
| `stripe_pull.py` | Saves invoices, subscriptions, customers and products from Stripe to the workspace |
| `mrr.py` | Pure logic: per-customer monthly MRR, the movements, and the draft (`draft.json`, `ledger.md`) |
| `test_mrr.py` | One case per rule, each named after the account that showed it |
| `sql/deal_snapshots.sql` | Month-boundary snapshots of HubSpot deals, run in Metabase |
| `pipeline.py` | Pipeline roll-forward per block (Direct, Reseller, Upsell) from those snapshots |
| `test_pipeline.py` | The roll-forward rules, one case each |
| `ramp_cac.py` | CAC Inputs paid-media and contractor lines from Ramp charges |
| `test_ramp_cac.py` | The CAC rules, one case each |
| `write_sheet.py` | Writes the reviewed months into the live sheet: dry run by default, `BOARD_KPIS_WRITE=1` to write |
| `draft_workbook.py` | A review copy of the workbook with the reported months filled, plus Sources and ledger tabs |

```bash
python3 scripts/board-kpis/stripe_pull.py   # -> .board-kpis/*.json
python3 scripts/board-kpis/mrr.py           # -> .board-kpis/draft.json, ledger.md
python3 scripts/board-kpis/test_mrr.py      # no network, no credentials
python3 scripts/board-kpis/test_pipeline.py
python3 scripts/board-kpis/test_ramp_cac.py
```

Both commands are argument-free, because an allow rule can only name a
constant command. `mrr.py` reports every month from
`first_month` up to the month before today. `BOARD_KPIS_RUN_MONTH=YYYY-MM`
overrides "today" for a backtest.

## Where the numbers come from

**Invoices, not subscriptions.** An invoice records what was charged for a
period, while a subscription only says what it is now. Each subscription
invoice line counts toward the month its period starts in. Proration lines
are skipped, discounts are netted off, annual lines are spread over twelve
months, and void invoices are ignored. A subscription item counts once a
month, at its larger amount, because Stripe sometimes keeps a draft and a
paid invoice for the same period.

**Channel is Stripe's `client_type` customer metadata, and only that.** A
customer with MRR in a reported month and no `client_type` stops the run with
exit code 2, and the run lists them by name. Tag them in Stripe and run again.
HubSpot's Account Type disagrees for a few accounts (Ozonics Hunting,
Web-Tech Services), and Stripe wins by decision.

**Cancellations land in the month the subscription ends.** That is the rule
the sheet's Churn Inputs tab has always followed. A subscription's lines
never count in or after the month it ended, which also discards the stray
drafts Stripe sometimes leaves behind after a cancellation (KP Staffing).

**A prorated first month counts at the full rate.** A reseller who starts
mid-month on a plan billed from the 1st gets a prorated first invoice. That
month is credited with the subscription's first full monthly amount, so New
MRR lands in the month the customer actually started.

**Client accounts count in the month they were active.** MRR here is the
run-rate in force at month end, whenever it gets billed. Client accounts are
billed in arrears for every reseller, so a client-account line on a renewal
invoice (dated the 1st) is shifted back to the month before. An account
added mid-month lands on the next bill, so it is shifted into the month it
was added. The first invoice, issued at signing, bills its accounts up front
for the period it opens and is not shifted (EvolveMKD). DriveLocal's seven
accounts, first billed October 1, therefore count in September. This is
deliberately different from Rev Rec, which recognises the accounts in the
month they are billed.

**Upsells count when they are first billed at the new rate.** PlexusDx,
HTMarket and NASPO's annual conversion were signed in September but first
billed on October 1, so they are October expansion. The FY26 Wins tab
remains the record of when deals were signed.

## Arrears resellers

Most licenses are billed in period, and consumption and client accounts are
billed in arrears. Twelve resellers have their license billed in arrears too,
so their invoice dated the 1st pays for the month before. They are listed by
Stripe customer id under `arrears_customers` in `config.json`, taken from the
Recognition Basis column of the *Subscription Rev Rec* workbook. Their lines
are shifted back a month. With the shift, the July 2026 roster ties to Rev
Rec customer for customer.

Two knock-on rules:

- **The newest month may not have its invoice yet.** An arrears customer's
  September MRR comes from an invoice dated October 1, and so do every
  reseller's September client accounts. If that invoice doesn't exist when
  the run happens and the subscription is still live, the customer counts
  at its current subscription (for client accounts, item by item) and is
  listed in the ledger as carried forward. Without this, Ez As Pie read as a
  false September cancellation, and EvolveMKD, Minuto and REA Media would
  have read as false contractions.
- **A cancelled arrears customer leaves after its last invoice.** NeuroGraph's
  final license invoice was July 1, which covers June, so it churns in July.
  That matches Rev Rec without a special case.

When a reseller moves onto or off arrears billing, edit `arrears_customers`.

## The rebase

The sheet's running balance had drifted from Stripe: at the end of July 2026,
Direct was $1,550 too high and Reseller about $1,050 too low. No single
account caused it. It came from hand-entered movements over time, and both
Stripe and the Rev Rec workbook agree on the customer roster. So August 2026
starts from the Stripe roster, and the draft reports the difference once as
`rebase_adjustment`. Customer counts rebase the same way: August's
Beginning # of Direct customers and Resellers (rows 108 and 165) are Stripe's
paying customers at July month end, and the gap to the sheet (Direct 56 vs
55, Reseller 33 vs 34) is reported as `customer_rebase_adjustment`.
`config.json` holds the sheet's July endings that both are measured against. After August, `rebase` has no effect.

## Backtest

Run against February to July 2026, the code matches most typed-in cells. The
months that differ trace to the sheet. For example, March's Direct
cancellations in the sheet don't agree with the sheet's own Churn Inputs tab,
and a Bedzzz expansion was never entered. Treat a difference on a month from
before automation as a question about the sheet first.

## Pipeline (rows 95-104, 152-161, 199-208)

HubSpot's API has no history, so the pipeline comes from the Fivetran sync
in Metabase (database "Untitled Internal"): `hubspot.deal_stage` for stage
changes and `hubspot.deal_property_history` for amount. Run
`sql/deal_snapshots.sql` with the first and last month boundary filled in,
save the rows as a JSON list to `.board-kpis/deal_snapshots.json`, then
`python3 scripts/board-kpis/pipeline.py`.

- Direct is the Opportunity and Enterprise pipelines with Account Type
  Single Brand or Brand of Brands; Reseller is the same pipelines with Agency
  Reseller or Data Integration Partner; Upsell is the Expansion pipeline.
- Account Type and pipeline are read as they are today, which is how
  HubSpot's historical snapshot report filters. Deals get tagged a week or
  two after they are created, and July only ties this way. A deal moved to
  another pipeline after month end counts in its new block (UDS | Boa Safra
  | DSP moved to Expansion on October 5, so September Reseller is 173,150
  and Upsell 78,160, matching the HubSpot report). Stage, amount and
  open/closed are still as at month end. Once a month is finalized it is
  not rerun, so later moves do not change it.
- Deals created in the month are Created. Older deals moving up from
  Qualification are an Increase.
- Ending is the open deals at month end, and the flows tie to it by
  construction.
- Opportunity counts tie the same way: New Opportunities is every deal that
  joined the block (created, moved up from Qualification, or re-tagged in).
  A deal that leaves without closing is flagged on the Sources tab, since
  the sheet has no row for it.
- August 2026 rebases Beginning Opportunities to the open deals at July
  month end (Direct 16, Reseller 18, Upsell 8; the sheet's formulas carried
  21, 29 and 17). Beginning Pipeline Value is rebased only if the typed July
  Ending differs from the snapshot; in July all three tie.
- The 2026-07-27 bulk move of about 1,500 legacy deals into Opportunity
  Closed Won/Lost is excluded in the SQL.

Backtested on July 2026: Ending ties in all three blocks, and Created
(count and value), Won and Lost tie for Direct. The sheet's typed
Increase/Decrease never rolled forward to its own Ending, so those two rows
differ.

## MQLs (rows 40, 42)

Row 40 is Metabase question 139: contacts created in the month from Organic
Search, Paid Search, Email Marketing, Paid Social, Social Media or AI
Referrals, excluding gmail.com. Row 42 counts the month's new Stripe
customers whose email domain matches a contact in that population. Both go
in `.board-kpis/mqls.json`.

## CAC Inputs

Ramp's `spend` reporting dataset gives every charge for the payees in
`config.json` `cac.ramp_payees`. Save them, through the first week of the
next month, to `.board-kpis/ramp_spend.json` (payee, time, amount, memo,
card, gl) and run `python3 scripts/board-kpis/ramp_cac.py`.

- Google Ads, LinkedIn and Meta use platform-reported spend, which is what
  the sheet has always carried (Google's own May figure ties to the cent).
  Put HubSpot's ad-integration figures in `.board-kpis/ad_spend.json` as
  `{"YYYY-MM": {"Google Ads": x, "LinkedIn": y, "Facebook Ads": z}}`. Ramp
  charges are kept beside them in the CAC Variance tab, and a month with no
  platform figure falls back to Ramp and says so. Automating this needs the
  Google Ads Fivetran sync (`google_ads_ft` in Metabase, stopped 2026-07-02)
  restarted and LinkedIn and Meta connectors added.
- Card charges trail platform spend. Google bills in $500 steps and settles
  the rest on the 1st; LinkedIn bills on the 1st or later; Meta bills on a
  spend threshold. For the reconciliation a Google or LinkedIn charge on the
  1st counts in the month before.
- LinkedIn subscriptions ($95.39 "LinkedIn subscription", $127.19 on the 7th,
  ~$20 on the 1st) are left out of LinkedIn Ads and listed.
- The outbound contractor is DirectB2BLeads (ended July 2026). Reddit, DSP, PR and marketing
  contractors have no Ramp charges.
- Salaries are not in Ramp, and QuickBooks has no ledger published to Ramp,
  so they carry forward from `cac.carry_forward`. Edit it when pay or
  headcount changes. Sales commissions are excluded from CAC, by decision.
  Prospect Desk charges are DSP pass-through and are excluded.

## The review workbook

Export the live workbook from Drive as .xlsx to `.board-kpis/kpi_export.xlsx`
and run `python3 scripts/board-kpis/draft_workbook.py`. It writes
`kpi_draft.xlsx` with July's formulas moved across to the new months, the
inputs filled, cancellations appended to Churn Inputs, and a Sources tab
naming where every filled cell came from and which cells still need a
person (CTAM, reseller end clients, CAC inputs). Trial rows (41, 46, 47)
are no longer reported: free trials ended with a go-to-market change, and
the Notes column says so.

From August 2026 the new months also get two corrected formulas:

- TTM rows (62, 64, 65, 70, 71, 113, 121, 123, 124, 129, 130, 170, 179,
  181, 182, 187, 188, 217, 221) cover 12 months. July's published formulas
  span 13 (`Z:AL`).
- Running Cost per Conversion (row 44) sums CAC Inputs through the month
  itself. July's published formula sums eight months ahead (to `AT`), so it
  picks up later spend as soon as it is entered.

## Writing to the live sheet

Once the review workbook is signed off, `python3 scripts/board-kpis/write_sheet.py`
plans the write and saves it to `.board-kpis/sheet_plan.md`; nothing is sent.
Review the plan, then run it again with `BOARD_KPIS_WRITE=1`. It needs
`WINS_SA_KEY`, and the workbook shared with the service account as an Editor.

- Written: the reported months' columns on the main tab and CAC Inputs
  (formulas stay formulas, July's formatting is copied across), the new
  Churn Inputs rows under the last one, and a section on the Board Notes tab.
- Board commentary: a Notes column right of the newest month carries one
  business-language line per row whose calculation or starting point changed
  in this report, and the same line is a note on that row's cell. Next month
  the column moves right ahead of the new month and its old lines are
  cleared; every report's detail stays on the Board Notes tab. The lines come
  from `commentary()` in draft_workbook.py; one-off lines for a report go in
  `REPORT_COMMENTARY`.
- Row 44 (Running Cost per Conversion) through July 2026 holds the values as
  reported at the time. The original formulas summed later months' spend, so
  they moved once August was entered; they were replaced by their published
  values on 2026-10-07, with a note on the cells.
- Never written: July or any earlier column.
- A live formula that differs from the draft is replaced and listed in the
  plan. A live typed value that differs stops the run as a conflict.
- After writing, the main tab's calculated values are read back and compared
  with the draft as LibreOffice calculates it.
- The working-paper tabs go to `.board-kpis/kpi_support.xlsx`, filed in
  Drive beside the sheet; its link goes in config.json `support_links`.

### Restating history

A historical row is recalculated only on purpose: list it in config.json
`restate` (rows, first and last month, the report, what changed, the cell
note). draft_workbook.py refills those cells with the formula the row used
just before the range and adds a Board Notes line; write_sheet.py may then
change those cells and no others through July. Reseller $ churn rates (rows
185-186) for December 2025 to July 2026, typed as 0%, were restated in the
September 2026 report.

An entry with `"mode": "header_date"` instead sets row 5's month headers to
the date the sheet uses for each column: the month, with the year's last two
digits as the day, shown as e.g. "July-26". The September 2026 report
corrected eight stored dates that way (only September 2023, typed as text,
changed on screen).

## Reporting conventions

1. Historical values and formulas stay as published, so a change does not
   ripple back through the history. Corrections apply from the month they
   are made. At 2026 year-end, review rebasing any history that was
   populated incorrectly (the held items are listed under Open items on the
   Sources tab).
2. When a month's report is finalized, every calculation change or rebase is
   annotated for the board notes. The Board Notes tab is that record: each
   change, the month it takes effect, and July 2026 as published beside July
   under the new method.

## Not built yet

- **A Reseller Reactivation row.** The sheet has none; a reseller
  reactivation is flagged on the Sources tab until one is added.
- **CTAM, reseller end clients and payroll.** Payroll needs a payroll source
  or a QuickBooks ledger published to Ramp, and the other two are estimates.

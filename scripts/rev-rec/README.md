# rev-rec

Fills last month's tab in the **Subscription Rev Rec** workbook (sent to the
outsourced bookkeepers) from Stripe, on the morning of the 2nd business day of
each month.

| File | Does |
| --- | --- |
| `rows.py` | Pure logic: one month's rows from Stripe invoices, the flags, and the business-day calendar |
| `run.py` | Checks the day, pulls Stripe, finds or creates the tab, writes, reads back, writes `.rev-rec/summary.md` |
| `test_rows.py` | One case per rule, named after the account that showed it. No network |

```bash
python3 scripts/rev-rec/run.py         # the whole run; exit 3 on any other day
python3 scripts/rev-rec/test_rows.py
```

`rows.py` reproduces the September 2026 tab, which was filled by hand from the
same rules, exactly: 95 rows and $70,365.96.

## Why the 2nd business day

Arrears resellers and client accounts are billed for a month on the 1st of the
next, and those invoices go out on its 1st business day. The month can only be
closed the day after. A cron line can't say "2nd business day", so the Routine
fires every day from the 2nd to the 5th at 8:52 Eastern, and `run.py` exits
with code 3 unless today is the day. US federal holidays that fall early in a
month (New Year's Day, July 4, Labor Day) are accounted for, and a test checks
that the 2nd business day always lands in that window.

## The rules

These are the same as the July to September tabs. The docstring in `rows.py`
has the detail.

- **Invoices dated in the month** give "Not Arrears" rows: plans, licenses,
  Destinations, client accounts and prorated first months, net of discounts.
  Consumption, free trials and Shopify Development services are left out.
- **The arrears resellers** (`arrears_customers` in
  `scripts/board-kpis/config.json`, shared with the board KPI routine) take
  their row from the invoice dated the 1st of the next month, marked
  "Arrears".
- **Client accounts on a renewal dated the 1st** belong to the month before.
  They become an "Arrears (client accounts)" row there and are left out of
  the invoice's own month. DriveLocal is the example. A renewal anchored on
  another day (EvolveMKD, the 10th) bills ahead and stays in its own month.
- **Annual invoices** count one month and are flagged.
- **Void, uncollectible and unsent invoices** are left out and flagged. An
  arrears invoice still in draft on the 2nd business day is used and flagged.
- **A manual invoice with no product** (Dealer Trade Network's $2,250) is
  flagged for a person to classify, never guessed.

## Safety

- **A tab with any rows in A2:F is never overwritten.** The run stops with
  exit 2. To rebuild a month, clear its rows first.
- **A missing tab is created** at the front with the standard header and
  `=SUM(E:E)` in H5.
- **Everything is written in one request** and read back. A mismatch in the
  row count or the H5 total fails the run.
- **It writes only to that one tab.** Fixes to earlier months stay manual.

## Setup

- **Sheets access:** the service account in `WINS_SA_KEY`
  (`deal-win-logger@internal-teamrevdealupdate.iam.gserviceaccount.com`, see
  `scripts/common/sheets.py`) must have Editor access to the workbook.
- **Stripe:** the environment's injected credential for `api.stripe.com`.
- **Slack:** the Routine needs the Slack connector to DM the summary.
- **To backfill a month by hand:** set `REV_REC_TODAY` to the 2nd business day
  of the month after it, with the target tab empty.

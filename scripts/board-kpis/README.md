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

```bash
python3 scripts/board-kpis/stripe_pull.py   # -> .board-kpis/*.json
python3 scripts/board-kpis/mrr.py           # -> .board-kpis/draft.json, ledger.md
python3 scripts/board-kpis/test_mrr.py      # no network, no credentials
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
`rebase_adjustment`. `config.json` holds the sheet's July ending that it is
measured against. After August, `rebase` has no effect.

## Backtest

Run against February to July 2026, the code matches most typed-in cells. The
months that differ trace to the sheet. For example, March's Direct
cancellations in the sheet don't agree with the sheet's own Churn Inputs tab,
and a Bedzzz expansion was never entered. Treat a difference on a month from
before automation as a question about the sheet first.

## Not built yet

- **Writing to the sheet.** This needs the service account in
  `scripts/common/sheets.py` to have edit access to the KPI workbook. Writes will only fill
  empty input cells for the reported month. Separately, a one-time,
  explicitly approved change adds the Reseller Reactivation row and extends
  the August and September formulas.
- **Customer counts, pipeline, MQLs and CAC.** These are later phases.

# board-financial-reporting

Scheduled routines that build the monthly financial reporting for the board and
the outsourced bookkeepers from Stripe.

| Routine | Skill | Scripts | What it produces |
| --- | --- | --- | --- |
| `rev-rec-monthly` | `.claude/skills/rev-rec-monthly/` | `scripts/rev-rec/` | Last month's tab in the **Subscription Rev Rec** workbook, filled on the 2nd business day, plus a Slack DM to Connor with the total and anything that needs a person |
| `board-kpis` | `.claude/skills/board-kpis/` | `scripts/board-kpis/` | The MRR movement inputs for the board KPI sheet (New, Expansion, Reactivation, Contraction, Cancellation for Direct and Reseller) and a per-customer ledger, sent to Connor for review. Draft only: it does not write to the KPI sheet yet |

`scripts/common/sheets.py` is the Google Sheets client both use. It signs its
own service-account JWT with openssl, so there are no Google libraries to
install.

Each `scripts/<name>/README.md` covers that routine's rules, the decisions
behind them, and its tests.

## How a routine is put together

Logic and scheduling are kept apart:

- **The steps** live in `.claude/skills/<name>/SKILL.md`, and the arithmetic
  lives in `scripts/<name>/`, in this repo. Editing them changes every future
  run.
- **The schedule** is an account-level Routine whose prompt is just
  `/<name>`. It runs in a fresh cloud session each time.
- **Connectors** (Slack) and **this repo as a source** are attached on the
  Routine in the Routines UI. The API cannot attach either on this account.
  A Routine missing either fires on schedule, does nothing, and says nothing.
- **Credentials** are environment settings, not repo files:
  - the Stripe connection is the environment's injected credential for
    `api.stripe.com`;
  - `WINS_SA_KEY` holds the Google service account JSON;
  - each workbook must be shared with that service account as Editor.
- **Each run starts from the default branch**, so a change takes effect once
  it is merged.

## Running by hand

```bash
python3 scripts/rev-rec/test_rows.py      # no network, no credentials
python3 scripts/board-kpis/test_mrr.py

python3 scripts/board-kpis/stripe_pull.py  # -> .board-kpis/
python3 scripts/board-kpis/mrr.py          # -> .board-kpis/ledger.md

python3 scripts/rev-rec/run.py             # exits 3 unless today is the 2nd business day
```

# board-dashboard

Builds the data behind the **Untitled Board Reporting** dashboard
(claude.ai artifact `MqkxbbhsgVDEbtKbuwdNL2`) and keeps the page's source.
Nothing here writes to a source sheet.

| Path | Does |
| --- | --- |
| `stripe_churn.py` | Pulls Stripe and writes customer cancellations and monthly MRR movements from January 2025 under the board KPI rules |
| `build_data.py` | Reads the KPI sheet and TEAM REVENUE WINS with the service account, plus the churn log export and churn reasons, and writes one JSON per dashboard source to `.board-dashboard/out/` |
| `sql/` | The live Metabase queries (reseller end clients, MQLs, open pipeline, new-opportunity split, opportunities by channel, churn reasons, July deck pipeline follow-up), as stored in the dashboard |
| `page/` | The dashboard page: `font.js` (embedded Inter, OFL), `core.js` (charts, callouts, sparklines, copy-to-deck), `calcs.js` (period roll-ups readers can inspect), `app.js` (cards and notes), `style.css` + `gen.py` (generate `index.html`) |

## Sources and rules

- **MRR, customers, pipeline movement:** the KPI sheet as published, including
  the August 2026 Stripe rebase. A restatement is deferred to year end.
- **MQLs:** Metabase question 139's definition, as reported to the board so far.
- **New opportunities:** the KPI sheet's count (Opportunity, Enterprise and
  Expansion pipelines), with the HubSpot split by source beneath it
  (`sql/new_opportunities_split.sql`).

- **Wins (`bookings`):** republished nightly by the wins-logger routine in
  untitledinternaltooling (`scripts/wins-logger/bookings.py`, SKILL.md STEP
  10), which mirrors `bookings()` here. Running `build_data.py` still rebuilds
  it by hand.

- **Board version reads the snapshot only.** The Live / Board snapshot control
  is removed: live queries run on the viewer's own Metabase and CFO.ai access,
  which board members do not have. The live datasets and SQL stay in place;
  retake every `*_frozen` set before each send.

- **Churn detail exceptions** (`calcs.js`, `BILLED_AS` and `NOT_A_CHURN`):
  Painted Paper is Compound Foundry's billing name in Stripe. Aprio's March 2026
  cancellation is left out: it was the billing half of Bedzzz Express
  (Dreamcraft), unpaid since July 2025, and Bedzzz's subscription rose to the
  full $2,000 when it was cancelled, so the account churns once, as Bedzzz
  Express in July 2026. The KPI sheet still shows March's −$1,000 cancellation
  and +$1,000 expansion, which net to zero.

- **Enterprise pipeline is retired.** It was folded into the Opportunity
  pipeline; the pipeline cards count any deal still in it as Opportunity, and
  its closed-lost deals will be migrated there in HubSpot.

## Plan tracker

The Plan tracker tab scores October 2026 to March 2027 against the targets in
CFO.ai's Cash Forecast Q4'26-Q1'27 scenario (table "Monthly sales & retention
targets by channel", for the case selected in its Case toggle).

- **CFO.ai is read only.** The `plan_targets` dataset calls
  `inspect_table_blocks` and nothing else; changes to the model are made in
  CFO.ai, by a person, and are asked about first.
- **All new MRR:** every software MRR row in the Wins tabs by signed date (new
  customers plus upsells, reactivations and conversions), scored against
  CFO.ai's new-customer MRR target plus its expansion MRR target. The Wins tab
  stays the source until the source rebase.
- **Actuals:** new-customer MRR and new customers from the Wins tabs by signed
  date (the open month counts to date, with a full-month pace); expansion, lost
  MRR, net change and ending MRR from the KPI sheet once a month closes;
  consumption from the revenue tabs (`plan_actuals` in `calcs.js`).
- **Pipeline:** `sql/opportunities_by_channel.sql` (created, won and lost by
  month and channel) with the open-pipeline query. Win rate is won over won
  plus lost for deals closed since August 1, 2026, when the demo-led motion
  started.
- **Board snapshot:** `plan_targets_frozen` (Upside case, re-read October 16, 2026 after the Upside additions) and
  `opps_channel_frozen` (October 16, 2026). Retake both with the other `*_frozen` sets
  before each board meeting.
- CFO.ai updates actuals on a last-close basis, usually the 15th to 20th of the
  following month, so its view of a month lags this tab's.

### Upside additions and the three planning views (October 16, 2026)

After investor feedback, the case that was Upside became Base (6.9% subscription and 4.2% consumption monthly growth), and
the Upside case adds named deals and reseller account adds on top of that growth. They are inputs on CFO.ai's
"Upside Additions" page ("Upside additions (inputs)": one row per addition with revenue line, channel, movement, start month
and monthly amount; reseller accounts read the single `Upside Reseller Account Add MRR` input, $350). "Upside additions by month"
turns them into monthly amounts, switched on by `Case Includes Upside Additions` (1 for Upside only). The revenue lines stack
them flat on the growth rate: `(prior month - prior additions) x (1 + growth) + additions`. DSP additions are our 20% take;
gross billings and the Prospect Desk pass-through follow from `DSP Margin %`. The targets table splits new-customer MRR into
named (`Target Named Upside New Customer MRR`) and pipeline-sourced (`Target Pipeline-Sourced New Customer MRR`), and counts
each named new customer as one win.

- **Subscription MRR waterfall** (Plan tab, `mrr_waterfall`): KPI-sheet movements April to September, then the Upside case
  from the targets table, with the named deals and named expansion shown apart. October opens at the model's September
  baseline, $100 below the KPI sheet (shown as the baseline step).
- **Base case** (`plan_targets_base`): the Base case has the old Upside inputs with the additions switched off, so its targets
  are the October 14 read (rechecked October 16) exactly; October matches the Upside read and March differs by the $18,100 of
  additions. The MRR waterfall switches between cases with the other case's ending MRR dashed, and "All new MRR against the
  plan" shows the Base target dashed beside the Upside target.
- **MRR bridge, all recurring revenue** (Revenue tab, `c-bridge` Scope toggle): Total MRR as on the KPI sheet (subscription and
  services MRR plus the month's consumption and DSP revenue). Subscription keeps its movements; consumption and DSP are one
  step each, their net change from the month before the period to its last month, since usage has no contract to expand or
  cancel. Total only: usage is not split by channel.
- **Pipeline waterfall by month** (Sales tab, `pipeline_waterfall`, `sql/pipeline_waterfall.sql`), for the closed months in
  the date range (the last three if none): rebuilt from HubSpot's
  pipeline, stage and amount history, so every month foots. The KPI sheet's own pipeline movement columns do not foot before
  August 2026 (and September's value decrease equals its lost value), so this view does not use them.
- **Pipeline creation needed** (Plan tab, `pipeline_needed`), Base and Upside, blended across all new business: pipeline-sourced
  wins each month (both channels) divided by the blended win rate since August 1, with the share created the month before set by the median days to close, and valued at the average
  opportunity created since August 1. March's following month is assumed equal to March.

### Board baseline: the July 21, 2026 deck

The last deck the board saw (Q3 meeting, covering Q2) is the reference point.
Checked October 14, 2026:

- **Ties exactly:** monthly revenue by line for January to June 2026, H1 churn
  (29 customers, $23,250; 2025 halves 33 / $20,100 and 26 / $21,550), 2026
  bookings to July 17 ($463,224, 80 deals, 43 new, $27,900 contracted MRR,
  $25,910 DSP; Q1 $105,340, Q2 $335,084) and active customers (87 in June).
- **Close:** reseller end clients in June are 223 with 29 resellers on the deck
  and 225 with 28 in Metabase now (late platform activity).
- **Goals:** the December target ($184K) is the 2026 budget line on the deck's
  Path to Break Even slide ($183,944); the deck's forecast was $186,864. The
  60-reseller and 400 to 500 end-client goals come from the May deck and were
  not restated in July. Goal baselines now use the July deck's June figures.
- **Forecast:** `july_forecast` holds the deck's July to December forecast and
  budget lines next to CFO.ai actuals and its current Base and Upside forecast
  (Plan tab, "Against the July 2026 board forecast").
- **Pipeline:** `sql/deck_pipeline.sql` follows the 11 deals on the deck's
  pipeline highlights slide in HubSpot. It replaces the May deck follow-up.
- **Trial motion:** the deck says trials continue, on request after discovery
  and a demo, rather than as the default entry point.

### Running notes: proposed CFO.ai target changes (for review, not applied)

Raised October 14, 2026 after the first 45 days of the demo-led motion. Each
changes only the Sales & Retention Targets inputs, not the case P&L or cash
forecast. Nothing is changed in CFO.ai without an explicit go-ahead.

1. **Direct loss window.** The Direct loss allowance (8.8% of opening MRR a
   month) averages April to September, including June's $8,850 spike. July to
   September ran 6.9%. Moving the window would lower Direct's required new MRR
   by about $800 a month.
2. **New MRR per customer.** The model uses $446 (Direct) and $1,133
   (Reseller), from July to September. The last 45 days ran $523 and $917:
   about 10 Direct wins a month instead of 12, and 6 Reseller instead of 5.
3. **Growth mix.** The model gives resellers 66% of net growth; the last 45
   days ran 70%. Small effect either way.
4. **Reseller-led variant to consider.** Direct new MRR covers Direct losses
   (about $3,750 a month) and resellers carry all net growth (about $7,400 a
   month rising to about $10,900 by March, 8 to 12 wins a month). Same total
   new MRR. Watch: the model's 7% monthly reseller billing-lapse allowance, and
   consumption being 99.6% reseller.
5. **Consumption split.** CFO.ai shows consumption revenue as 99.6% reseller,
   but no Direct customers are on the consumption model, so it should be 100%
   reseller. Raised October 16, 2026; to fix in CFO.ai after the board meeting.

## Financial review

The Financial review tab mirrors the deck's path-to-break-even and budget variance slides. Its one dataset, `fin_review`, is flat rows (`kind` meta, month or line; the dashboard runtime does not pass nested lists through) read by hand from CFO.ai (read only): "P&L - This Month vs Budget" and "P&L - YTD vs Budget" with comparison Budget 2026, and "P&L - TTM" for the monthly series, all from Main Scenario.

- The path-to-break-even chart shows actuals through the close, then the current Upside case from Cash Forecast Q4'26-Q1'27 (Forecast P&L, read only) as lighter bars, with the budget as dotted (B) lines. Re-read the Upside months with each refresh.
- The variance tables follow the deck's columns (month, month budget, month variance, YTD budget, YTD variance); Copy table also carries YTD actual.
- Variance is actual minus budget (CFO.ai's delta column is budget minus actual). Green marks a favorable variance and red an unfavorable one (revenue under budget, expenses over), as on the deck.
- Expenses are COGS plus operating expenses; CFO.ai's "Total Expenses" is opex only.
- CFO.ai's EBITDA includes other income, so revenue minus expenses does not equal EBITDA exactly.
- Re-read after each close and update `close_month`. The tab follows whatever close the file holds.
- The "Against the July 2026 board forecast" card sits on this tab.
- From the September close, actuals are read from the Cash Forecast Q4'26-Q1'27 scenario: it was closed through September while Main Scenario and Budget 2026 still showed an August last close. Its January to August figures match Main Scenario to the cent. Run `fin_statements/build.py 2026-09` after saving the reads to `.board-dashboard/cfo/sep/`.
- The July 2026 board forecast card shows actuals and the Upside case only. The model has a case selector, so Base can only be read by switching it, which is a change to CFO.ai.

### Financial statements (quarter vs budget, year to date and forecast)

Two more cards on the Financial review tab cover the deck's financial summary slides from one dataset, `fin_statements` (long-form flat rows).

- **Quarter against budget** switches between Summary, Income statement, Balance sheet and Cash flows. Each closed month of the quarter shows actual, budget and variance, then the quarter: summed for flows, the latest month for balances. Months after the last close are left out until they close, and the quarter column is labelled "to date" until then. Copy image copies the statement showing.
- **2026 year to date and forecast** is the monthly summary for January to December: actuals through the close, then the current Upside case.
- Sources, all read only with `inspect_table_blocks`, format `ream`: Main Scenario `Monthly Summary Statement#b30`, `P&L - TTM#17c`, `Balance Sheet - TTM#25e` and `Cash Flows - TTM#30a` with comparison `Budget 2026#218`; Cash Forecast Q4'26-Q1'27 `Monthly Summary — Forecast#2b6` for the Upside months.
- Save each read's row lines to `.board-dashboard/cfo/` (`sum`, `pl`, `bs`, `cf`, `ytd`), update the column map in `fin_statements/build.py` if the months move, then run it. It refuses to write unless revenue and expense lines sum to their totals, assets equal liabilities and equity, operating cash flow sums, cash reconciles opening to closing and to the balance sheet, and the Upside months match `fin_review`.

## Date range

The page has a preset menu (last 90 days, month to date, last month, quarter to
date, last quarter, year to date, last 12 months, last year) and start/end date
inputs; editing a date switches to a custom range. The default is last quarter,
and each viewer's choice is remembered in their browser.

- **Daily sources** (bookings, churns, reseller end clients) use the exact dates.
- **Month-close sources** (MRR, revenue, customers, pipeline, MQLs) use the
  closed months at least half inside the range. If none has closed yet, they
  show the latest closed month, and the page says so.
- **Compare with:** the previous period steps back one calendar unit for
  calendar presets (a month, a quarter or a year), by the month count for a
  whole-month custom range, and by the range's own length otherwise. Same
  period last year steps back twelve months. Month-close comparisons always
  cover the same number of months as the range.
- The period calcs in `calcs.js` take an optional window map as their last
  argument; the page reruns them on the picked range, and the dashboard's own
  run uses the fixed windows written in each calc.

## Open for the year-end 2026 rebase

Held so the board sees one set of definition changes at year end, not a
drip of restatements:

1. **Stripe restatement** of KPI-sheet MRR before the August 2026 true-up.
2. **MQL cleanup:** exclude HubSpot's "Low Quality Conversion (GA
   Optimization)" lifecycle stage, personal and free-mail domains (including
   gmail typos and throwaway domains) and internal addresses. Cleaned counts
   are Q1 2026 43, Q2 55, Q3 59, against 120, 129 and 75 today. The stage was
   not used before Q2 2025, so earlier quarters need a domain-only cleanup.
3. **Funnel on new business only:** drop expansion deals from new
   opportunities and measure marketing conversion as clean MQLs to
   marketing-sourced new-business opportunities (Q3 2026: 59 to 43, 73%).
   Show all new business, split marketing-sourced vs other, as pipeline mix
   rather than a conversion rate. The headline count then comes from HubSpot
   (Q3 90) instead of the KPI sheet (Q3 92, which includes expansion).
- **Revenue by line:** the 2.5Y tab through June 2025, the TTM tab after.
- **Bookings:** FY25 and FY26 WINS. Software only; services projects are left
  out. A new logo is a customer's first New software deal since January 2025.
  FY25 rows dated 2024 are read as 2025 and printed.
- **Churn (who and how much):** Stripe cancellations from January 2025 under
  the board KPI rules, built by `stripe_churn.py`, which runs
  `scripts/board-kpis/mrr.py` over a longer history. These drive the churn
  summary, reasons and who-churned cards for any date range.
- **Churn (why):** the HubSpot company churn reason, live through
  `sql/churn_reasons.sql`, matched to each cancellation by email domain and
  then name (nearest churn date wins); otherwise the Master Churn Data Log's
  note within two months (its 2026 tab and the 2025 rows of its Input tab),
  which also supplies customer type and churn type. Grouped by keyword into
  categories (`CATEGORIES`, mirrored in the `churns` calc).
- **Churn totals:** lost MRR, churn rates and the MRR bridge stay on the KPI
  sheet as published until the year-end rebase. The Internal tab's "Stripe vs
  the KPI sheet, by month" shows what that restatement would change.
- **Reseller end clients:** question 1156's logic without its 3-month lookback
  (`sql/reseller_end_clients.sql`); months before September 2025 come from the
  Wins tab as published.

## Refreshing

1. Export the Master Churn Data Log as .xlsx to `.board-dashboard/churn.xlsx`
   (or share it with the service account and read it like the other sheets).
2. Save HubSpot companies with a 2026 `churn_date` (name, domain, churn_reason,
   churn_date) to `.board-dashboard/hubspot_churn_reasons.json`.
3. `python3 scripts/board-dashboard/build_data.py`, then
   `python3 scripts/board-dashboard/stripe_churn.py` (pulls Stripe through the
   proxy; a few minutes)
4. Upload each changed file in `.board-dashboard/out/` to the dashboard and
   point its dataset at the new url; set `updated`.
5. For a board meeting, re-run the `sql/` queries and save them as the
   `*_frozen` snapshot datasets so every reader sees the same numbers.

## Churn allowance, budget view and forecast bridge (October 16, 2026)

- **Loss allowance cut.** CFO.ai's channel baselines carry `Target Loss Allowance Reduction` (25% for every channel). The confirmed churn, billing lapse and contraction allowances in "Monthly sales & retention targets by channel" multiply by `(1 - reduction)`, so required new MRR, wins and pipeline fall with it. Over October to March this lowers Upside new MRR needed from $88.1K to $75.9K and Base from $75.0K to $63.7K. `plan_targets_base`, `plan_targets_frozen`, `mrr_waterfall` and `pipeline_needed` were rebuilt from it; the Base targets match the live model after the case was set to Base.
- **Financial review chart (c-fin-path).** Shows the 2026 budget for every month as wide light bars with actuals layered as narrow solid bars. No forecast.
- **MRR bridge (c-bridge).** The subtitle shows only the selected window (no "vs"), Beginning and Ending show their month-end dates, and a View selector switches between Actual (date range), Base forecast and Upside forecast (September 30, 2026 to March 31, 2027). The forecast views use `mrr_waterfall` for subscription steps and, for all recurring revenue, the consumption and DSP revenue each case carries in that dataset (CFO.ai Forecast P&L).
- **Pipeline bridge (c-pipewf).** Rebuilt in the MRR bridge's form (shared `bridgeDraw`): Beginning, Created, Reopened or moved in, Value raised, Value lowered, Won, Lost, Ending over the closed months in the date range, by pipeline. A View selector adds the Base and Upside plans for new business, October 2026 to March 2027, from `pipeline_needed`: created and won value the plan needs, and lost deals implied by the 46.6% win rate at the $8,208 average opportunity. No value changes or moves are assumed in the plan views.

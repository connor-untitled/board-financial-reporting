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

## Plan tracker

The Plan tracker tab scores October 2026 to March 2027 against the targets in
CFO.ai's Cash Forecast Q4'26-Q1'27 scenario (table "Monthly sales & retention
targets by channel", for the case selected in its Case toggle).

- **CFO.ai is read only.** The `plan_targets` dataset calls
  `inspect_table_blocks` and nothing else; changes to the model are made in
  CFO.ai, by a person, and are asked about first.
- **Actuals:** new-customer MRR and new customers from the Wins tabs by signed
  date (the open month counts to date, with a full-month pace); expansion, lost
  MRR, net change and ending MRR from the KPI sheet once a month closes;
  consumption from the revenue tabs (`plan_actuals` in `calcs.js`).
- **Pipeline:** `sql/opportunities_by_channel.sql` (created, won and lost by
  month and channel) with the open-pipeline query. Win rate is won over won
  plus lost for deals closed since August 1, 2026, when the demo-led motion
  started.
- **Board snapshot:** `plan_targets_frozen` and `opps_channel_frozen` as of
  October 14, 2026 (Upside case). Retake both with the other `*_frozen` sets
  before each board meeting.
- CFO.ai updates actuals on a last-close basis, usually the 15th to 20th of the
  following month, so its view of a month lags this tab's.

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

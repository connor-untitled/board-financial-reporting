# board-dashboard

Builds the data behind the **Untitled Board Reporting** dashboard
(claude.ai artifact `MqkxbbhsgVDEbtKbuwdNL2`) and keeps the page's source.
Nothing here writes to a source sheet.

| Path | Does |
| --- | --- |
| `build_data.py` | Reads the KPI sheet and TEAM REVENUE WINS with the service account, plus the churn log export and churn reasons, and writes one JSON per dashboard source to `.board-dashboard/out/` |
| `sql/` | The live Metabase queries (reseller end clients, MQLs, open pipeline, new-opportunity split), as stored in the dashboard |
| `page/` | The dashboard page: `font.js` (embedded Inter, OFL), `core.js` (charts, callouts, sparklines, copy-to-deck), `calcs.js` (period roll-ups readers can inspect), `app.js` (cards and notes), `style.css` + `gen.py` (generate `index.html`) |

## Sources and rules

- **MRR, customers, pipeline movement:** the KPI sheet as published, including
  the August 2026 Stripe rebase. A restatement is deferred to year end.
- **MQLs:** Metabase question 139's definition, as reported to the board so far.
- **New opportunities:** the KPI sheet's count (Opportunity, Enterprise and
  Expansion pipelines), with the HubSpot split by source beneath it
  (`sql/new_opportunities_split.sql`).

## Open for the year-end 2026 rebase

Held so the board sees one set of definition changes at year end, not a
drip of restatements:

1. **Stripe restatement** of KPI-sheet MRR before the August 2026 true-up.
2. **MQL cleanup:** exclude HubSpot's "Low Quality Conversion (GA
   Optimization)" lifecycle stage, personal and free-mail domains (including
   gmail typos and throwaway domains) and internal addresses. Cleaned counts
   are Q1 2026 43, Q2 55, Q3 59, against 120, 129 and 75 today. The stage was
   not used before Q2 2025, so earlier quarters need a domain-only cleanup.
- **Revenue by line:** the 2.5Y tab through June 2025, the TTM tab after.
- **Bookings:** FY25 and FY26 WINS. Software only; services projects are left
  out. A new logo is a customer's first New software deal since January 2025.
  FY25 rows dated 2024 are read as 2025 and printed.
- **Churn:** the Master Churn Data Log, with reasons from HubSpot company
  `churn_reason`, then Slack (`slack_churn_reasons.json`), then the log's own
  note, grouped by keyword into categories (`CATEGORIES`).
- **Reseller end clients:** question 1156's logic without its 3-month lookback
  (`sql/reseller_end_clients.sql`); months before September 2025 come from the
  Wins tab as published.

## Refreshing

1. Export the Master Churn Data Log as .xlsx to `.board-dashboard/churn.xlsx`
   (or share it with the service account and read it like the other sheets).
2. Save HubSpot companies with a 2026 `churn_date` (name, domain, churn_reason,
   churn_date) to `.board-dashboard/hubspot_churn_reasons.json`.
3. `python3 scripts/board-dashboard/build_data.py`
4. Upload each changed file in `.board-dashboard/out/` to the dashboard and
   point its dataset at the new url; set `updated`.
5. For a board meeting, re-run the `sql/` queries and save them as the
   `*_frozen` snapshot datasets so every reader sees the same numbers.

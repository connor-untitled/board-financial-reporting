-- Reseller end clients
-- Reseller end clients with 10+ resolutions per month from September 2025, resellers with active clients, resolutions and consumption revenue; the logic of Metabase question 1156 without its 3-month lookback. Reads lds_data.customer_summary, untitled_auth0.organization(_metadata) and reseller_threshold_sheet.reseller_threshold.
-- Metabase, database 2 ("Untitled Internal"). Stored as the dashboard dataset "end_clients".
WITH org AS (
  SELECT o.name AS client, m.value AS workspace
  FROM untitled_auth0.organization o
  JOIN untitled_auth0.organization_metadata m ON m.organization_id = o.id AND m.name = 'agency'
),
th AS (
  SELECT client_workspace, CAST(resolution_threshold AS BIGINT) AS threshold, CAST(tag_cap_ AS BIGINT) AS cap,
         consumption_fee_ AS fee, CAST(first_consumption_month AS date) AS first_month
  FROM reseller_threshold_sheet.reseller_threshold
  WHERE client_name IS NOT NULL AND client_name <> ''
),
monthly AS (
  SELECT CAST(DATE_TRUNC('month', activity_date) AS date) AS month, client, subclient, SUM(total) AS resolutions
  FROM lds_data.customer_summary
  WHERE activity_date >= DATE '2025-09-01' AND client <> 'mcivormarketing'
  GROUP BY 1, 2, 3
)
SELECT to_char(mo.month, 'YYYY-MM') AS month,
       COUNT(DISTINCT mo.client || '-' || mo.subclient) AS end_clients,
       COUNT(DISTINCT th.client_workspace) AS resellers,
       SUM(mo.resolutions) AS resolutions,
       ROUND(SUM(CASE WHEN mo.resolutions > th.threshold AND th.threshold <> 0 THEN th.cap ELSE mo.resolutions * th.fee END)::numeric, 2) AS consumption_revenue
FROM monthly mo
JOIN org ON org.client = mo.client AND org.workspace <> 'untitled'
JOIN th ON th.client_workspace = org.workspace
WHERE mo.month >= th.first_month AND mo.resolutions >= 10
GROUP BY 1 ORDER BY 1

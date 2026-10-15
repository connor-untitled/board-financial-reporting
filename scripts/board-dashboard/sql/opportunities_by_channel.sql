-- New-business opportunities by month and channel
-- HubSpot deals in the Opportunity and Enterprise pipelines since May 2026: created per month (by create date) and won or lost
-- per month (by close date), split by account type into Direct, Reseller and "Not yet tagged". Feeds the Plan tracker's pipeline
-- coverage and win rate. Expansion deals are left out: the plan counts them as expansion MRR, not new customers.
-- Metabase, database 2 ("Untitled Internal"). Stored as the dashboard dataset "opps_channel".
WITH d AS (
  SELECT CASE WHEN d.property_account_type IN ('Direct', 'Brand of Brands') THEN 'Direct'
              WHEN d.property_account_type IN ('Agency (Reseller)', 'Agency (Integration)') THEN 'Reseller'
              ELSE 'Not yet tagged' END AS block,
         to_char(DATE_TRUNC('month', d.property_createdate AT TIME ZONE 'America/New_York'), 'YYYY-MM') AS created_month,
         to_char(DATE_TRUNC('month', d.property_closedate AT TIME ZONE 'America/New_York'), 'YYYY-MM') AS closed_month,
         ps.label AS stage
  FROM hubspot.deal d
  JOIN hubspot.deal_pipeline_stage ps ON ps.stage_id = d.deal_pipeline_stage_id
  WHERE d.deal_pipeline_id IN ('772338804', '785877425')
    AND NOT COALESCE(d.is_deleted, false) AND NOT COALESCE(d._fivetran_deleted, false)
    AND d.deal_id NOT IN (63450358167)  -- deleted in HubSpot; Fivetran never marked it deleted
)
SELECT month, block, SUM(created) AS created, SUM(won) AS won, SUM(lost) AS lost
FROM (
  SELECT created_month AS month, block, 1 AS created, 0 AS won, 0 AS lost FROM d
  UNION ALL
  SELECT closed_month, block, 0, CASE WHEN stage = 'Closed Won' THEN 1 ELSE 0 END, CASE WHEN stage = 'Closed Lost' THEN 1 ELSE 0 END
  FROM d WHERE stage IN ('Closed Won', 'Closed Lost')
) x
WHERE month >= '2026-05'
GROUP BY 1, 2 ORDER BY 1, 2

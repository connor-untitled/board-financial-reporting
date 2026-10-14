-- New opportunities by month, split three ways
-- HubSpot deals created per month since January 2025 in the Opportunity, Enterprise and Expansion pipelines (the pipelines the
-- KPI sheet counts as new opportunities), grouped as marketing-sourced new business (deal source is one of the MQL sources),
-- other new business (direct traffic, offline/sales or reseller entered, referrals) and expansion. Pipeline is the deal's
-- current pipeline, so deals moved in from Qualification after month end are included; the KPI sheet's month-end count is lower.
-- Metabase, database 2 ("Untitled Internal"). Stored as the dashboard dataset "opps_split".
SELECT to_char(DATE_TRUNC('month', d.property_createdate AT TIME ZONE 'America/New_York'), 'YYYY-MM') AS month,
       CASE WHEN p.label = 'Expansion' THEN 'Expansion'
            WHEN d.property_hs_analytics_source IN ('ORGANIC_SEARCH', 'PAID_SEARCH', 'EMAIL_MARKETING', 'PAID_SOCIAL', 'SOCIAL_MEDIA', 'AI_REFERRALS')
              THEN 'Marketing-sourced new business'
            ELSE 'Other new business' END AS bucket,
       COUNT(*) AS deals
FROM hubspot.deal d
JOIN hubspot.deal_pipeline p ON p.pipeline_id = d.deal_pipeline_id
WHERE NOT COALESCE(d.is_deleted, false) AND NOT COALESCE(d._fivetran_deleted, false)
  AND p.label IN ('Opportunity', 'Enterprise', 'Expansion')
  AND d.property_createdate >= TIMESTAMP '2025-01-01 00:00:00' AT TIME ZONE 'America/New_York'
GROUP BY 1, 2 ORDER BY 1, 2

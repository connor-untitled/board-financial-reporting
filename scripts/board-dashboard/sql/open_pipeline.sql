-- Open pipeline by stage
-- Open deals and value by HubSpot pipeline (Opportunity, Enterprise, Upsell), block and stage, as HubSpot holds them now. Reads hubspot.deal and hubspot.deal_pipeline_stage.
-- Metabase, database 2 ("Untitled Internal"). Stored as the dashboard dataset "pipeline_open".
SELECT CASE d.deal_pipeline_id WHEN '772338804' THEN 'Opportunity' WHEN '785877425' THEN 'Enterprise' ELSE 'Upsell' END AS pipeline,
       CASE WHEN d.deal_pipeline_id = '99167368' THEN 'Upsell'
            WHEN d.property_account_type IN ('Direct', 'Brand of Brands') THEN 'Direct'
            WHEN d.property_account_type IN ('Agency (Reseller)', 'Agency (Integration)') THEN 'Reseller'
            ELSE 'Not yet tagged' END AS block,
       ps.label AS stage, ps.display_order AS stage_order,
       COUNT(*) AS deals, COALESCE(SUM(d.property_amount), 0) AS pipeline_value
FROM hubspot.deal d
JOIN hubspot.deal_pipeline_stage ps ON ps.stage_id = d.deal_pipeline_stage_id
WHERE d.deal_pipeline_id IN ('772338804', '785877425', '99167368')
  AND NOT ps.is_closed
  AND NOT COALESCE(d.is_deleted, false) AND NOT COALESCE(d._fivetran_deleted, false)
  AND d.deal_id NOT IN (63450358167)  -- deleted in HubSpot; Fivetran never marked it deleted
GROUP BY 1, 2, 3, 4 ORDER BY 1, 2, 4

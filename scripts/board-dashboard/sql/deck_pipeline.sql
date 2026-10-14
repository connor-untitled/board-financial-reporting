-- July 2026 deck pipeline highlights, followed up
-- The 11 deals on the July 21, 2026 deck's "Pipeline Highlights & Catch-up Plan" slide, with the deck's estimated monthly value,
-- joined to where each deal stands in HubSpot now. Hestan covers both DSP upsells (Culinary and Appliances). Reads hubspot.deal and hubspot.deal_pipeline_stage.
-- Metabase, database 2 ("Untitled Internal"). Stored as the dashboard dataset "deck_pipeline".
WITH deck (ord, deal, deck_note, est_low, est_high, deal_id) AS (VALUES
  (1, 'Hestan Culinary & Commercial', 'DSP upsell', 2000, 3000, 59419452835), (1, 'Hestan Culinary & Commercial', 'DSP upsell', 2000, 3000, 59418612647),
  (2, 'Stock Yards Bank & Trust', 'UDS introduction', 1250, 2500, 61035360680),
  (3, 'Atria Senior Living', 'UDS introduction', 1000, 5000, 59185298502),
  (4, 'Plymouth Rock', 'Direct', 1250, 2500, 61182984838),
  (5, 'South Street Partners', 'Upsell, $250 per property across 17 properties', 3000, 3000, 60036793728),
  (6, 'Fischer Homes', 'Direct', 5000, 5000, 45652163249),
  (7, 'Floor Coverings International', 'Direct', 5000, 5000, 53754289046),
  (8, 'Atlas World Group', 'Direct', 2500, 5000, 62115545936),
  (9, 'L2T', 'Intent upsell', 2500, 5000, 64519479692),
  (10, 'Liberty Mutual', 'Direct', 10000, 12500, 51446647866),
  (11, 'Auctic', 'UDS introduction', 5000, 5000, 59185237356))
SELECT k.ord, k.deal, k.deck_note, k.est_low, k.est_high,
       string_agg(DISTINCT CASE d.deal_pipeline_id WHEN '772338804' THEN 'Opportunity' WHEN '785877425' THEN 'Enterprise' ELSE 'Upsell' END || ': ' || ps.label, '; ') AS stage_now,
       bool_and(ps.is_closed) AS is_closed,
       bool_or(ps.label = 'Closed Won') AS is_won,
       SUM(CASE WHEN ps.is_closed AND ps.label <> 'Closed Won' THEN 0 ELSE COALESCE(d.property_amount, 0) END) AS value_now,
       to_char(MAX(d.property_closedate)::date, 'YYYY-MM-DD') AS close_date
FROM deck k
LEFT JOIN hubspot.deal d ON d.deal_id = k.deal_id AND NOT COALESCE(d.is_deleted, false) AND NOT COALESCE(d._fivetran_deleted, false)
LEFT JOIN hubspot.deal_pipeline_stage ps ON ps.stage_id = d.deal_pipeline_stage_id
GROUP BY 1, 2, 3, 4, 5 ORDER BY 1

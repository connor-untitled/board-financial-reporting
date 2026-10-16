-- Pipeline waterfall by month: open pipeline value at each month end and what moved it
-- Rebuilt from HubSpot's change history (deal_property_history for pipeline and amount, deal_stage for stage), so each month
-- foots: beginning + created + reopened or moved in + value increases - value decreases - won - lost - moved out = ending.
-- Pipelines: Opportunity, Enterprise and Expansion, plus the deprecated New Resellers and New Direct pipelines they replaced.
-- Block: Expansion for the Expansion pipeline, otherwise the deal's current account type (its history only starts August 2025),
-- or, with none set, the deprecated New Resellers or New Direct pipeline the deal sat in.
-- Won and lost carry the value at close; value changes in the closing month count as increases or decreases.
-- Metabase, database 2 ("Untitled Internal"). Stored as the dashboard dataset "pipeline_waterfall".
WITH months AS (
  SELECT m::date AS month, (m AT TIME ZONE 'America/New_York') AS t0, ((m + interval '1 month') AT TIME ZONE 'America/New_York') AS t1
  FROM generate_series(timestamp '2025-01-01', timestamp '2026-09-01', interval '1 month') m
), tracked AS (SELECT unnest(ARRAY['772338804', '785877425', '99167368', '70240851', '9e6dd25b-f6c2-4087-9e73-cc022106955d']) AS pid),
stg AS (SELECT stage_id, CASE WHEN label = 'Closed Won' THEN 'won' WHEN label = 'Closed Lost' THEN 'lost' ELSE 'open' END AS cls FROM hubspot.deal_pipeline_stage),
deals AS (
  SELECT d.deal_id, d.property_createdate AS created, d.property_amount AS amount_now, d.deal_pipeline_id AS pipeline_now,
         CASE WHEN d.property_account_type IN ('Direct', 'Brand of Brands') THEN 'Direct'
              WHEN d.property_account_type IN ('Agency (Reseller)', 'Agency (Integration)') THEN 'Reseller'
              WHEN EXISTS (SELECT 1 FROM hubspot.deal_property_history h WHERE h.deal_id = d.deal_id AND h.name = 'deal_pipeline_id' AND h.value = '70240851') THEN 'Reseller'
              WHEN EXISTS (SELECT 1 FROM hubspot.deal_property_history h WHERE h.deal_id = d.deal_id AND h.name = 'deal_pipeline_id' AND h.value = '9e6dd25b-f6c2-4087-9e73-cc022106955d') THEN 'Direct'
              ELSE 'Not yet tagged' END AS acct
  FROM hubspot.deal d
  WHERE NOT COALESCE(d.is_deleted, false) AND NOT COALESCE(d._fivetran_deleted, false) AND d.deal_id NOT IN (63450358167)
    AND EXISTS (SELECT 1 FROM hubspot.deal_property_history h JOIN tracked ON tracked.pid = h.value WHERE h.deal_id = d.deal_id AND h.name = 'deal_pipeline_id')
), piv AS (SELECT h.deal_id, h.value, h.timestamp AS a, LEAD(h.timestamp) OVER (PARTITION BY h.deal_id ORDER BY h.timestamp) AS z
  FROM hubspot.deal_property_history h JOIN deals USING (deal_id) WHERE h.name = 'deal_pipeline_id'
), aiv AS (SELECT h.deal_id, NULLIF(h.value, '')::numeric AS value, h.timestamp AS a, LEAD(h.timestamp) OVER (PARTITION BY h.deal_id ORDER BY h.timestamp) AS z
  FROM hubspot.deal_property_history h JOIN deals USING (deal_id) WHERE h.name = 'amount'
), siv AS (SELECT ds.deal_id, s.cls AS value, ds.date_entered AS a, LEAD(ds.date_entered) OVER (PARTITION BY ds.deal_id ORDER BY ds.date_entered) AS z
  FROM hubspot.deal_stage ds JOIN deals USING (deal_id) JOIN stg s ON s.stage_id = ds.value
), cut AS (SELECT DISTINCT t0 AS t FROM months UNION SELECT t1 FROM months),
state AS (
  SELECT c.t, dl.deal_id, p.value AS pid, st.value AS cls, COALESCE(am.value, 0) AS amt
  FROM cut c JOIN deals dl ON dl.created < c.t
  LEFT JOIN piv p ON p.deal_id = dl.deal_id AND p.a < c.t AND (p.z IS NULL OR p.z >= c.t)
  LEFT JOIN siv st ON st.deal_id = dl.deal_id AND st.a < c.t AND (st.z IS NULL OR st.z >= c.t)
  LEFT JOIN aiv am ON am.deal_id = dl.deal_id AND am.a < c.t AND (am.z IS NULL OR am.z >= c.t)
), mv AS (
  SELECT m.month, dl.deal_id, CASE WHEN COALESCE(e.pid, b.pid) = '99167368' THEN 'Expansion' ELSE dl.acct END AS block,
    (b.pid IN (SELECT pid FROM tracked) AND b.cls = 'open') AS ob, COALESCE(b.amt, 0) AS ab,
    (e.pid IN (SELECT pid FROM tracked) AND e.cls = 'open') AS oe, e.amt AS ae, e.cls AS ce, (e.pid IN (SELECT pid FROM tracked)) AS te,
    (dl.created >= m.t0) AS new_in_month
  FROM months m JOIN deals dl ON dl.created < m.t1
  JOIN state e ON e.deal_id = dl.deal_id AND e.t = m.t1
  LEFT JOIN state b ON b.deal_id = dl.deal_id AND b.t = m.t0
)
SELECT to_char(month, 'YYYY-MM') AS month, block,
  ROUND(SUM(CASE WHEN ob THEN ab ELSE 0 END)) AS beginning,
  ROUND(SUM(CASE WHEN NOT COALESCE(ob, false) AND new_in_month AND te AND (oe OR ce IN ('won', 'lost')) THEN ae ELSE 0 END)) AS created,
  ROUND(SUM(CASE WHEN NOT COALESCE(ob, false) AND NOT new_in_month AND oe THEN ae ELSE 0 END)) AS moved_in,
  ROUND(SUM(CASE WHEN ob AND (oe OR (te AND ce IN ('won', 'lost'))) AND ae > ab THEN ae - ab ELSE 0 END)) AS increase,
  ROUND(SUM(CASE WHEN ob AND (oe OR (te AND ce IN ('won', 'lost'))) AND ae < ab THEN ab - ae ELSE 0 END)) AS decrease,
  ROUND(SUM(CASE WHEN (ob OR new_in_month) AND te AND ce = 'won' THEN ae ELSE 0 END)) AS won,
  ROUND(SUM(CASE WHEN (ob OR new_in_month) AND te AND ce = 'lost' THEN ae ELSE 0 END)) AS lost,
  ROUND(SUM(CASE WHEN ob AND NOT oe AND NOT (te AND ce IN ('won', 'lost')) THEN ab ELSE 0 END)) AS moved_out,
  ROUND(SUM(CASE WHEN oe THEN ae ELSE 0 END)) AS ending,
  SUM(CASE WHEN NOT COALESCE(ob, false) AND new_in_month AND te AND (oe OR ce IN ('won', 'lost')) THEN 1 ELSE 0 END) AS created_deals,
  SUM(CASE WHEN (ob OR new_in_month) AND te AND ce = 'won' THEN 1 ELSE 0 END) AS won_deals,
  SUM(CASE WHEN (ob OR new_in_month) AND te AND ce = 'lost' THEN 1 ELSE 0 END) AS lost_deals
FROM mv
GROUP BY 1, 2
HAVING SUM(CASE WHEN ob OR oe OR new_in_month THEN 1 ELSE 0 END) > 0
ORDER BY 1, 2

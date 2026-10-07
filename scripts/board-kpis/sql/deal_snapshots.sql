-- Month-boundary snapshots of every deal in the Opportunity (772338804),
-- Enterprise (785877425) and Expansion (99167368) pipelines.
--
-- Run in Metabase, database "Untitled Internal" (the Fivetran sync of
-- HubSpot), and save the rows to .board-kpis/deal_snapshots.json. HubSpot's
-- own API has no history, so this is the only way to see what a deal looked
-- like at a past month end.
--
-- One row per deal per boundary (midnight New York on the 1st) where the deal
-- was then in one of the three pipelines (or open in Qualification and in one
-- of the three today) and either open or closed during the month just ended.
-- current_pipeline is the deal's pipeline today: pipeline.py places deals by
-- it, as HubSpot's historical snapshot report filters on today's pipeline. A closure only counts when the stage before it was in one
-- of the three pipelines or Qualification (768262977): on 2026-07-27 about
-- 1,500 legacy deals from the deprecated pipelines were bulk-moved straight
-- into Opportunity Closed Won/Lost, which is a cleanup, not a month's
-- activity. "During the month" runs from the previous boundary, both at
-- midnight New York, so months across a daylight-saving change neither
-- overlap nor leave a gap.
-- {{first}} and {{last}} are the first and last boundary,
-- e.g. 2026-06-01 and 2026-10-01: replace them before running.
WITH b AS (
  SELECT (d::date::timestamp AT TIME ZONE 'America/New_York') AS t,
         ((d - INTERVAL '1 month')::date::timestamp AT TIME ZONE 'America/New_York') AS prior
  FROM generate_series(DATE '{{first}}', DATE '{{last}}', INTERVAL '1 month') d
),
history AS (
  SELECT deal_id, value, date_entered,
         LAG(value) OVER (PARTITION BY deal_id ORDER BY date_entered) AS previous
  FROM hubspot.deal_stage
),
stage AS (
  SELECT DISTINCT ON (b.t, s.deal_id) b.t, b.prior, s.deal_id, s.value AS stage, s.date_entered, s.previous
  FROM b JOIN history s ON s.date_entered < b.t
  ORDER BY b.t, s.deal_id, s.date_entered DESC
),
amount AS (
  SELECT DISTINCT ON (b.t, p.deal_id) b.t, p.deal_id, p.value AS amount
  FROM b JOIN hubspot.deal_property_history p ON p.name = 'amount' AND p.timestamp < b.t
  ORDER BY b.t, p.deal_id, p.timestamp DESC
),
acct AS (
  SELECT DISTINCT ON (b.t, p.deal_id) b.t, p.deal_id, p.value AS account_type
  FROM b JOIN hubspot.deal_property_history p ON p.name = 'account_type' AND p.timestamp < b.t
  ORDER BY b.t, p.deal_id, p.timestamp DESC
)
SELECT to_char(stage.t AT TIME ZONE 'America/New_York', 'YYYY-MM-DD') AS boundary,
       d.deal_id, d.property_dealname AS name,
       to_char(d.property_createdate AT TIME ZONE 'America/New_York', 'YYYY-MM-DD') AS created,
       COALESCE(d.is_deleted, false) OR COALESCE(d._fivetran_deleted, false) AS deleted,
       ps.pipeline_id AS pipeline, ps.label AS stage, ps.is_closed AS closed,
       ps.probability AS probability,
       to_char(stage.date_entered AT TIME ZONE 'America/New_York', 'YYYY-MM-DD') AS stage_entered,
       NULLIF(amount.amount, '')::numeric AS amount,
       COALESCE(acct.account_type, d.property_account_type) AS account_type,
       d.property_account_type AS current_account_type,
       d.deal_pipeline_id AS current_pipeline
FROM stage
JOIN hubspot.deal d ON d.deal_id = stage.deal_id
JOIN hubspot.deal_pipeline_stage ps ON ps.stage_id = stage.stage
LEFT JOIN amount ON amount.t = stage.t AND amount.deal_id = stage.deal_id
LEFT JOIN acct ON acct.t = stage.t AND acct.deal_id = stage.deal_id
LEFT JOIN hubspot.deal_pipeline_stage prev ON prev.stage_id = stage.previous
WHERE (ps.pipeline_id IN ('772338804', '785877425', '99167368')
       OR (ps.pipeline_id = '768262977' AND NOT ps.is_closed
           AND d.deal_pipeline_id IN ('772338804', '785877425', '99167368')))
  AND (NOT ps.is_closed
       OR (stage.date_entered >= stage.prior
           AND (stage.previous IS NULL
                OR prev.pipeline_id IN ('772338804', '785877425', '99167368', '768262977'))))
ORDER BY 1, 2

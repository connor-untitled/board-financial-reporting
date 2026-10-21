-- Snowflake port of mrr.py build() for the CFO.ai saved query "Stripe Customer MRR by Month"
-- (Stripe#c4a connection). Keep in step with config.json: excluded, services and
-- client-account products, and the arrears customer list. Not ported: fill_pending,
-- the newest-month carry-forward, so the query loads closed months only.
WITH inv AS (
  SELECT ID, CUSTOMER_ID, BILLING_REASON
  FROM STRIPE_C4A891A5_43A9_494D_BEB5_EF9FE2D75C3D.INVOICE
  WHERE LIVEMODE = TRUE AND COALESCE(IS_DELETED, FALSE) = FALSE AND COALESCE(STATUS, '') <> 'void'
),
subs AS (
  SELECT ID, MAX(ENDED_AT) AS ended_at
  FROM STRIPE_C4A891A5_43A9_494D_BEB5_EF9FE2D75C3D.SUBSCRIPTION_HISTORY
  WHERE _FIVETRAN_ACTIVE = TRUE
  GROUP BY ID
),
prod AS (
  SELECT p.ID AS price_id, pr.NAME AS product
  FROM STRIPE_C4A891A5_43A9_494D_BEB5_EF9FE2D75C3D.PRICE p
  LEFT JOIN STRIPE_C4A891A5_43A9_494D_BEB5_EF9FE2D75C3D.PRODUCT pr ON pr.ID = p.PRODUCT_ID
),
disc AS (
  SELECT TYPE_ID AS line_id, SUM(AMOUNT) AS amt
  FROM STRIPE_C4A891A5_43A9_494D_BEB5_EF9FE2D75C3D.DISCOUNT
  WHERE TYPE = 'PARENT_INVOICE_LINE_ITEM'
  GROUP BY 1
),
raw AS (
  SELECT i.CUSTOMER_ID AS cid, i.BILLING_REASON AS br, l.SUBSCRIPTION_ID AS sub,
         COALESCE(l.SUBSCRIPTION_ITEM_ID, l.ID) AS item, COALESCE(pr.product, '') AS product,
         l.PERIOD_START AS ps, l.PERIOD_END AS pe, l.AMOUNT AS gross,
         (l.AMOUNT - COALESCE(d.amt, 0)) / 100.0 AS net, COALESCE(l.PRORATION, FALSE) AS proration
  FROM STRIPE_C4A891A5_43A9_494D_BEB5_EF9FE2D75C3D.INVOICE_LINE_ITEM l
  JOIN inv i ON i.ID = l.INVOICE_ID
  LEFT JOIN prod pr ON pr.price_id = l.PRICE_ID
  LEFT JOIN disc d ON d.line_id = l.ID
  WHERE l.TYPE = 'subscription' AND l.LIVEMODE = TRUE
),
lines AS (
  SELECT *, IFF(DATEDIFF('second', ps, pe) / 86400.0 <= 40, 1,
                GREATEST(1, ROUND(DATEDIFF('second', ps, pe) / 86400.0 / 30.4))) AS k
  FROM raw
  WHERE proration = FALSE
    AND product NOT IN ('Untitled - Free Trial', 'Consumption Fees', 'Lead Data Stream Consumption Fees')
),
gen AS (SELECT ROW_NUMBER() OVER (ORDER BY SEQ4()) - 1 AS n FROM TABLE(GENERATOR(ROWCOUNT => 36))),
expanded AS (
  SELECT l.cid, l.sub, l.item, l.product, l.br,
         DATEADD('month', g.n, DATE_TRUNC('month', l.ps))::DATE AS m0, l.net / l.k AS amt
  FROM lines l JOIN gen g ON g.n < l.k
),
shifted AS (
  SELECT e.cid, e.sub, e.item, e.amt, e.product = 'Shopify Development' AS svc,
         IFF((e.cid IN ('cus_T6PHyFO313HJe5', 'cus_QjyLCnr4Mr6ZAP', 'cus_Rm8zdZyXFGpzh1', 'cus_T9pzaD0l2hkCsJ',
                        'cus_Ryif9NgssRyvwz', 'cus_PwRzcOqEuZYjlT', 'cus_QNQneDMHvwGAnv', 'cus_QgxwXbykpZxcFc',
                        'cus_RxdB9CpTzSuQ0z', 'cus_PodEbqNL4Vbl6j', 'cus_T2113bqX3VYv7z', 'cus_ShjJraYEvcjNxL')
              AND e.product <> 'Shopify Development')
             OR (e.product = 'Untitled Client Accounts' AND COALESCE(e.br, '') <> 'subscription_create'),
             DATEADD('month', -1, e.m0), e.m0)::DATE AS m
  FROM expanded e
),
kept AS (
  SELECT s.* FROM shifted s LEFT JOIN subs ON subs.ID = s.sub
  WHERE subs.ended_at IS NULL OR s.m < DATE_TRUNC('month', subs.ended_at)::DATE
),
best AS (
  SELECT cid, item, m, MAX_BY(sub, amt) AS sub, MAX(amt) AS amt, MAX_BY(svc, amt) AS svc
  FROM kept GROUP BY 1, 2, 3
),
by_sub AS (SELECT sub, m, SUM(amt) AS amt FROM best GROUP BY 1, 2),
partial AS (
  SELECT DISTINCT cid, sub, DATE_TRUNC('month', ps)::DATE AS m FROM raw
  WHERE proration = TRUE AND br = 'subscription_create' AND sub IS NOT NULL AND gross > 0
),
partial_add AS (
  SELECT p.cid, p.m, nx.amt
  FROM partial p
  LEFT JOIN subs ON subs.ID = p.sub
  LEFT JOIN by_sub cur ON cur.sub = p.sub AND cur.m = p.m
  JOIN by_sub nx ON nx.sub = p.sub AND nx.m = DATEADD('month', 1, p.m)
  WHERE (subs.ended_at IS NULL OR p.m < DATE_TRUNC('month', subs.ended_at)::DATE)
    AND COALESCE(cur.amt, 0) = 0 AND nx.amt > 0
),
cust AS (
  SELECT cid, m, SUM(amt) AS mrr, SUM(IFF(svc, amt, 0)) AS services
  FROM (SELECT cid, m, amt, svc FROM best UNION ALL SELECT cid, m, amt, FALSE FROM partial_add)
  GROUP BY 1, 2
),
named AS (
  SELECT c.cid, COALESCE(NULLIF(TRIM(k.NAME), ''), c.cid) AS cname,
         COALESCE(k.METADATA:client_type::TEXT, 'Untagged') AS channel, c.m, c.mrr, c.services
  FROM cust c LEFT JOIN STRIPE_C4A891A5_43A9_494D_BEB5_EF9FE2D75C3D.CUSTOMER k ON k.ID = c.cid
  WHERE c.m >= '2025-01-01' AND c.m < DATE_TRUNC('month', CURRENT_DATE()) AND ABS(c.mrr) > 0.005
)
SELECT
  m AS "Date",
  CAST(cid AS TEXT) AS "Stripe Customer ID",
  cname AS "Stripe Customer",
  channel AS "Stripe Client Type",
  ROUND(mrr, 2) AS "Stripe Customer MRR",
  ROUND(services, 2) AS "Stripe Services MRR"
FROM named

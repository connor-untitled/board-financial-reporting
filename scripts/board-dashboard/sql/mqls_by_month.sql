-- MQLs by month and source
-- New HubSpot contacts per month since January 2025 by analytics source, excluding gmail.com; the definition of Metabase question 139. Reads hubspot.contact.
-- Metabase, database 2 ("Untitled Internal"). Stored as the dashboard dataset "mqls".
SELECT to_char(DATE_TRUNC('month', property_createdate AT TIME ZONE 'America/New_York'), 'YYYY-MM') AS month,
       CASE property_hs_analytics_source WHEN 'ORGANIC_SEARCH' THEN 'Organic search' WHEN 'PAID_SEARCH' THEN 'Paid search'
            WHEN 'EMAIL_MARKETING' THEN 'Email marketing' WHEN 'PAID_SOCIAL' THEN 'Paid social'
            WHEN 'SOCIAL_MEDIA' THEN 'Organic social' WHEN 'AI_REFERRALS' THEN 'AI referrals' END AS source,
       COUNT(DISTINCT id) AS mqls
FROM hubspot.contact
WHERE property_hs_analytics_source IN ('ORGANIC_SEARCH', 'PAID_SEARCH', 'EMAIL_MARKETING', 'PAID_SOCIAL', 'SOCIAL_MEDIA', 'AI_REFERRALS')
  AND (property_hs_email_domain IS NULL OR property_hs_email_domain NOT ILIKE '%gmail.com%')
  AND property_createdate >= TIMESTAMP '2025-01-01 00:00:00' AT TIME ZONE 'America/New_York'
GROUP BY 1, 2 ORDER BY 1, 2

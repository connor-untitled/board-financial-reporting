-- Churn reasons recorded on HubSpot companies
-- Every company with a churn reason: name, domain, the reason as written and the churn date. The dashboard matches these to
-- Stripe cancellations by domain, then by name, and prefers them over the churn log's own note.
-- Metabase, database 2 ("Untitled Internal"). Stored as the dashboard dataset "churn_reasons".
SELECT property_name AS name, property_domain AS domain, property_churn_reason AS churn_reason,
       to_char(property_churn_date::date, 'YYYY-MM-DD') AS churn_date
FROM hubspot.company
WHERE NOT COALESCE(is_deleted, false) AND property_churn_reason IS NOT NULL
ORDER BY property_churn_date

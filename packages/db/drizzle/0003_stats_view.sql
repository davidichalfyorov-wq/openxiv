-- Public stats dashboard — materialised view aggregating disclosures across
-- the published corpus. Refreshed hourly by the stats cron worker.
DROP MATERIALIZED VIEW IF EXISTS "stats_disclosure_overview" CASCADE;

CREATE MATERIALIZED VIEW "stats_disclosure_overview" AS
WITH base AS (
  SELECT
    p.id           AS paper_id,
    p.primary_category,
    p.published_at,
    d.level,
    d.ai_used,
    d.models,
    d.summary_ai_generated
  FROM papers p
  LEFT JOIN disclosures d ON d.paper_id = p.id
  WHERE p.status = 'published'
)
SELECT
  COUNT(*) FILTER (WHERE level IS NOT NULL) AS papers_with_disclosure,
  COUNT(*) FILTER (WHERE level IS NULL) AS papers_without_disclosure,
  COUNT(*) FILTER (WHERE level = 'none') AS level_none,
  COUNT(*) FILTER (WHERE level = 'assistant') AS level_assistant,
  COUNT(*) FILTER (WHERE level = 'coauthor') AS level_coauthor,
  COUNT(*) FILTER (WHERE level = 'primary') AS level_primary,
  COUNT(*) FILTER (WHERE summary_ai_generated) AS summaries_ai_generated,
  COUNT(*) AS papers_total
FROM base;

CREATE MATERIALIZED VIEW "stats_disclosure_by_category" AS
SELECT
  p.primary_category AS category,
  COUNT(*) AS papers_total,
  COUNT(*) FILTER (WHERE d.level = 'none')      AS level_none,
  COUNT(*) FILTER (WHERE d.level = 'assistant') AS level_assistant,
  COUNT(*) FILTER (WHERE d.level = 'coauthor')  AS level_coauthor,
  COUNT(*) FILTER (WHERE d.level = 'primary')   AS level_primary
FROM papers p
LEFT JOIN disclosures d ON d.paper_id = p.id
WHERE p.status = 'published'
GROUP BY p.primary_category
ORDER BY papers_total DESC;

CREATE MATERIALIZED VIEW "stats_disclosure_ai_used" AS
SELECT
  ai_use AS ai_use,
  COUNT(*) AS papers
FROM disclosures d
JOIN papers p ON p.id = d.paper_id
JOIN LATERAL jsonb_array_elements_text(d.ai_used) AS ai_use ON true
WHERE p.status = 'published'
GROUP BY ai_use
ORDER BY papers DESC;

CREATE MATERIALIZED VIEW "stats_disclosure_models" AS
SELECT
  model_obj->>'name' AS model_name,
  model_obj->>'vendor' AS model_vendor,
  COUNT(*) AS papers
FROM disclosures d
JOIN papers p ON p.id = d.paper_id
JOIN LATERAL jsonb_array_elements(d.models) AS model_obj ON true
WHERE p.status = 'published'
  AND (model_obj->>'name') IS NOT NULL
GROUP BY model_name, model_vendor
ORDER BY papers DESC, model_name ASC;

CREATE MATERIALIZED VIEW "stats_disclosure_weekly" AS
SELECT
  date_trunc('week', p.published_at) AS week,
  COUNT(*) AS papers_total,
  COUNT(*) FILTER (WHERE d.level = 'none')      AS level_none,
  COUNT(*) FILTER (WHERE d.level = 'assistant') AS level_assistant,
  COUNT(*) FILTER (WHERE d.level = 'coauthor')  AS level_coauthor,
  COUNT(*) FILTER (WHERE d.level = 'primary')   AS level_primary
FROM papers p
LEFT JOIN disclosures d ON d.paper_id = p.id
WHERE p.status = 'published' AND p.published_at IS NOT NULL
GROUP BY week
ORDER BY week DESC
LIMIT 52;

CREATE MATERIALIZED VIEW "stats_detector_flags" AS
SELECT
  COUNT(*) FILTER (WHERE score >= 65) AS flagged_above_threshold,
  COUNT(*) AS total_scored,
  COALESCE(ROUND(AVG(score)::numeric, 2), 0) AS avg_score,
  COALESCE(MIN(score), 0) AS min_score,
  COALESCE(MAX(score), 0) AS max_score
FROM ai_detector_scores;

-- Refresh helper. Workers call SELECT refresh_stats(); hourly.
CREATE OR REPLACE FUNCTION refresh_stats() RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW "stats_disclosure_overview";
  REFRESH MATERIALIZED VIEW "stats_disclosure_by_category";
  REFRESH MATERIALIZED VIEW "stats_disclosure_ai_used";
  REFRESH MATERIALIZED VIEW "stats_disclosure_models";
  REFRESH MATERIALIZED VIEW "stats_disclosure_weekly";
  REFRESH MATERIALIZED VIEW "stats_detector_flags";
END;
$$ LANGUAGE plpgsql;

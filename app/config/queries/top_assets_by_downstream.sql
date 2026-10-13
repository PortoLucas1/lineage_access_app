-- Top assets by downstream count — mv_exec_revenue_daily is the clear
-- outlier at the top (its 18-asset fan-out).
-- @param catalog STRING = solution_builder
-- @param schema STRING = demo_lineage_access_for_every_team_b89e91
SELECT
  asset_name,
  asset_type,
  CAST(downstream_count AS BIGINT) AS downstream_count,
  CAST(COALESCE(blast_radius_usd, 0) AS BIGINT) AS blast_radius_usd
FROM IDENTIFIER(:catalog || '.' || :schema || '.gold_assets')
WHERE downstream_count > 0
ORDER BY downstream_count DESC
LIMIT 12

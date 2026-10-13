-- PII assets ranked by principals-with-access.
-- @param catalog STRING = solution_builder
-- @param schema STRING = demo_lineage_access_for_every_team_b89e91
SELECT
  asset_name,
  criticality,
  CAST(principals_with_access AS BIGINT) AS principals_with_access
FROM IDENTIFIER(:catalog || '.' || :schema || '.gold_assets')
WHERE has_pii = true
ORDER BY principals_with_access DESC
LIMIT 12

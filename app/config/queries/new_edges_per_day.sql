-- New lineage edges per day (last 120 days) — baseline churn vs the
-- mv_exec_revenue_daily fan-out. The 18-edge burst ~3 weeks ago shows a
-- clear 3-4x spike over the ~2-5/day baseline, then decays.
-- Tables referenced via IDENTIFIER(:catalog||'.'||:schema||'.t') so the
-- query resolves on any workspace; :catalog/:schema are bound at runtime.
-- @param catalog STRING = solution_builder
-- @param schema STRING = demo_lineage_access_for_every_team_b89e91
SELECT
  date AS event_date,
  CAST(new_edges AS BIGINT) AS new_edges,
  CAST(new_edges_from_mv AS BIGINT) AS new_edges_from_mv
FROM IDENTIFIER(:catalog || '.' || :schema || '.gold_lineage_events_daily')
WHERE date >= date_sub(current_date(), 120)
ORDER BY date

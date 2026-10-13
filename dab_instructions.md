# Deploy — Northpeak Retail Lineage & Access Console

A Databricks Asset Bundle that re-creates the whole demo on any workspace: a UC
schema, the synthetic governance graph, an AI/BI dashboard, a Genie space, and
the Lakebase-backed Databricks App.

## Prerequisites
- Databricks CLI **v0.283.0+** (dashboard `dataset_catalog`/`dataset_schema` rebinding).
- A running SQL warehouse (its id → `--var warehouse_id`).
- Authenticated CLI profile (`databricks auth login` / `--profile <name>`).

## The 5-command deploy

```bash
# 1. Lakebase DB (pre-deploy — the CLI can't declare a postgres database)
./app/scripts/lakebase_setup_db.sh --db-name dbgen_lineage_access

# 2. Create resource shells (schema, dashboard, app) + the setup job
databricks bundle deploy \
  --var catalog=solution_builder \
  --var schema=demo_lineage_access_for_every_team_b89e91 \
  --var warehouse_id=<WAREHOUSE_ID>

# 3. Run the setup job (generate data → deploy Genie → grant app SP → export IDs)
databricks bundle run lineage_access_setup \
  --var catalog=solution_builder \
  --var schema=demo_lineage_access_for_every_team_b89e91 \
  --var warehouse_id=<WAREHOUSE_ID>

# 4. Grant the app SP on the Lakebase (Postgres) schemas
./app/scripts/lakebase_grant_app_credential.sh \
  --app-name dbgen-lineage-access \
  --project-id dbdemos-asset-generator \
  --db-name dbgen_lineage_access

# 5. Harvest the resolved IDs → write app.yaml env → deploy the app
./app/scripts/finalize_app.sh
```

Why the app env is finalized outside the bundle (steps 3+5): the Genie space id
only exists AFTER the setup job runs, so the bundle can't know it at `deploy`
time. The job's final task (`export_resources`) exits a JSON manifest of every
resolved id; `finalize_app.sh` reads it back and writes `app.yaml`'s env.

## Re-runs
- After an **app content** change: re-run steps 2 + 5.
- After a **data / resource** change: re-run steps 2 + 3 + 5.
All steps are idempotent (Genie updates in place; the schema/dashboard rebind).

## Teardown
```bash
databricks bundle destroy --auto-approve
```
Does not drop the Lakebase project/DB, the UC catalog, or the Genie space
(stateful; the app is `prevent_destroy: true`).

## Notes
- `--var catalog/schema/warehouse_id` are shown with this project's defaults;
  override for another workspace. In `dev` mode the schema is prefixed
  `dev_<user>_` and tasks resolve it through the schema resource so data-gen,
  dashboard, and Genie all agree on the same target.
- No SDP pipeline, ML, Knowledge Assistant, or Multi-Agent Supervisor in this
  demo — the setup job is just data-gen → Genie → grants → export.

# Deploy — Lineage & Access Console

A Databricks Asset Bundle that creates a Unity Catalog schema, optional gold
governance tables, an AI/BI dashboard, a Genie space, and the Lakebase-backed
Databricks App. Override catalog, schema, warehouse, and app names per
workspace — none of the required values are tied to a specific customer.

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
  --var catalog=<YOUR_CATALOG> \
  --var schema=<YOUR_SCHEMA> \
  --var warehouse_id=<WAREHOUSE_ID>

# 3. Run the setup job (generate data → deploy Genie → grant app SP → export IDs)
databricks bundle run lineage_access_setup \
  --var catalog=<YOUR_CATALOG> \
  --var schema=<YOUR_SCHEMA> \
  --var warehouse_id=<WAREHOUSE_ID>

# 4. Grant the app SP on the Lakebase (Postgres) schemas
./app/scripts/lakebase_grant_app_credential.sh \
  --app-name dbgen-lineage-access \
  --project-id <YOUR_LAKEBASE_PROJECT> \
  --db-name dbgen_lineage_access

# 5. Harvest the resolved IDs → write app.yaml env → deploy the app
./app/scripts/finalize_app.sh
```

Why the app env is finalized outside the bundle (steps 3+5): the Genie space id
only exists AFTER the setup job runs, so the bundle can't know it at `deploy`
time. The job's final task (`export_resources`) exits a JSON manifest of every
resolved id; `finalize_app.sh` reads it back and writes `app.yaml`'s env.

Set `DEMO_CATALOG` / `DEMO_SCHEMA` (and optionally `TERRAFORM_*`) in `app.yaml`
to the catalog and schema you want the explorer to open on. Those are
environment values, not source defaults.

## App-only updates

After the first deploy, iterating on the React/Node app does **not** require
`databricks bundle deploy` (that recreates the UC schema). Prefer:

```bash
./app/scripts/build-app.sh
databricks bundle sync -t prod --full --var warehouse_id=<WAREHOUSE_ID>
databricks apps deploy <APP_NAME> --source-code-path <BUNDLE_FILES>/app
```

## Re-runs
- After an **app content** change: rebuild + sync + `apps deploy`.
- After a **data / resource** change: re-run steps 2 + 3 + 5.
All steps are idempotent (Genie updates in place; the schema/dashboard rebind).

## Teardown
```bash
databricks bundle destroy --auto-approve
```
Does not drop the Lakebase project/DB, the UC catalog, or the Genie space
(stateful; the app is `prevent_destroy: true`).

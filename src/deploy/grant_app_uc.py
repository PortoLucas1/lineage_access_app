# Databricks notebook source
"""
Grant the App's service principal UC read privileges — DAB setup-job task.

The Lineage & Access Console reads the gold_* tables via SQL warehouse (Delta →
Lakebase sync + analytics charts). Without these grants the app's first data
query crashes with INSUFFICIENT_PERMISSIONS: USE CATALOG.

Granted to the app SP:
  - USE_CATALOG on the catalog
  - USE_SCHEMA + SELECT on the schema (covers every gold_*/raw_* read)

No volumes or ML model in this demo, so no READ_VOLUME / EXECUTE grants.
Idempotent — repeated grants no-op.

Parameters: catalog, schema, app_name
"""

# COMMAND ----------

dbutils.widgets.text("catalog", "", "Catalog")
dbutils.widgets.text("schema", "", "Schema")
dbutils.widgets.text("app_name", "", "App name")

catalog = dbutils.widgets.get("catalog")
schema = dbutils.widgets.get("schema")
app_name = dbutils.widgets.get("app_name")
assert catalog and schema and app_name

# COMMAND ----------

from databricks.sdk import WorkspaceClient

w = WorkspaceClient()
app = w.apps.get(name=app_name)
sp_client_id = app.service_principal_client_id
assert sp_client_id, f"App '{app_name}' has no service_principal_client_id"
print(f"App SP: {sp_client_id}")

# COMMAND ----------

grants = [
    f"GRANT USE_CATALOG ON CATALOG {catalog} TO `{sp_client_id}`",
    f"GRANT USE_SCHEMA, SELECT ON SCHEMA {catalog}.{schema} TO `{sp_client_id}`",
]
for stmt in grants:
    print(f"  {stmt}")
    spark.sql(stmt)

print("Grants applied.")

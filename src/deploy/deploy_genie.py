# Databricks notebook source
"""
Deploy the Lineage & Access Genie Space — DAB setup-job task.

Loads the committed serialized-space JSON (src/genie/genie_space.json),
substitutes the authored catalog.schema with the deployed one, then creates or
updates the space via the SDK. Idempotent: searches by title, updates if
present, creates if not.

REQUIRES: databricks-sdk>=0.114.0 (environment_key: sdk_latest).

Parameters (base_parameters): catalog, schema, warehouse_id
Outputs (taskValues): genie_space_id
"""

# COMMAND ----------

SPACE_TITLE = "Lineage & Access Analytics"
SPACE_DESCRIPTION = (
    "Explore the Unity Catalog governance graph — asset lineage, "
    "downstream Tableau and Databricks dashboards, notebooks, and agents, "
    "plus access grants."
)

# The catalog.schema the committed genie_space.json was authored against.
SRC_QUALIFIER = "solution_builder.demo_lineage_access_for_every_team_b89e91"

# COMMAND ----------

dbutils.widgets.text("catalog", "", "Catalog")
dbutils.widgets.text("schema", "", "Schema")
dbutils.widgets.text("warehouse_id", "", "Warehouse ID")

catalog = dbutils.widgets.get("catalog")
schema = dbutils.widgets.get("schema")
warehouse_id = dbutils.widgets.get("warehouse_id")
assert catalog and schema and warehouse_id, "catalog + schema + warehouse_id are required"

print(f"Deploying Genie Space: '{SPACE_TITLE}'  →  {catalog}.{schema}  (wh={warehouse_id})")

# COMMAND ----------

import json
import os
from databricks.sdk import WorkspaceClient

notebook_path = dbutils.notebook.entry_point.getDbutils().notebook().getContext().notebookPath().get()
bundle_root = os.path.dirname(os.path.dirname(os.path.dirname(notebook_path)))
config_path = f"/Workspace{bundle_root}/src/genie/genie_space.json"
print(f"Loading: {config_path}")

with open(config_path) as f:
    serialized = f.read()

DST_QUALIFIER = f"{catalog}.{schema}"
n = serialized.count(SRC_QUALIFIER)
substituted = serialized.replace(SRC_QUALIFIER, DST_QUALIFIER)
print(f"Substituted {n} occurrences of {SRC_QUALIFIER} → {DST_QUALIFIER}")

space_payload = json.loads(substituted)  # validate it still parses
# Genie export protos require stable ordering for these repeated fields.
space_payload["config"]["sample_questions"].sort(key=lambda item: item["id"])
space_payload["data_sources"]["tables"].sort(key=lambda item: item["identifier"])
for table in space_payload["data_sources"]["tables"]:
    table.get("column_configs", []).sort(key=lambda item: item["column_name"])
space_payload["instructions"]["example_question_sqls"].sort(key=lambda item: item["id"])
substituted = json.dumps(space_payload)
print(f"tables: {len(space_payload['data_sources']['tables'])} | "
      f"sample_questions: {len(space_payload['config']['sample_questions'])}")

# COMMAND ----------

w = WorkspaceClient()

existing_id = None
page_token = None
while True:
    resp = w.genie.list_spaces(page_size=200, page_token=page_token)
    for sp in (resp.spaces or []):
        if sp.title == SPACE_TITLE:
            existing_id = sp.space_id
            print(f"Found existing space: {existing_id}")
            break
    if existing_id or not getattr(resp, "next_page_token", None):
        break
    page_token = resp.next_page_token

# COMMAND ----------

if existing_id:
    print(f"Updating space {existing_id}…")
    w.genie.update_space(space_id=existing_id, warehouse_id=warehouse_id, serialized_space=substituted)
    space_id = existing_id
else:
    print("Creating new space…")
    created = w.genie.create_space(
        warehouse_id=warehouse_id,
        title=SPACE_TITLE,
        description=SPACE_DESCRIPTION,
        serialized_space=substituted,
    )
    space_id = created.space_id

print(f"Genie space ready: {space_id}")
dbutils.jobs.taskValues.set(key="genie_space_id", value=space_id)

# Lineage & Access Console

A Databricks App for data-platform and governance teams. Pick any Unity Catalog
table, see **what feeds it**, **what it feeds** (including Databricks AI/BI
dashboards and optional Tableau overlays), and **who can access it**.

The app is tenant-agnostic. Catalog, schema, warehouse, Terraform module path,
and branding all come from environment variables — nothing in the runtime
defaults to a specific customer workspace.

## What you get

| Surface | What it does |
|---|---|
| **Lineage explorer** | Neighborhood graph around a selected table: upstream sources, downstream tables, Databricks dashboards/notebooks/jobs from `system.access.table_lineage`, plus optional Tableau (or other BI) overlays. Expand a table node for column lineage. |
| **Permissions mapping** | Browse users, groups, and service principals; map effective Unity Catalog privileges; compare live grants to a Terraform-declared baseline. |
| **Access panel** | Direct and inherited grants on the selected asset. |
| **Assistant** | Optional Genie-backed dock for “what feeds X / who can access Y”. |

## How it works

```text
Unity Catalog metastore
  ├─ information_schema          → catalogs, schemas, tables (explorer)
  ├─ system.access.table_lineage → table-to-table + entity consumers
  │                                (DASHBOARD_V3, NOTEBOOK, JOB)
  └─ Grants REST API             → effective privileges (permission map)
           │
           ▼
  Databricks App (React + Express on Databricks Apps)
           │
           ├─ Lakeview API        → dashboard display names
           ├─ SCIM                → identities (app service principal)
           ├─ Lakebase (optional) → grant-review flags + audit trail
           └─ terraform/declared-grants.json → declared vs effective drift
```

**Lineage graph.** Selecting a three-level table name (`catalog.schema.table`)
loads a neighborhood from Unity Catalog lineage. The server then attaches BI
consumers:

1. **Databricks dashboards** — rows in `system.access.table_lineage` where
   `entity_type` is `DASHBOARD_V3` / `DASHBOARD`. Names are resolved with
   `GET /api/2.0/lakeview/dashboards/{id}`.
2. **Notebooks and jobs** — same system table, `NOTEBOOK` / `JOB`.
3. **Tableau (and other external BI)** — not stored in Unity Catalog. Add an
   overlay in `app/config/bi-overlays.json`. Patterns can be tenant-agnostic,
   for example `*.rides` matches any catalog/schema whose table name is `rides`.

BI nodes use ids like `bi:dbsql_dashboard:<id>` so grant/column APIs are not
called against them. Table cards show **AI/BI** and **Tableau** chips when
those consumers exist; the node drawer lists them under **BI consumers**.

**Access.** Identities are listed via SCIM. Effective privileges use the Unity
Catalog grants API with the app service principal (Apps OBO does not include
`unity-catalog` / `scim`). Group membership stays on-behalf-of-user.

**Terraform.** `terraform/` is a review-only grant baseline. The Permissions
mapping page shows the module path, catalog, and schema so an operator can copy
a `terraform plan` command. Browser values are local only; the running app
still reads `TERRAFORM_*` / `DEMO_*` env vars.

## Prerequisites

- Databricks CLI **v0.283.0+**
- A SQL warehouse the app can use (`DATABRICKS_WAREHOUSE_ID`)
- An authenticated CLI profile
- Node.js 20+ for local UI work
- Terraform 1.5+ only if you will manage the grant baseline

## Install in your workspace

### 1. Clone and configure

```bash
git clone <this-repo>
cd lineage_access_app
```

Do **not** commit workspace-specific `app.yaml` or production `root_path`
values. Point the app at your catalog with env vars:

| Variable | Required | Meaning |
|---|---|---|
| `DEMO_CATALOG` | Recommended | Catalog the explorer opens on |
| `DEMO_SCHEMA` | Recommended | Schema the explorer opens on |
| `DATABRICKS_WAREHOUSE_ID` | Yes for lineage SQL | Warehouse for `information_schema` / `table_lineage` |
| `DATABRICKS_HOST` | Yes | Workspace host |
| `TERRAFORM_MODULE_PATH` | No | Default `terraform` |
| `TERRAFORM_CATALOG` | No | Falls back to `DEMO_CATALOG` |
| `TERRAFORM_SCHEMA` | No | Falls back to `DEMO_SCHEMA` |
| `GENIE_SPACE_ID` | No | Enables the assistant |

`app/config/app.json` already substitutes these placeholders.

### 2. Local development

```bash
cd app
cp .env.example .env   # if present; otherwise export the vars above
npm install
npm run dev
```

Open the printed local URL. Pick a catalog/schema in the explorer — there is
no hardcoded default table.

### 3. Deploy with Databricks Asset Bundles

See [dab_instructions.md](./dab_instructions.md) for the full five-step path
(Lakebase DB → `bundle deploy` → setup job → Postgres grants → `finalize_app.sh`).

Override every workspace-specific value:

```bash
databricks bundle deploy \
  --var catalog=<YOUR_CATALOG> \
  --var schema=<YOUR_SCHEMA> \
  --var warehouse_id=<WAREHOUSE_ID> \
  --var app_name=<YOUR_APP_NAME>
```

### 4. Terraform grant baseline

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars
# set host, CLI profile, catalog_name, schema_name
# replace declared-grants.json with your catalog grants
terraform init
terraform plan
```

Leave `manage_catalog_grants=false` unless you have reviewed the plan and
want Terraform to become authoritative for those principals. **Do not apply
from automation without a human review.**

In the running app, open **Permissions mapping**. The **Terraform grant
baseline** card lets you record the module path and catalog/schema for the
plan command you will run locally. Save stores the values in this browser
only.

Details: [terraform/README.md](./terraform/README.md).

### 5. Optional: Tableau (or other BI) overlays

Edit `app/config/bi-overlays.json`:

```json
{
  "consumers": [
    {
      "table": "*.rides",
      "kind": "tableau_dashboard",
      "id": "tableau-rides-operations",
      "name": "Rides Operations",
      "platform": "Tableau"
    }
  ]
}
```

`table` may be a full three-level name or `*.<leaf>`. `kind` is one of
`tableau_dashboard`, `dbsql_dashboard`, `notebook`, `workflow`.

Databricks dashboard connections do **not** need an overlay when Unity Catalog
lineage already records `DASHBOARD_V3` consumers.

## App-only updates (already deployed)

`databricks bundle deploy` recreates the UC schema. For app code changes:

```bash
./app/scripts/build-app.sh
databricks bundle sync -t prod --full --var warehouse_id=<WAREHOUSE_ID>
databricks apps deploy <APP_NAME> --source-code-path <bundle-files>/app
```

## Tests

```bash
cd app
npm test
npm run typecheck
```

## Architecture

See [architecture.md](./architecture.md) for the platform diagram (Unity Catalog
+ optional Tableau overlay → lakehouse gold tables → AI/BI + Genie + this app).

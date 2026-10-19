# Lineage & Access Console

A Databricks App for data-platform and governance teams. Pick any Unity Catalog
table, see **what feeds it**, **what it feeds** (including Databricks AI/BI
dashboards and Tableau/other BI tools registered via Unity Catalog External
Lineage), and **who can access it**.

The app is tenant-agnostic. Catalog, schema, warehouse, Terraform module path,
and branding all come from environment variables — nothing in the runtime
defaults to a specific customer workspace.

## What you get

| Surface | What it does |
|---|---|
| **Lineage explorer** | Neighborhood graph around a selected table: upstream sources, downstream tables, Databricks dashboards/notebooks/jobs from `system.access.table_lineage`, plus Tableau (or other BI) connections from Unity Catalog External Lineage. Expand a table node for column lineage. |
| **Permissions mapping** | Browse users, groups, and service principals; map effective Unity Catalog privileges; compare live grants to a Terraform-declared baseline. |
| **Access panel** | Direct and inherited grants on the selected asset — searchable, with "Load more" paging so it stays usable on accounts with thousands of identities. |
| **Assistant** | Optional Genie-backed dock for “what feeds X / who can access Y”. |

## How it works

```text
Unity Catalog metastore
  ├─ information_schema           → catalogs, schemas, tables (explorer)
  ├─ system.access.table_lineage  → table-to-table + native consumers
  │                                 (DASHBOARD_V3, NOTEBOOK, JOB)
  ├─ External Lineage API         → external BI consumers (Tableau, ...)
  │                                 not captured by system.access.* lineage
  └─ Grants REST API              → effective privileges (permission map)
           │
           ▼
  Databricks App (React + Express on Databricks Apps)
           │
           ├─ Lakeview API        → dashboard display names
           ├─ SCIM                → identities (app service principal)
           ├─ Lakebase (optional) → grant-review flags + audit trail
           ├─ terraform/declared-grants.json  → declared vs effective drift
           └─ terraform/external-bi.json      → declared BI connections +
                                                 simulated external-tool access
```

**Lineage graph.** Selecting a three-level table name (`catalog.schema.table`)
loads a neighborhood from Unity Catalog lineage. The server then attaches BI
consumers from three sources:

1. **Databricks dashboards, notebooks, jobs** — rows in
   `system.access.table_lineage` where `entity_type` is `DASHBOARD_V3` /
   `DASHBOARD` / `NOTEBOOK` / `JOB`. Dashboard names are resolved (and cached)
   with `GET /api/2.0/lakeview/dashboards/{id}`.
2. **External BI tools registered in Unity Catalog** — `GET
   /api/2.0/lineage-tracking/external-lineage`, Unity Catalog's
   [External Lineage](https://docs.databricks.com/aws/en/data-governance/unity-catalog/external-lineage)
   API (Public Preview). This is the real, native way to tell Unity Catalog
   "this table is also consumed by Tableau" — external lineage isn't recorded
   in `system.access.*`, so it needs its own lookup. `scripts/register_external_lineage.py`
   is the (idempotent) setup step that creates the External Metadata object +
   lineage relationship; see [Tableau / external BI connections](#5-optional-tableau--external-bi-connections) below.
3. **Local overlay fallback** — `app/config/external-bi.json`. Only used for a
   table that matches an entry's pattern but has *no* real External Lineage
   relationship yet, so you can see the intended graph shape before running
   the registration step.

BI nodes use ids like `bi:dbsql_dashboard:<id>` so grant/column APIs are not
called against them; the node drawer lists them under **BI consumers**.

**Access.** Identities are listed via SCIM. Effective privileges use the Unity
Catalog grants API with the app service principal (Apps OBO does not include
`unity-catalog` / `scim`). Group membership stays on-behalf-of-user. Unity
Catalog has no permission model for an external BI tool's own users, so access
to a Tableau (or other external) node comes from the `access` list declared
alongside it in `external-bi.json` — a declared/simulated manifest, exactly
like `declared-grants.json` is for catalog grants, surfaced read-only in the
access panel.

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

### 5. Optional: Tableau / external BI connections

Databricks dashboard connections need no setup — Unity Catalog lineage already
records `DASHBOARD_V3` consumers. Tableau and other external BI tools aren't
visible to Databricks at all until you tell Unity Catalog about them, via its
[External Lineage](https://docs.databricks.com/aws/en/data-governance/unity-catalog/external-lineage)
feature (Public Preview).

1. Declare the connection in `terraform/external-bi.json` (one entry per
   table↔BI-tool link):

   ```json
   {
     "entities": [
       {
         "id": "tableau-rides-operations",
         "table": "*.rides",
         "kind": "tableau_dashboard",
         "externalMetadataName": "tableau_rides_operations",
         "name": "Rides Operations",
         "platform": "Tableau",
         "systemType": "TABLEAU",
         "entityType": "dashboard",
         "url": "https://tableau.example.com/#/site/acme/views/RidesOperations/Overview",
         "description": "Tableau dashboard that visualizes ride-level metrics.",
         "access": [
           { "principal": "someone@example.com", "role": "Viewer", "grantedBy": "tableau-admin@example.com", "grantedDate": "2026-08-14" }
         ]
       }
     ]
   }
   ```

   `table` may be a full three-level name or `*.<leaf>` for a tenant-agnostic
   match. `access` is who can see the BI tool's own asset — Unity Catalog has
   no permission model for that, so it's a declared manifest the app reads
   directly, not a live lookup.

2. Copy it into the app (kept in sync and checked by `npm run typecheck`):

   ```bash
   cp terraform/external-bi.json app/config/external-bi.json
   ```

3. Register it as real Unity Catalog External Lineage — an External Metadata
   object plus a lineage relationship from the table to it (idempotent, safe
   to re-run):

   ```bash
   python3 app/scripts/register_external_lineage.py \
     --catalog <catalog> --schema <schema> --profile <cli-profile>
   ```

   Or let Terraform do it: set `manage_external_lineage = true` in your
   `terraform.tfvars` and `terraform apply` (gated the same way as
   `manage_catalog_grants` — leave it `false` until you've reviewed what it
   will register).

Until step 3 runs, the app still shows the connection using the
`external-bi.json` entry alone (see "How it works" above) — registering it in
Unity Catalog makes it a real, native lineage fact instead of an app-side
overlay.

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

# App Specification — Lineage Explorer (primary page) + Analytics

> This is the app's **hero page** and its **one visual signature**. The screenshot of the demo recording must read *"this is a data-lineage governance tool"* at a glance — a **graph of connected asset nodes**, not a table with rows. The template's returns-queue page is deleted and replaced by this.

## Lineage Explorer — layout

Three regions on one page:

### 1. KPI cards (top strip, 4 cards)

Reads live from Lakebase (the mirror of `gold_assets` / `gold_access_grants`). Cards tick when the agent writes.

- **Governed Assets** — count of assets. (~320)
- **New Edges (30d)** — new lineage edges this month. (spike-driven)
- **Blast Radius at Risk** — `$` sum of downstream workflow value for the selected asset's sub-graph. (**$250K** when the MV is selected)
- **Principals with PII Access** — distinct principals (expanding group member_count) who can read PII assets on the current sub-graph. (**42** initially; **ticks down** after the agent flags the over-broad grants)

### 2. Lineage graph (center — the hero visualization)

An interactive **directed graph** of the selected asset and its neighborhood. Use a lightweight graph/network renderer (e.g. React Flow / a force or layered DAG layout) — **not** a table.

- **Asset picker** (search/select at top of the graph) — defaults to `mv_exec_revenue_daily` so the demo opens on the story. Selecting an asset re-centers the graph.
- **Nodes** = assets. Left→right layered layout: **upstream sources** on the left → **selected asset** in the center → **downstream consumers** on the right.
  - **Node shape/icon by `asset_type`**: table, materialized_view, view, dbsql_dashboard, **tableau_dashboard** (distinct icon/badge so Tableau nodes are obviously non-Databricks), workflow, notebook.
  - **Node color by `criticality`** (high `#094074` / medium `#5ADBFF` / low `#FFDD4A`) with a **PII badge** on `has_pii` nodes and a **$ badge** on workflow nodes carrying `annual_value_usd`.
  - The selected asset is visually emphasized (ring/glow).
- **Edges** = lineage. Edges created in the MV window (`is_new_from_mv`) render in **orange `#FE9000`** (the "new fan-out"); baseline edges steel blue `#3C6997`. Arrowheads follow flow direction.
- **Column expansion**:
  - Every generated object, including Tableau and AI/BI dashboards, has an expand control. Clicking it grows the node card in place and lists that object's columns/fields.
  - Every object-level edge has an arrow control. Clicking it expands both endpoint cards and overlays the mapped column-to-column lineage between them.
  - Column rows include data type and PII indicators; connector tooltips include the transform expression when present.
- **Selecting `mv_exec_revenue_daily`** lights the full path: `customer_pii` (PII badge, high-criticality) + `orders_gold` on the left → the MV in the center → the **Executive Revenue Tableau dashboard** + **finance_monthly_close ($250K badge)** + the rest of the 18 downstream nodes on the right, edges orange.
- **Clicking any node** opens a **detail drawer** (see below).

### 3. Access panel (right rail)

For the selected asset (or the node clicked in the graph), lists **every principal that can access it**:

- Rows: `display_name` / `principal`, `principal_type` (user / group / service_principal icon), `privilege`, `member_count` (# people for groups), `department`.
- **Over-broad grants** (`is_over_broad = TRUE`) are visually flagged — a red/yellow "Over-broad" chip and sorted to the top. The `all-analysts` (42) → `SELECT` on `customer_pii` grant is the standout.
- After the agent runs, flagged grants gain a **`Flagged for review`** badge and show `reviewed_by`.
- A small header stat: *"N principals can access this asset · M via over-broad grants"*.

### Node detail drawer

Clicking a node opens a drawer with tabs:
- **Overview** — asset_type, catalog.schema, domain, criticality, has_pii, owner, downstream_count, blast_radius_usd, created/last_refreshed.
- **Access** — the grants on this asset (same shape as the right rail).
- **Activity** — the append-only audit timeline (renders from the row's `audit_trail` JSONB) — populated when the agent flags grants.

## Analytics page

Warehouse-backed charts (query live `gold_*` via SQL Warehouse):
- **New lineage edges per day** — line, baseline vs `new_edges_from_mv`, with the spike visible.
- **Top assets by downstream count** — horizontal bar, `mv_exec_revenue_daily` on top.
- **PII assets by principals with access** — horizontal bar, `customer_pii` on top, over-broad flagged.
Each links into the Lineage Explorer for the clicked asset.

---

# Data Model

## Two stores

- **Delta tables** (`gold_*` from `01-lakeflow.md`) — lakehouse source of truth, read-only from the app. SQL Warehouse queries + Genie read here.
- **Lakebase Postgres** — OLTP write surface. Chat state + operational mirror of the graph subset the console needs.

## Lakebase schema (`app.*`)

### Chat state (reusable — keep as-is)

| Table | Key fields |
|---|---|
| `conversations` | id, userEmail, title, kind (`demo_dock` / `default`), timestamps |
| `messages` | conversationId, role, content, position, traceId, thinking (JSONB), error |
| `feedback` | messageId, value (`up`/`down`), rationale, traceId, mlflowAssessmentId |

### Delta mirror (Northpeak-specific — replace the template's returns tables)

| Table | Source | Key fields |
|---|---|---|
| `assets` | `gold_assets` | id (asset_id), assetName, assetType, platform, catalog, schema, domain, criticality, hasPii, ownerEmail, downstreamCount, blastRadiusUsd, principalsWithAccess, hasOverBroadGrant, annualValueUsd |
| `lineage_edges` | `gold_lineage_edges` | id (edge_id), sourceAssetId, sourceAssetName, sourceAssetType, targetAssetId, targetAssetName, targetAssetType, edgeType, createdDate, isNewFromMv, sourceHasPii, targetCriticality |
| `asset_columns` | `gold_columns` | id (`assetId:columnName`), assetId, columnName, dataType, isPii, ordinal. Covers every generated object, including dashboards. |
| `column_lineage` | `gold_column_lineage` | id (col_edge_id), sourceAssetId, sourceColumn, targetAssetId, targetColumn, transform. Covers every generated object-level edge. |
| `access_grants` | `gold_access_grants` | id (grant_id), assetId, assetName, assetType, assetHasPii, assetCriticality, principal, principalType, displayName, department, privilege, memberCount, isOverBroad, grantedBy, grantedDate, **status** (`active` / `flagged_for_review`), **reviewedBy** (null until flagged), **auditTrail** (append-only JSONB array) |

> `status`, `reviewedBy`, and `auditTrail` on `access_grants` are the write targets. The agent's `flag_grants_for_review` sets `status='flagged_for_review'`, `reviewedBy`, and appends one audit entry per flagged grant in one atomic UPDATE. The node drawer's Activity tab renders from `auditTrail`.

## Delta → Lakebase sync

> **Talking-track vs build:** production = **Lakebase Synced Tables** (managed continuous Delta→Lakebase, same UC governance). For the demo, a manual one-shot sync at boot. Same outcome on screen.

- On boot, if the mirror tables are empty, sync the needed Delta subset: all `assets`, `lineage_edges`, `asset_columns`, `column_lineage`, and `access_grants` (with `status='active'`, `reviewedBy=null`, `auditTrail=[]`). Idempotent.
- **"Reset demo" button** → truncates + re-syncs from Delta: flags clear, statuses back to `active`, audit trail wiped. Between presentations the graph looks untouched.

Source tables come from `config/app.json` `data.tables` (logical name → Delta table name, used by sync + analytics).

## Type-mapping caution (Delta → Postgres)

Booleans (`hasPii`, `isOverBroad`, `isNewFromMv`) → `boolean`; `blastRadiusUsd`/`annualValueUsd` → `numeric`/`integer` (null-safe — most assets are null/0); dates → `timestamp`. Guard the sync SELECTs so nulls don't break the pg insert.

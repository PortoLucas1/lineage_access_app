# AI/BI — Dashboard + Genie

Tables and columns referenced here are defined in `01-lakeflow.md`. Widgets read the `gold_*` tables directly.

> **Talking-track-only products mentioned in the README** — do **not** build resources for these:
> - **Databricks One** — workspace surface; the dashboard + Genie space show up there automatically. Nothing to provision.
> - **Genie Code / Genie One** — authoring assist + business-user front door; referenced in narrative, not separate resources.
> - **Unity Catalog / Lakeflow Connect** — governance + ingest narrative; talk track only. Ensure the catalog/schema/grants from `01-lakeflow.md` are in effect.

---

## A. Genie Space

**Skill to use**: `databricks-genie` — read `SKILLS/databricks-genie/SKILL.md` before implementing.

Create `Northpeak Lineage & Access Analytics_b89e91` Genie Space.

### Tables

`gold_assets` (asset catalog + downstream_count + blast_radius_usd + PII/criticality), `gold_lineage_edges` (the DAG, with `is_new_from_mv`), `gold_access_grants` (who can access what + `is_over_broad`), `gold_lineage_events_daily` (edge-creation timeseries), `raw_principals` (friendly names + departments).

The lineage story is answered by walking `gold_lineage_edges` backward/forward from an asset; the access story by joining `gold_access_grants` on `asset_id`. No multi-hop SQL needed — everything is denormalized.

### Self-sufficient room

- **Space `description`** (PATCH `/api/2.0/genie/spaces/<id>`): 1–3 sentences naming the event (new MV `mv_exec_revenue_daily` published 3 weeks ago, 18 downstream edges, now feeds the Executive Revenue Tableau dashboard + a $250K workflow, PII source readable by 42 principals) and pointing to the sample questions in order. Lift from the README.
- **Story-context `text_instruction`** at the TOP of `instructions.text_instructions[]`: WHAT HAPPENED · WHAT TO HELP PRIYA DO · TONE. ~5–8 lines.
- **`sample_questions`** chips AND matching `example_question_sqls` walk the arc in order.

### Instructions

```
You analyze Northpeak Retail's Unity Catalog governance graph for Priya (Head of Data Platform, non-DBA).

CONTEXT: 3 weeks ago a new materialized view `mv_exec_revenue_daily` was published. It now feeds the Executive Revenue Tableau dashboard and a $250K/yr finance workflow (`finance_monthly_close`), and reads from `customer_pii` (a PII, high-criticality table).

HEADLINE NUMBERS:
- "How many governed assets?" → COUNT(*) FROM gold_assets
- "New lineage edges this month?" → SUM(new_edges) FROM gold_lineage_events_daily (current month)
- "What's the biggest downstream blast radius?" → gold_assets ORDER BY downstream_count DESC → mv_exec_revenue_daily

LINEAGE FLOW for "what feeds the Executive Revenue dashboard?":
1. gold_lineage_edges WHERE target_asset_name = 'Executive Revenue' → upstream = mv_exec_revenue_daily
2. gold_lineage_edges WHERE target_asset_name = 'mv_exec_revenue_daily' → upstream = customer_pii, orders_gold
3. gold_assets WHERE asset_name IN (those) → surface has_pii, criticality, downstream_count, blast_radius_usd

ACCESS FLOW for "who can access those tables?":
4. gold_access_grants WHERE asset_name = 'customer_pii' → surface principal, privilege, member_count, is_over_broad → all-analysts (42) is over-broad. THIS IS THE PUNCHLINE — call it out.

MV SPIKE:
- "What did mv_exec_revenue_daily add downstream 3 weeks ago?" → gold_lineage_edges WHERE source_asset_name='mv_exec_revenue_daily' AND is_new_from_mv → 18 edges incl. the Tableau dashboard + $250K workflow.
```

### Sample Questions — story-arc walk

Ship the full 6-question arc as chips (`config.sample_questions`); curate 3 as `instructions.example_question_sqls` (the load-bearing cross-table ones).

Chips (all 6, in arc order):
1. **Headline** — "How many governed assets do we have, and how many new lineage edges appeared this month?"
2. **The spike** — "Which asset added the most downstream connections in the last month?"
3. **Lineage back** — "What feeds the Executive Revenue Tableau dashboard?"
4. **Access** — "Who can access customer_pii, and are any of those grants over-broad?"
5. **Blast radius** — "What breaks downstream if mv_exec_revenue_daily changes? Include workflow value."
6. **Exposure ranking** — "Which PII tables are readable by the most principals?"

Curated SQLs (3):
- **The spike** — `gold_assets ORDER BY downstream_count DESC LIMIT 5` (surfaces the MV + blast_radius_usd).
- **Access** — `gold_access_grants WHERE asset_name = 'customer_pii'` ordered by `is_over_broad DESC, member_count DESC` — quotes the over-broad `all-analysts` grant. Load-bearing (crosses grant + asset semantics).
- **Blast radius** — the 18 downstream edges + `finance_monthly_close`'s `annual_value_usd` (join `gold_lineage_edges` → `gold_assets`).

### Validation

- "How many governed assets?" → ~320 from `gold_assets`.
- "Which asset added the most downstream connections?" → `mv_exec_revenue_daily`, with its 18 new edges and $250K blast radius.
- "What feeds the Executive Revenue dashboard?" → walks Tableau ← MV ← customer_pii + orders_gold.
- "Who can access customer_pii?" → surfaces `all-analysts` (42) and flags it over-broad.

Add `genie_space_id` to `resources.json`.

---

## B. Dashboard

**Skill to use**: `databricks-aibi-dashboards` — read `SKILLS/databricks-aibi-dashboards/SKILL.md` before implementing. The skill owns the JSON shape, encoding rules, and grid math; this spec is story-level (WHAT, not HOW). Save locally as `PROJECT/dashboard.json`. Link the Genie space from section A. Set `--dataset-catalog` and `--dataset-schema` on `databricks lakeview create`/`update`.

Create `Northpeak Lineage & Access_b89e91` dashboard.

### Why this dashboard works

- **Two pages, one story**: page 1 = the glance (*"something spiked, here's the shape and the blast radius"*); page 2 = the deep-dive (*"here's the exact lineage path, the exposed PII, and who can touch it"*).
- **Lean datasets**: one daily timeseries (`ds_events` → KPI sparkline + edge-trend line), one asset-level fact (`ds_assets` → blast-radius bar, criticality×PII matrix, type mix), one grant-level fact (`ds_grants` → access exposure bars + over-broad table), one edge-level fact (`ds_edges` → the MV fan-out sankey).
- **The edge-trend line is the hook**: the 3× spike three weeks ago reads in 5 seconds. Splitting the line/bar by `is_new_from_mv` shows baseline churn vs the MV's burst.
- **Self-sufficient pages**: row 1 of each page is a markdown `text` widget naming the event and telling the reader what each widget answers. Lift substance from the README.

### Theme

```
canvasBackgroundColor: #F5F7FB (light) / #0F1419 (dark)
widgetBackgroundColor: #FFFFFF (light) / #161B22 (dark)
widgetBorderColor:     same as widgetBackgroundColor (no visible border)
fontColor:             #1F2530 (light) / #E8ECF0 (dark)
selectionColor:        #4F7CE3 (light) / #8ACAFF (dark)
visualizationColors:   ["#094074","#3C6997","#5ADBFF","#FFDD4A","#FE9000"]
widgetHeaderAlignment: LEFT
```

**Semantic colors (literal-hex pinned everywhere, NEVER `themeColorType: position N`):**
- **New-from-MV edges / the catalyst** → `#FE9000` vivid orange (draws the eye to the spike).
- **Baseline churn** → `#3C6997` steel blue.
- **Over-broad grant / PII exposure** → `#FFDD4A` soft yellow (warning).

**Criticality color pins** (on any widget colored by `criticality`): high → `#094074`, medium → `#5ADBFF`, low → `#FFDD4A`.
**Asset-type color pins** (on any widget colored by `asset_type`): table → `#094074`, materialized_view → `#FE9000`, view → `#3C6997`, tableau_dashboard → `#5ADBFF`, dbsql_dashboard → `#8ACAFF`, workflow → `#FFDD4A`, notebook → `#B0B7C0`.

### Datasets (4 total)

| Name | Source | Powers |
|---|---|---|
| `ds_events` | daily grain from `gold_lineage_events_daily`: date, new_edges, new_edges_from_mv, assets_touched | KPI counters + edge-trend line |
| `ds_assets` | asset-level from `gold_assets`: asset_name, asset_type, criticality, has_pii, domain, downstream_count, blast_radius_usd, principals_with_access, has_over_broad_grant | Blast-radius bar, criticality×PII matrix, asset-type mix, exposure bar |
| `ds_grants` | grant-level from `gold_access_grants`: asset_name, asset_type, asset_has_pii, principal, principal_type, department, privilege, member_count, is_over_broad | Over-broad grants table, access-by-department, principal-exposure bars |
| `ds_edges` | Node-link graph data for the MV sub-graph: one row per **node** (`kind='node'` — label, asset type, PII flag, principals, blast $, plus precomputed centre `x,y` and box corners `bx0/bx1/by0/by1`) and one row per **edge** (`kind='edge'` — `x,y → x2,y2` line endpoints). Node positions are laid out left→right (sources → MV → consumers) so Vega-Lite can draw a Unity-Catalog-style lineage graph. | MV lineage node-link graph (`custom-vega-viz`) |

Global filters bind to `ds_events`, `ds_assets`, `ds_grants` (see below); `ds_edges` stays unfiltered so the sankey always shows the full MV sub-graph.

### Global filters (left panel — `PAGE_TYPE_GLOBAL_FILTERS`)

| Filter | Column | Datasets | Default |
|---|---|---|---|
| Date Range | `date` (ds_events) / `granted_date` (ds_grants) | ds_events, ds_grants | All |
| Domain | `domain` | ds_assets | All |
| Criticality | `criticality` | ds_assets | All |
| Asset Type | `asset_type` | ds_assets, ds_grants | All |

### Page 1 — Governance Overview (the glance)

12-column grid.

| Row (y) | x | w | h | Widget |
|---|---|---|---|---|
| 0  | 0 | 12 | 3 | `title` (markdown) |
| 3  | 0 |  3 | 3 | `kpi_assets` |
| 3  | 3 |  3 | 3 | `kpi_new_edges` |
| 3  | 6 |  3 | 3 | `kpi_blast_radius` |
| 3  | 9 |  3 | 3 | `kpi_pii_exposed` |
| 6  | 0 | 12 | 5 | `edge_trend_chart` |
| 11 | 0 |  7 | 6 | `blast_radius_bar` |
| 11 | 7 |  5 | 6 | `asset_type_donut` |
| 17 | 0 | 12 | 6 | `criticality_pii_matrix` |

**`title` — markdown** (~5 lines): what happened (new MV published 3 weeks ago, downstream edges spiked 3×) · cause (`mv_exec_revenue_daily` now feeds the Executive Revenue Tableau dashboard + $250K workflow, reading from a PII source) · exposure (42 principals can read `customer_pii`) · what to see on this page.

**4 × `counter`** — source `ds_events`/`ds_assets`. No `period` encoding (show the sum over the filtered window). Pin `value.color` to `#094074` except the two "warning" tiles.
- **Governed Assets** · `COUNT(*)` over `ds_assets` · number compact · `#094074`.
- **New Edges (this window)** · `SUM(new_edges)` over `ds_events` · number compact · `#FE9000` · *the spike's headline.*
- **Blast Radius at Risk** · `SUM(blast_radius_usd)` over `ds_assets` (dedup — use MAX or the workflow-value sum) · `number-currency` USD compact · `#094074` · shows **$250K**.
- **Principals with PII Access** · `MAX(principals_with_access)` where `has_pii` (the exposed source) · number · `#FFDD4A` · shows **42**.

**`edge_trend_chart` — `line` "New lineage edges per day — baseline vs new MV"** (12-wide). Source `ds_events`. x = `date` (temporal, daily or weekly), two series: `new_edges` (total, steel blue `#3C6997`) and `new_edges_from_mv` (orange `#FE9000`). Vertical-line annotation on `AFFECTED_MV_DATE`, label `"mv_exec_revenue_daily published"`. Frame description: *"Edge creation spiked 3× three weeks ago — the orange series is the new MV's fan-out. Bar = the day it was published."*

**`blast_radius_bar` — `bar` horizontal "Top assets by downstream count"** (7-wide). Source `ds_assets`. y = `asset_name` (top 10 by `downstream_count`), x = `downstream_count`, color = `asset_type` (pinned). Frame: *"mv_exec_revenue_daily towers over everything — 18 downstream assets."* Optional secondary label/tooltip = `blast_radius_usd`.

**`asset_type_donut` — `pie` (donut) "Assets by type"** (5-wide). Source `ds_assets`. slices = `asset_type`, angle = `COUNT(*)`, color via type pins. *Shows the estate mix; Tableau dashboards are a visible slice.*

**`criticality_pii_matrix` — `heatmap` "Criticality × PII"** (12-wide). Source `ds_assets`. x = `criticality` (high/medium/low), y = `has_pii` (Yes/No), color = `COUNT(*)`. Frame: *"The high-criticality + PII quadrant is the one to watch — customer_pii lives here."* (If heatmap encoding is fussy, fall back to a grouped `bar`: x = criticality, color = has_pii.)

### Page 2 — Lineage & Access Deep-Dive

Same grid. `sec_*` widgets are thin (`h=1`) markdown dividers.

| Row (y) | x | w | h | Widget |
|---|---|---|---|---|
|  0 | 0 | 12 | 4 | `deepdive_title` (markdown) |
|  4 | 0 | 12 | 8 | `mv_fanout_sankey` |
| 12 | 0 | 12 | 1 | `sec_access` (markdown: `## Access exposure`) |
| 13 | 0 |  6 | 6 | `exposure_bar` |
| 13 | 6 |  6 | 6 | `access_by_dept` |
| 19 | 0 | 12 | 1 | `sec_overbroad` (markdown: `## Over-broad grants — remediation candidates`) |
| 20 | 0 | 12 | 6 | `overbroad_grants_table` |

**`deepdive_title` — markdown** (~5 lines): the lineage path (PII source → new MV → Tableau + $250K workflow), what the sankey shows, the access exposure, interaction hint ("filter by domain/criticality on the left").

**`mv_lineage_graph` — `custom-vega-viz` (Vega-Lite) "Revenue-pipeline lineage — Unity Catalog view"** (12-wide). Source `ds_edges`. A **node-link lineage graph** in the Unity Catalog style, not a sankey: boxed asset nodes laid out left→right (upstream sources `customer_pii` + `orders_gold` → `mv_exec_revenue_daily` in the centre → downstream `Executive Revenue` Tableau dashboard, AI/BI mirror, `finance_monthly_close` $250K workflow, and an "Other downstream (15 assets)" group), connected by directed edges (`rule` + arrowhead `point`). Node `rect` fill = asset type (table navy, MV orange, Tableau cyan, workflow yellow); PII sources carry a red "● PII" flag; hover tooltip shows type / PII / principals-with-access / blast-radius $. Layered spec (rect + text + rule) so it does not cross-filter — that's fine, it's a read-only lineage picture. Positions are precomputed in the `ds_edges` SQL (Vega-Lite doesn't do graph layout). Frame: *"customer_pii + orders_gold feed the new MV, which feeds the Tableau dashboard and the $250K workflow."*

**`sec_access` — section heading** (12-wide, h=1).

**`exposure_bar` — `bar` horizontal "PII assets by principals with access"** (6-wide). Source `ds_assets` WHERE `has_pii`. y = `asset_name`, x = `principals_with_access`, color = `has_over_broad_grant` pinned (TRUE → `#FFDD4A`, FALSE → `#3C6997`). *`customer_pii` tops it at ~42, flagged yellow.*

**`access_by_dept` — `bar` "Access grants by department"** (6-wide). Source `ds_grants`. x = `department`, y = `SUM(member_count)` (effective principals), color = `is_over_broad` pinned. *Shows where broad access concentrates.*

**`sec_overbroad` — section heading** (12-wide, h=1).

**`overbroad_grants_table` — `table` "Over-broad grants"** (12-wide). Source `ds_grants` WHERE `is_over_broad = TRUE`. Columns: `asset_name` (Asset), `asset_type` (Type), `principal` (Principal), `principal_type`, `member_count` (# People), `privilege` (Privilege), `department`, `granted_by`, `granted_date`. Sort `member_count` DESC. Frame: *"3 grants flagged — all-analysts (42) on customer_pii leads. These are the remediation candidates the console acts on."*

### Validation

Open the published dashboard: the edge spike stands out (orange series), `mv_exec_revenue_daily` dominates the blast-radius bar, the sankey shows the PII→MV→Tableau/$250K path, the over-broad grants table lists exactly 3 rows with `all-analysts`/`customer_pii` on top, and global filters update every widget. Add `dashboard_id` to `resources.json`.

# Lakeflow — Data Generation + Small Transformation Chain

> **Simple-demo contract.** One self-contained, idempotent data-generation script produces the full **raw → gold** layering for a synthetic **Unity Catalog governance graph**: assets, lineage edges, access grants, and a daily lineage-events timeseries. There is **no SDP** in this build, so the script does the layering itself with inline `spark.sql` CTAS. Lineage is visible in Catalog Explorer. Talking track: *"in production this graph arrives through **Lakeflow Connect** from the metastore's `system.access`/`system.lineage` tables and the Tableau server's asset catalog — here the data-gen simulates the equivalent so the demo lands in minutes."*

---

## Shared Context (defined once — every later spec references these)

**Persona**: Priya Nair, Head of Data Platform at **Northpeak Retail** (national omnichannel retailer, central lakehouse). Non-DBA governance owner — cares about lineage blast radius and access exposure, not SQL.

**The catalyst asset** (verbatim): `mv_exec_revenue_daily` — a **materialized view**, `asset_type = 'materialized_view'`, published on `AFFECTED_MV_DATE` (see time anchors). It reads from two upstream tables:
- `customer_pii` (`asset_type = 'table'`, `has_pii = TRUE`, `criticality = 'high'`) — the exposed source.
- `orders_gold` (`asset_type = 'table'`, `has_pii = FALSE`, `criticality = 'high'`).

And it fans out **downstream** to:
- `Executive Revenue` (`asset_type = 'tableau_dashboard'`, `platform = 'Tableau'`) — the one external BI consumer.
- `Executive Revenue AI/BI` (`asset_type = 'dbsql_dashboard'`) — the native mirror.
- `finance_monthly_close` (`asset_type = 'workflow'`, `annual_value_usd = 250000`) — the **$250K/yr** reporting workflow.
- plus a fan-out of ~15 additional downstream assets (finance marts, extracts, notebooks) so the new-edge count reaches **18**.

**The over-broad grant** (the access story): the group **`all-analysts`** (member_count `42`) holds a `SELECT` grant on `customer_pii` — flagged `is_over_broad = TRUE` because it grants a large group direct read on a **PII + high-criticality** table. Two more over-broad grants exist for a total of **3 flagged**: `all-analysts` → `SELECT` on `orders_gold`, and `contractors` (member_count `11`) → `SELECT` on `mv_exec_revenue_daily`. Every other grant is scoped (individual users or small role groups) and `is_over_broad = FALSE`.

**Time anchors**: `STORY_END_DATE = NOW`, `STORY_START_DATE = NOW − 12 months`, `AFFECTED_MV_DATE = NOW − 3 weeks` (the MV is published and its 18 downstream edges are all created within a 2-day window here), `RAMP_START = NOW − 3 weeks`, `DECAY_START = NOW − 2 weeks`. **`NOW = datetime.now()` by default** — rolling time so the dashboard's right edge is always ~yesterday. Set `NP_PIN_TIME=1` to freeze `NOW` for reproducible runs.
- **Baseline** lineage-edge creation: ~2–5 new edges/day across the whole estate (normal churn: new tables, refactors), ±noise.
- **The spike**: on `AFFECTED_MV_DATE` a burst of **18 new edges** created within ~2 days (the MV + its fan-out going live) → a clear 3–4× spike over baseline → decay back to baseline over the following 2 weeks. **Peak sits ~3 weeks in the past with a decay tail — never at the chart's right edge.**

**`is_new_from_mv` flag** — denormalized onto `gold_lineage_edges` (TRUE iff the edge was created within the `AFFECTED_MV_DATE` window AND is on the `mv_exec_revenue_daily` sub-graph). Dashboard widgets split baseline churn vs the MV's fan-out on this column.

---

## A. Data Generation Script

**Skill**: `databricks-synthetic-data-gen` — read `SKILLS/databricks-synthetic-data-gen/SKILL.md` first. Use `example-luxebeauty-simple/data_generation/generate_data.py` as the *syntax* skeleton only (Spark → raw Delta → `spark.sql` CTAS for gold); rewrite all content.

**Runtime**: pre-provisioned databricks-connect venv (path in system prompt). Do NOT create a new venv. Target catalog/schema from `resources.json` (`solution_builder.demo_lineage_access_for_every_team_b89e91`).

One script produces all layers. COMMENT every table and column so Genie reads them as semantics.

### Raw tables (normalized)

- **`raw_assets`** ~320 — the governed asset catalog. `asset_id` (PK, `ASSET-NNNN`), `asset_name`, `asset_type` (`table` / `materialized_view` / `view` / `dbsql_dashboard` / `tableau_dashboard` / `workflow` / `notebook`), `platform` (`Databricks` / `Tableau`), `catalog`, `schema`, `domain` (`finance` / `sales` / `marketing` / `supply_chain` / `customer`), `criticality` (`high` / `medium` / `low`), `has_pii` (BOOLEAN), `owner_email`, `created_date`, `last_refreshed`. Hand-curate the story-critical rows (`mv_exec_revenue_daily`, `customer_pii`, `orders_gold`, `Executive Revenue`, `Executive Revenue AI/BI`, `finance_monthly_close`) with fixed names/attributes; generate the rest to fill the estate with a realistic type mix (~55% tables, ~12% views, ~10% MVs, ~10% dashboards incl. ~8 Tableau, ~7% workflows, ~6% notebooks).
- **`raw_lineage_edges`** ~900 — `edge_id` (PK), `source_asset_id` (FK), `target_asset_id` (FK), `edge_type` (`derived_from` / `feeds` / `reads` / `writes`), `created_date`, `is_active`. Encodes the DAG: sources → silver/gold tables → MVs → dashboards/workflows. The `mv_exec_revenue_daily` sub-graph (2 upstream + 18 downstream edges) is created in the `AFFECTED_MV_DATE` window; everything else is spread across the year with the ~2–5/day baseline churn.
- **`raw_access_grants`** ~600 — `grant_id` (PK), `asset_id` (FK), `principal` (email for users, group name for groups), `principal_type` (`user` / `group` / `service_principal`), `privilege` (`SELECT` / `MODIFY` / `ALL_PRIVILEGES` / `USAGE` / `EXECUTE`), `granted_by`, `granted_date`, `member_count` (1 for users; group size for groups — `all-analysts`=42, `contractors`=11, small role groups 3–8). The 3 over-broad grants defined in Shared Context are inserted verbatim; the rest are scoped.
- **`raw_principals`** ~120 — `principal` (PK), `principal_type`, `display_name`, `department`, `member_count` (for groups). Lets the app/Genie join a grant to a friendly name + department.

### Curated (gold) tables — what the dashboard + Genie + app read

Built inline via `spark.sql` CTAS from raw. All denormalized so no downstream consumer needs multi-hop joins.

- **`gold_assets`** ~320 — the asset catalog, enriched with two **computed** columns the whole demo leans on:
  - `downstream_count` — number of distinct assets reachable downstream (recursive over `raw_lineage_edges`; a 2–3 hop expansion is sufficient for this estate). `mv_exec_revenue_daily` must land at the **top** of this ranking.
  - `blast_radius_usd` — SUM of `annual_value_usd` over all downstream **workflow** assets reachable from this asset (so `mv_exec_revenue_daily` = **$250K**, most assets = 0).
  - Plus `principals_with_access` (COUNT DISTINCT principals with any grant, expanding group `member_count`), `has_over_broad_grant` (BOOLEAN), all `raw_assets` columns, and `annual_value_usd` (non-null only on workflows; `finance_monthly_close` = 250000).
- **`gold_lineage_edges`** ~900 — projected from `raw_lineage_edges` joined to `raw_assets` on both ends: `source_asset_name`, `source_asset_type`, `target_asset_name`, `target_asset_type`, `edge_type`, `created_date`, plus **`is_new_from_mv`** (see Shared Context) and `source_has_pii` / `target_criticality` denormalized for coloring. This is the graph the app's lineage explorer reads.
- **`gold_access_grants`** ~600 — projected from `raw_access_grants` joined to `raw_assets` + `raw_principals`: `asset_id`, `asset_name`, `asset_type`, `asset_has_pii`, `asset_criticality`, `principal`, `principal_type`, `display_name`, `department`, `privilege`, `member_count`, `granted_by`, `granted_date`, and **`is_over_broad`** (see Shared Context). Carries **`effective_principals`** = `member_count` (so summing gives "people who can touch this asset"). This is the access panel's source and the app's remediation target.
- **`gold_lineage_events_daily`** ~365 rows — one row per `date`: `new_edges` (COUNT of edges created that day), `new_edges_from_mv` (subset with `is_new_from_mv`), `assets_touched`. Powers the lineage-edges-over-time line and the KPI sparkline. The 18-edge burst on `AFFECTED_MV_DATE` must make `new_edges` spike to ~3–4× the ~2–5/day baseline.

---

## B. Data Shaping Rules

Follow these and the dataset is dashboard-ready on first pass.

- **The DAG is coherent**: every dashboard/workflow/MV has ≥1 upstream edge; every gold/silver table has ≥1 upstream source; no cycles. Domains cluster (finance assets mostly reference finance + sales tables). ~55% of assets have `downstream_count = 0` (leaf dashboards/workflows/notebooks), the rest fan out modestly (2–15), and **`mv_exec_revenue_daily` is a clear outlier at the top** with its 18-asset fan-out.
- **The catalyst (load-bearing)**:
  - `mv_exec_revenue_daily` is `downstream_count` #1 in `gold_assets` (≥ 2× the next asset) and the **only** asset with `blast_radius_usd = 250000`.
  - Its 18 downstream edges + the 2 upstream edges all carry `created_date` in the `AFFECTED_MV_DATE` window and `is_new_from_mv = TRUE`.
  - `customer_pii` is `has_pii = TRUE`, `criticality = 'high'`, sits **directly upstream** of the MV, and has the `all-analysts` (42) over-broad SELECT grant → so the path *PII source → new MV → Tableau + $250K workflow* is fully traceable.
- **The lineage-edge spike (visible to the eye)**: baseline `new_edges` ~2–5/day with ±noise across the year → a burst pushing `new_edges` to ~12–18/day for ~2 days at `AFFECTED_MV_DATE` → decay back to baseline over the next 2 weeks. Peak in the past with a tail. The MV burst must dominate normal churn so the line's spike is unmistakable.
- **Over-broad access (the exposure story)**: exactly **3** grants have `is_over_broad = TRUE` (the ones in Shared Context). `all-analysts` (42) is the largest by `member_count`, so `customer_pii.principals_with_access` ≈ 42+ and it tops any "most-exposed PII asset" ranking. All other PII assets have only scoped grants.
- **Criticality × PII matrix**: distribute `criticality` (~20% high / ~45% medium / ~35% low) and `has_pii` (~15% TRUE) so the "high-criticality AND PII" quadrant is small and clearly contains `customer_pii` and a handful of others — the widget the exec scans first.
- **Type / platform mix**: ~8 Tableau dashboards (so "Tableau" is a real, filterable platform, not a single row), the rest Databricks-native. Domains span the 5 listed.

---

## C. Validation

The LLM writes one-line queries for each check. If any fail, fix the synth before `04-ai-bi.md`.

**Load-bearing (gate the story):**
- **Edge spike, peak in past** — daily `new_edges` from `gold_lineage_events_daily`: ~3–4× baseline burst ~3 weeks ago, decaying, NOT in the current week.
- **MV is the outlier** — `gold_assets ORDER BY downstream_count DESC LIMIT 5`: `mv_exec_revenue_daily` is #1, ≥2× the next; it is the only row with `blast_radius_usd = 250000`.
- **The full path exists** — from `gold_lineage_edges`, `customer_pii → mv_exec_revenue_daily → {Executive Revenue (Tableau), finance_monthly_close (workflow)}` is traceable, all MV edges `is_new_from_mv = TRUE`, count of new downstream edges = 18.
- **Over-broad grants** — exactly 3 rows in `gold_access_grants` have `is_over_broad = TRUE`; the top one is `all-analysts` (member_count 42) → `SELECT` on `customer_pii` (PII, high criticality).
- **PII exposure** — `customer_pii.principals_with_access` ≈ 42+ and it is #1 in a "PII assets by principals_with_access" ranking.

**Smoke checks** (LLM derives): asset counts by type sum to ~320 · every edge's source/target resolve to a real asset · `gold_lineage_events_daily` covers the full ~365-day window with no gaps · no null `asset_type`/`criticality`.

Surface the resolved `AFFECTED_MV_DATE` and the affected asset IDs (notebook exit JSON or `resources.json`) so `04-ai-bi.md` and the app can reference them.

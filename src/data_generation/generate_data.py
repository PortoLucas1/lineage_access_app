# Databricks notebook source
"""Generate the compact lineage and access sample dataset.

The graph intentionally contains only 13 assets:
* 8 tables, views, and materialized views
* 2 Tableau dashboards
* 1 Databricks AI/BI dashboard
* 1 notebook
* 1 agent

Identity data is similarly focused: named users, five user groups with explicit
membership, and a small set of service principals.
"""
from __future__ import annotations

import os
from datetime import datetime, timedelta

from databricks.connect import DatabricksSession

# ── Config ──────────────────────────────────────────────────────────────────
IN_NOTEBOOK = "dbutils" in dir()
if IN_NOTEBOOK:
    dbutils.widgets.text("catalog", "", "Catalog")
    dbutils.widgets.text("schema", "", "Schema")
    CATALOG = dbutils.widgets.get("catalog")
    SCHEMA = dbutils.widgets.get("schema")
else:
    CATALOG = os.environ.get("DEMO_CATALOG", "solution_builder")
    SCHEMA = os.environ.get("DEMO_SCHEMA", "demo_lineage_access_for_every_team_b89e91")
assert CATALOG and SCHEMA, "catalog + schema required"

# Time anchors — rolling by default; NP_PIN_TIME=1 freezes for a recorded run.
PINNED_NOW = datetime(2026, 9, 15)
NOW = PINNED_NOW if os.environ.get("NP_PIN_TIME") == "1" else datetime.now()
STORY_START = NOW - timedelta(days=365)
AFFECTED_MV_DATE = NOW - timedelta(weeks=3)   # MV published + fan-out created here

print(f"Target: {CATALOG}.{SCHEMA}")
print(f"NOW={NOW.date()}  AFFECTED_MV_DATE={AFFECTED_MV_DATE.date()}")

try:
    spark  # noqa: F821
except NameError:
    spark = DatabricksSession.builder.profile(
        os.environ.get("DATABRICKS_CONFIG_PROFILE", "DEFAULT")).serverless(True).getOrCreate()
spark.sql(f"CREATE SCHEMA IF NOT EXISTS {CATALOG}.{SCHEMA}")


def _d(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%d")


# ── Principals ────────────────────────────────────────────────────────────────
# Exactly five groups requested for the demo.
GROUPS = [
    ("data-engineers", "group", 8, "Data Engineering"),
    ("data-analysts", "group", 12, "Analytics"),
    ("platform-admins", "group", 3, "Data Platform"),
    ("finance", "group", 6, "Finance"),
    ("contractors", "group", 4, "External"),
]
USERS = [
    ("priya.nair@northpeak.com", "user", "Priya Nair", "Data Platform", 1),
    ("marcus.chen@northpeak.com", "user", "Marcus Chen", "Data Engineering", 1),
    ("elena.rossi@northpeak.com", "user", "Elena Rossi", "Finance", 1),
    ("jordan.lee@northpeak.com", "user", "Jordan Lee", "Data Engineering", 1),
    ("sofia.martinez@northpeak.com", "user", "Sofia Martinez", "Data Engineering", 1),
    ("liam.okafor@northpeak.com", "user", "Liam Okafor", "Data Engineering", 1),
    ("nina.singh@northpeak.com", "user", "Nina Singh", "Data Engineering", 1),
    ("tomas.weber@northpeak.com", "user", "Tomas Weber", "Data Engineering", 1),
    ("aisha.patel@northpeak.com", "user", "Aisha Patel", "Analytics", 1),
    ("noah.kim@northpeak.com", "user", "Noah Kim", "Analytics", 1),
    ("grace.tanaka@northpeak.com", "user", "Grace Tanaka", "Analytics", 1),
    ("diego.lopez@northpeak.com", "user", "Diego Lopez", "Analytics", 1),
    ("mei.wang@northpeak.com", "user", "Mei Wang", "Analytics", 1),
    ("hannah.brown@northpeak.com", "user", "Hannah Brown", "Analytics", 1),
    ("raj.dubois@northpeak.com", "user", "Raj Dubois", "Analytics", 1),
    ("chloe.garcia@northpeak.com", "user", "Chloe Garcia", "Analytics", 1),
    ("farah.ali@northpeak.com", "user", "Farah Ali", "Analytics", 1),
    ("ivan.novak@northpeak.com", "user", "Ivan Novak", "Analytics", 1),
    ("david.kim@northpeak.com", "user", "David Kim", "Data Platform", 1),
    ("ava.costa@northpeak.com", "user", "Ava Costa", "Finance", 1),
    ("carlos.silva@northpeak.com", "user", "Carlos Silva", "Finance", 1),
    ("yuki.andersson@northpeak.com", "user", "Yuki Andersson", "Finance", 1),
    ("omar.haddad@northpeak.com", "user", "Omar Haddad", "Finance", 1),
    ("leo.schmidt@northpeak.com", "user", "Leo Schmidt", "Finance", 1),
    ("sam.reid@northpeak.com", "user", "Sam Reid", "External", 1),
    ("rita.cole@northpeak.com", "user", "Rita Cole", "External", 1),
    ("ben.hayes@northpeak.com", "user", "Ben Hayes", "External", 1),
]
SERVICE_PRINCIPALS = [
    ("sp-tableau-sync", "service_principal", "Tableau Sync", "IT",
     "3f2a9c1e-4b6d-4e8f-9a10-tableau000001", "priya.nair@northpeak.com"),
    ("sp-etl-runner", "service_principal", "ETL Runner", "Data Platform",
     "7c8e2b44-1d90-4aa2-b331-etlrunner0002", "marcus.chen@northpeak.com"),
    ("sp-genie-runtime", "service_principal", "Genie Runtime", "Data Platform",
     "a91d55c0-88e1-4c27-9bf4-genierun0003", "priya.nair@northpeak.com"),
    ("sp-lakeflow-ingest", "service_principal", "Lakeflow Ingest", "Data Engineering",
     "b0e14d77-2c5a-4f19-8d6e-lakeflow0004", "marcus.chen@northpeak.com"),
]
# Explicit membership so the Users tab can list each group with its people.
GROUP_MEMBERS = {
    "data-engineers": [
        "marcus.chen@northpeak.com", "priya.nair@northpeak.com",
        "jordan.lee@northpeak.com", "sofia.martinez@northpeak.com",
        "liam.okafor@northpeak.com", "nina.singh@northpeak.com",
        "tomas.weber@northpeak.com", "david.kim@northpeak.com",
    ],
    "data-analysts": [
        "aisha.patel@northpeak.com", "noah.kim@northpeak.com",
        "grace.tanaka@northpeak.com", "diego.lopez@northpeak.com",
        "mei.wang@northpeak.com", "hannah.brown@northpeak.com",
        "raj.dubois@northpeak.com", "chloe.garcia@northpeak.com",
        "farah.ali@northpeak.com", "ivan.novak@northpeak.com",
        "elena.rossi@northpeak.com", "priya.nair@northpeak.com",
    ],
    "platform-admins": [
        "priya.nair@northpeak.com", "david.kim@northpeak.com",
        "marcus.chen@northpeak.com",
    ],
    "finance": [
        "elena.rossi@northpeak.com", "ava.costa@northpeak.com",
        "carlos.silva@northpeak.com", "yuki.andersson@northpeak.com",
        "omar.haddad@northpeak.com", "leo.schmidt@northpeak.com",
    ],
    "contractors": [
        "sam.reid@northpeak.com", "rita.cole@northpeak.com",
        "ben.hayes@northpeak.com", "tomas.weber@northpeak.com",
    ],
}
assert {g[0] for g in GROUPS} == set(GROUP_MEMBERS)
for name, _ptype, count, _dept in GROUPS:
    assert len(GROUP_MEMBERS[name]) == count, (
        f"{name} expected {count} members, got {len(GROUP_MEMBERS[name])}"
    )
principals = [
    (name, ptype, name.replace("-", " ").title(), dept, count)
    for name, ptype, count, dept in GROUPS
] + USERS + [
    (name, ptype, display, dept, 1)
    for name, ptype, display, dept, _app_id, _owner in SERVICE_PRINCIPALS
]

# ── Assets ────────────────────────────────────────────────────────────────────
# Eight data assets feed exactly five terminal lineage assets.
CATALOG_UC = "prod"
FIXED = [
    ("ASSET-0001", "customer_pii", "table", "Databricks", CATALOG_UC, "customer",
     "customer", "high", True, "priya.nair@northpeak.com", None),
    ("ASSET-0002", "orders_gold", "table", "Databricks", CATALOG_UC, "sales",
     "sales", "high", False, "marcus.chen@northpeak.com", None),
    ("ASSET-0003", "mv_exec_revenue_daily", "materialized_view", "Databricks", CATALOG_UC,
     "finance", "finance", "high", False, "priya.nair@northpeak.com", None),
    ("ASSET-0004", "Executive Revenue", "tableau_dashboard", "Tableau", "-", "-",
     "finance", "high", False, "elena.rossi@northpeak.com", None),
    ("ASSET-0005", "Revenue Operations", "dbsql_dashboard", "Databricks", "-", "-",
     "finance", "high", False, "elena.rossi@northpeak.com", None),
    ("ASSET-0006", "Finance Performance", "tableau_dashboard", "Tableau", "-", "-",
     "finance", "medium", False, "elena.rossi@northpeak.com", None),
    ("ASSET-0007", "monthly_close_analysis", "notebook", "Databricks", "-", "-",
     "finance", "medium", False, "marcus.chen@northpeak.com", None),
    ("ASSET-0008", "revenue_governance_agent", "agent", "Databricks", "-", "-",
     "finance", "high", False, "priya.nair@northpeak.com", None),
    ("ASSET-0009", "orders_raw", "table", "Databricks", CATALOG_UC, "sales",
     "sales", "medium", False, "marcus.chen@northpeak.com", None),
    ("ASSET-0010", "customer_orders", "view", "Databricks", CATALOG_UC, "sales",
     "sales", "high", True, "marcus.chen@northpeak.com", None),
    ("ASSET-0011", "finance_forecast", "view", "Databricks", CATALOG_UC, "finance",
     "finance", "medium", False, "elena.rossi@northpeak.com", None),
    ("ASSET-0012", "regional_targets", "table", "Databricks", CATALOG_UC, "finance",
     "finance", "medium", False, "elena.rossi@northpeak.com", None),
    ("ASSET-0013", "product_margin", "table", "Databricks", CATALOG_UC, "finance",
     "finance", "medium", False, "elena.rossi@northpeak.com", None),
]
assets = []


def _add(row_fixed, created, refreshed):
    a_id, name, atype, plat, cat, sch, dom, crit, pii, owner, val = row_fixed
    assets.append([a_id, name, atype, plat, cat, sch, dom, crit, pii, owner,
                   created, refreshed, val])


for row in FIXED:
    created = AFFECTED_MV_DATE if row[0] in {"ASSET-0003", "ASSET-0004", "ASSET-0005",
                                             "ASSET-0006", "ASSET-0007", "ASSET-0008"} else STORY_START
    _add(row, _d(created), _d(NOW - timedelta(days=1)))

asset_by_id = {a[0]: a for a in assets}
ids_by_type = {}
for a in assets:
    ids_by_type.setdefault(a[2], []).append(a[0])

# ── Lineage edges (a coherent DAG) ────────────────────────────────────────────
edges = []  # (edge_id, source_id, target_id, edge_type, created_date, is_active)
edge_seq = 1


def _add_edge(src, tgt, etype, created):
    global edge_seq
    edges.append([f"EDGE-{edge_seq:05d}", src, tgt, etype, created, True])
    edge_seq += 1


MV = "ASSET-0003"
mv_window_dates = [_d(AFFECTED_MV_DATE), _d(AFFECTED_MV_DATE + timedelta(days=1)),
                   _d(AFFECTED_MV_DATE + timedelta(days=2))]
NEW_FROM_MV = set()  # edge_ids

baseline = _d(NOW - timedelta(days=60))
for src, tgt in [
    ("ASSET-0009", "ASSET-0002"),
    ("ASSET-0001", "ASSET-0010"),
    ("ASSET-0002", "ASSET-0010"),
    ("ASSET-0012", "ASSET-0011"),
    ("ASSET-0013", "ASSET-0011"),
]:
    _add_edge(src, tgt, "derived_from", baseline)

for src in ("ASSET-0010", "ASSET-0011"):
    _add_edge(src, MV, "derived_from", mv_window_dates[0])
    NEW_FROM_MV.add(edges[-1][0])

# Exactly five terminal assets: 2 Tableau, 1 Databricks dashboard, 1 notebook, 1 agent.
for tgt in ("ASSET-0004", "ASSET-0005", "ASSET-0006", "ASSET-0007", "ASSET-0008"):
    _add_edge(MV, tgt, "reads", mv_window_dates[1])
    NEW_FROM_MV.add(edges[-1][0])

print(f"assets={len(assets)}  edges={len(edges)}  new_from_mv={len(NEW_FROM_MV)}")

# ── Graph traversal: downstream_count + blast_radius_usd per asset ────────────
from collections import defaultdict, deque

adj = defaultdict(list)
for _, s, t, _, _, _ in edges:
    adj[s].append(t)

annual_value = {a[0]: (a[12] or 0) for a in assets}


def _downstream(root):
    seen, q = set(), deque([root])
    while q:
        n = q.popleft()
        for m in adj.get(n, []):
            if m not in seen:
                seen.add(m)
                q.append(m)
    return seen


downstream_count = {}
blast_radius = {}
for a in assets:
    downstream_count[a[0]] = len(adj.get(a[0], []))
    ds = _downstream(a[0])
    blast_radius[a[0]] = sum(annual_value[d] for d in ds
                             if annual_value[d])

# ── Access grants ─────────────────────────────────────────────────────────────
grants = []  # (grant_id, asset_id, principal, principal_type, privilege, granted_by, granted_date, member_count, is_over_broad)
grant_seq = 1
principal_lookup = {p[0]: p for p in principals}  # name -> (name,type,display,dept,mc)


def _add_grant(asset_id, principal, privilege, granted_date=None):
    global grant_seq
    p = principal_lookup[principal]
    grants.append([f"GRANT-{grant_seq:05d}", asset_id, principal, p[1], privilege,
                   "priya.nair@northpeak.com",
                   granted_date or _d(NOW - timedelta(days=30)), p[4], False])
    grant_seq += 1


_add_grant("ASSET-0001", "data-analysts", "SELECT", mv_window_dates[0])
_add_grant("ASSET-0001", "contractors", "SELECT", mv_window_dates[0])
_add_grant("ASSET-0003", "contractors", "SELECT", mv_window_dates[1])

# Every asset has a scoped group grant and one of exactly three named owners.
role_by_domain = {"customer": "data-analysts", "sales": "data-engineers", "finance": "finance"}
for a in assets:
    _add_grant(a[0], "platform-admins", "ALL_PRIVILEGES")
    _add_grant(a[0], role_by_domain.get(a[6], "data-engineers"), "SELECT")
    _add_grant(a[0], a[9], "ALL_PRIVILEGES")

# principals_with_access + has_over_broad_grant per asset (expand member_count)
access_by_asset = defaultdict(lambda: {"people": 0, "over_broad": False, "principals": set()})
for _, a_id, principal, ptype, priv, gb, gd, mc, ob in grants:
    entry = access_by_asset[a_id]
    if principal not in entry["principals"]:
        entry["principals"].add(principal)
        entry["people"] += int(mc)
    if ob:
        entry["over_broad"] = True

print(f"grants={len(grants)}")

# ── Daily lineage events ──────────────────────────────────────────────────────
events = defaultdict(lambda: {"new": 0, "mv": 0, "assets": set()})
for e in edges:
    eid, s, t, etype, cd, act = e
    events[cd]["new"] += 1
    events[cd]["assets"].add(s)
    events[cd]["assets"].add(t)
    if eid in NEW_FROM_MV:
        events[cd]["mv"] += 1
# ensure full daily coverage across the window
events_rows = []
cur = STORY_START
while cur <= NOW:
    ds = _d(cur)
    ev = events.get(ds)
    events_rows.append((ds, ev["new"] if ev else 0, ev["mv"] if ev else 0,
                        len(ev["assets"]) if ev else 0))
    cur += timedelta(days=1)

# ── Column-level lineage ──────────────────────────────────────────────────────
# Every asset has columns and every object-level edge has column mappings. This
# lets the app expand any node (including Tableau and AI/BI dashboards) and
# expand any graph edge into the lineage between its endpoint columns.
#
# columns rows: (asset_id, column_name, data_type, is_pii, ordinal)
columns = []
COLS = {
    "ASSET-0001": [  # customer_pii
        ("customer_id", "bigint", False), ("email", "string", True),
        ("full_name", "string", True), ("phone", "string", True),
        ("country", "string", False), ("segment", "string", False),
    ],
    "ASSET-0002": [  # orders_gold
        ("order_id", "bigint", False), ("customer_id", "bigint", False),
        ("order_ts", "timestamp", False), ("net_amount", "decimal(18,2)", False),
        ("region", "string", False), ("channel", "string", False),
    ],
    "ASSET-0003": [  # mv_exec_revenue_daily
        ("revenue_date", "date", False), ("region", "string", False),
        ("net_revenue", "decimal(18,2)", False), ("orders_count", "bigint", False),
        ("customer_segment", "string", False), ("avg_order_value", "decimal(18,2)", False),
    ],
    "ASSET-0004": [  # Executive Revenue (Tableau)
        ("revenue_date", "date", False), ("region", "string", False),
        ("net_revenue", "decimal(18,2)", False), ("orders_count", "bigint", False),
        ("avg_order_value", "decimal(18,2)", False), ("customer_segment", "string", False),
    ],
    "ASSET-0005": [  # Revenue Operations (AI/BI)
        ("revenue_date", "date", False), ("region", "string", False),
        ("net_revenue", "decimal(18,2)", False), ("orders_count", "bigint", False),
        ("customer_segment", "string", False),
    ],
    "ASSET-0006": [  # Finance Performance (Tableau)
        ("revenue_date", "date", False), ("region", "string", False),
        ("net_revenue", "decimal(18,2)", False), ("orders_count", "bigint", False),
        ("avg_order_value", "decimal(18,2)", False),
    ],
    "ASSET-0007": [  # monthly_close_analysis notebook
        ("close_month", "date", False), ("net_revenue", "decimal(18,2)", False),
        ("forecast_revenue", "decimal(18,2)", False), ("variance_pct", "double", False),
    ],
    "ASSET-0008": [  # revenue_governance_agent
        ("metric_name", "string", False), ("metric_value", "double", False),
        ("region", "string", False), ("as_of_date", "date", False),
        ("anomaly_score", "double", False),
    ],
    "ASSET-0009": [  # orders_raw
        ("order_id", "bigint", False), ("customer_id", "bigint", False),
        ("order_ts", "timestamp", False), ("gross_amount", "decimal(18,2)", False),
        ("discount_amount", "decimal(18,2)", False), ("region", "string", False),
        ("channel", "string", False),
    ],
    "ASSET-0010": [  # customer_orders
        ("customer_id", "bigint", False), ("order_id", "bigint", False),
        ("order_ts", "timestamp", False), ("net_amount", "decimal(18,2)", False),
        ("region", "string", False), ("customer_segment", "string", False),
    ],
    "ASSET-0011": [  # finance_forecast
        ("forecast_month", "date", False), ("region", "string", False),
        ("forecast_revenue", "decimal(18,2)", False), ("target_revenue", "decimal(18,2)", False),
        ("forecast_margin", "double", False),
    ],
    "ASSET-0012": [  # regional_targets
        ("region", "string", False), ("target_revenue", "decimal(18,2)", False),
        ("target_margin", "double", False), ("effective_month", "date", False),
    ],
    "ASSET-0013": [  # product_margin
        ("product_id", "bigint", False), ("region", "string", False),
        ("revenue", "decimal(18,2)", False), ("cost", "decimal(18,2)", False),
        ("margin", "double", False),
    ],
}
for a_id, cols in COLS.items():
    for i, (cname, dtype, pii) in enumerate(cols):
        columns.append((a_id, cname, dtype, pii, i))

col_edges = []  # (source_asset_id, source_column, target_asset_id, target_column, transform)
def _ce(sa, sc, ta, tc, transform="passthrough"):
    col_edges.append((sa, sc, ta, tc, transform))

# Raw orders → cleaned orders.
_ce("ASSET-0009", "order_id", "ASSET-0002", "order_id")
_ce("ASSET-0009", "customer_id", "ASSET-0002", "customer_id")
_ce("ASSET-0009", "order_ts", "ASSET-0002", "order_ts")
_ce("ASSET-0009", "gross_amount", "ASSET-0002", "net_amount",
    "gross_amount - discount_amount")
_ce("ASSET-0009", "region", "ASSET-0002", "region")
_ce("ASSET-0009", "channel", "ASSET-0002", "channel")

# Customer and order data → joined customer_orders view.
for col in ("customer_id", "order_id", "order_ts", "net_amount", "region"):
    _ce("ASSET-0002", col, "ASSET-0010", col)
_ce("ASSET-0001", "customer_id", "ASSET-0010", "customer_id", "join key")
_ce("ASSET-0001", "segment", "ASSET-0010", "customer_segment")

# Planning inputs → finance forecast view.
_ce("ASSET-0012", "effective_month", "ASSET-0011", "forecast_month")
_ce("ASSET-0012", "region", "ASSET-0011", "region")
_ce("ASSET-0012", "target_revenue", "ASSET-0011", "target_revenue")
_ce("ASSET-0012", "target_margin", "ASSET-0011", "forecast_margin", "target_margin")
_ce("ASSET-0013", "region", "ASSET-0011", "region")
_ce("ASSET-0013", "revenue", "ASSET-0011", "forecast_revenue", "SUM(revenue)")
_ce("ASSET-0013", "margin", "ASSET-0011", "forecast_margin", "AVG(margin)")

# Joined actuals and forecast → executive revenue MV.
_ce("ASSET-0010", "order_ts", "ASSET-0003", "revenue_date", "DATE_TRUNC('day', order_ts)")
_ce("ASSET-0010", "region", "ASSET-0003", "region")
_ce("ASSET-0010", "net_amount", "ASSET-0003", "net_revenue", "SUM(net_amount)")
_ce("ASSET-0010", "order_id", "ASSET-0003", "orders_count", "COUNT(DISTINCT order_id)")
_ce("ASSET-0010", "customer_segment", "ASSET-0003", "customer_segment")
_ce("ASSET-0010", "net_amount", "ASSET-0003", "avg_order_value", "AVG(net_amount)")
_ce("ASSET-0011", "forecast_month", "ASSET-0003", "revenue_date", "month alignment")
_ce("ASSET-0011", "region", "ASSET-0003", "region")

# MV → every terminal consumer, including dashboard fields actually rendered.
for col in ("revenue_date", "region", "net_revenue", "orders_count",
            "avg_order_value", "customer_segment"):
    _ce("ASSET-0003", col, "ASSET-0004", col)
for col in ("revenue_date", "region", "net_revenue", "orders_count", "customer_segment"):
    _ce("ASSET-0003", col, "ASSET-0005", col)
for col in ("revenue_date", "region", "net_revenue", "orders_count", "avg_order_value"):
    _ce("ASSET-0003", col, "ASSET-0006", col)
_ce("ASSET-0003", "revenue_date", "ASSET-0007", "close_month",
    "DATE_TRUNC('month', revenue_date)")
_ce("ASSET-0003", "net_revenue", "ASSET-0007", "net_revenue")
_ce("ASSET-0003", "net_revenue", "ASSET-0007", "variance_pct",
    "(net_revenue - forecast_revenue) / forecast_revenue")
_ce("ASSET-0003", "revenue_date", "ASSET-0008", "as_of_date", "MAX(revenue_date)")
_ce("ASSET-0003", "region", "ASSET-0008", "region")
_ce("ASSET-0003", "net_revenue", "ASSET-0008", "metric_value")
_ce("ASSET-0003", "net_revenue", "ASSET-0008", "anomaly_score",
    "ABS(zscore(net_revenue))")

# Fail generation if a future object or edge is added without column coverage.
asset_ids = {a[0] for a in assets}
assert asset_ids == set(COLS), (
    f"Column definitions must cover every asset; missing={asset_ids - set(COLS)}, "
    f"unknown={set(COLS) - asset_ids}"
)
column_names = {asset_id: {column[0] for column in asset_columns}
                for asset_id, asset_columns in COLS.items()}
object_edge_pairs = {(source, target) for _, source, target, _, _, _ in edges}
column_edge_pairs = {(source, target) for source, _, target, _, _ in col_edges}
assert object_edge_pairs <= column_edge_pairs, (
    f"Column lineage missing for object edges: {object_edge_pairs - column_edge_pairs}"
)
for source, source_column, target, target_column, _ in col_edges:
    assert source_column in column_names[source], (
        f"Unknown source column {source}.{source_column}"
    )
    assert target_column in column_names[target], (
        f"Unknown target column {target}.{target_column}"
    )
mapped_target_columns = defaultdict(set)
for _, _, target, target_column, _ in col_edges:
    mapped_target_columns[target].add(target_column)
for dashboard_id in ("ASSET-0004", "ASSET-0005", "ASSET-0006"):
    assert column_names[dashboard_id] <= mapped_target_columns[dashboard_id], (
        f"Dashboard columns missing lineage for {dashboard_id}: "
        f"{column_names[dashboard_id] - mapped_target_columns[dashboard_id]}"
    )
print(f"columns={len(columns)}  col_edges={len(col_edges)}")

# ══════════════════════════════════════════════════════════════════════════════
# Write raw tables
# ══════════════════════════════════════════════════════════════════════════════
def _save(rows, schema_ddl, table, comment):
    df = spark.createDataFrame(rows, schema_ddl)
    fqn = f"{CATALOG}.{SCHEMA}.{table}"
    df.write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(fqn)
    spark.sql(f"COMMENT ON TABLE {fqn} IS :c", args={"c": comment})
    print(f"  ✓ {table:28s} rows={spark.table(fqn).count():>7,}")


_save([tuple(p) for p in principals],
      "principal string, principal_type string, display_name string, department string, member_count int",
      "raw_principals", "Directory of principals (users / groups / service principals) with group member counts.")

user_lookup = {p[0]: p for p in principals if p[1] == "user"}
group_lookup = {p[0]: p for p in principals if p[1] == "group"}
group_member_rows = []
for group_name, members in GROUP_MEMBERS.items():
    g = group_lookup[group_name]
    for email in members:
        u = user_lookup[email]
        group_member_rows.append((group_name, g[2], g[3], g[4], email, u[2], u[3]))
_save(group_member_rows,
      "group_name string, group_display_name string, group_department string, member_count int, "
      "member_email string, member_display_name string, member_department string",
      "raw_group_members", "User-group membership used by the dashboard Users tab.")

sp_rows = [
    (name, display, dept, app_id, owner)
    for name, _ptype, display, dept, app_id, owner in SERVICE_PRINCIPALS
]
_save(sp_rows,
      "principal string, display_name string, department string, application_id string, owner_email string",
      "raw_service_principals", "Service principals used by the dashboard Users tab.")

_save([tuple(a) for a in assets],
      "asset_id string, asset_name string, asset_type string, platform string, catalog string, "
      "schema string, domain string, criticality string, has_pii boolean, owner_email string, "
      "created_date string, last_refreshed string, annual_value_usd int",
      "raw_assets", "Compact governed asset catalog — eight data assets and five terminal dashboard, notebook, and agent assets.")

_save([tuple(e) for e in edges],
      "edge_id string, source_asset_id string, target_asset_id string, edge_type string, "
      "created_date string, is_active boolean",
      "raw_lineage_edges", "Lineage edges (the DAG). mv_exec_revenue_daily sub-graph edges are created in the 3-weeks-ago window.")

_save([tuple(g) for g in grants],
      "grant_id string, asset_id string, principal string, principal_type string, privilege string, "
      "granted_by string, granted_date string, member_count int, is_over_broad boolean",
      "raw_access_grants", "Access grants per asset.")

_save(events_rows,
      "event_date string, new_edges int, new_edges_from_mv int, assets_touched int",
      "raw_lineage_events_daily", "Daily lineage-edge creation counts; new_edges spikes ~3-4x on the MV publish date.")

# ══════════════════════════════════════════════════════════════════════════════
# Gold tables (denormalized; computed columns via a Python-built lookup table)
# ══════════════════════════════════════════════════════════════════════════════
# Push the computed per-asset metrics as a Delta table, then CTAS-join for gold.
metrics_rows = [(a[0], int(downstream_count[a[0]]), int(blast_radius[a[0]]),
                 int(access_by_asset[a[0]]["people"]),
                 bool(access_by_asset[a[0]]["over_broad"]))
                for a in assets]
_save(metrics_rows,
      "asset_id string, downstream_count int, blast_radius_usd int, principals_with_access int, has_over_broad_grant boolean",
      "_asset_metrics", "Computed reachability + access metrics per asset (helper for gold_assets).")

print("Building gold_assets …")
spark.sql(f"""
  CREATE OR REPLACE TABLE {CATALOG}.{SCHEMA}.gold_assets
  COMMENT 'Compact governed asset catalog enriched with downstream_count and principals_with_access. The dashboard, Genie, and app read this.'
  AS SELECT
    a.asset_id, a.asset_name, a.asset_type, a.platform, a.catalog, a.schema,
    a.domain, a.criticality, a.has_pii, a.owner_email,
    a.created_date, a.last_refreshed, a.annual_value_usd,
    m.downstream_count, m.blast_radius_usd, m.principals_with_access, m.has_over_broad_grant
  FROM {CATALOG}.{SCHEMA}.raw_assets a
  JOIN {CATALOG}.{SCHEMA}._asset_metrics m ON a.asset_id = m.asset_id
""")

print("Building gold_lineage_edges …")
spark.sql(f"""
  CREATE OR REPLACE TABLE {CATALOG}.{SCHEMA}.gold_lineage_edges
  COMMENT 'Lineage edges denormalized with source/target asset names + types, plus is_new_from_mv (TRUE for the mv_exec_revenue_daily sub-graph created 3 weeks ago).'
  AS SELECT
    e.edge_id,
    e.source_asset_id, s.asset_name AS source_asset_name, s.asset_type AS source_asset_type, s.has_pii AS source_has_pii,
    e.target_asset_id, t.asset_name AS target_asset_name, t.asset_type AS target_asset_type, t.criticality AS target_criticality,
    e.edge_type, e.created_date,
    CASE WHEN e.source_asset_id = 'ASSET-0003' OR e.target_asset_id = 'ASSET-0003' THEN TRUE ELSE FALSE END AS is_new_from_mv
  FROM {CATALOG}.{SCHEMA}.raw_lineage_edges e
  JOIN {CATALOG}.{SCHEMA}.raw_assets s ON e.source_asset_id = s.asset_id
  JOIN {CATALOG}.{SCHEMA}.raw_assets t ON e.target_asset_id = t.asset_id
""")

print("Building gold_access_grants …")
spark.sql(f"""
  CREATE OR REPLACE TABLE {CATALOG}.{SCHEMA}.gold_access_grants
  COMMENT 'Access grants denormalized with asset attributes (type, PII, criticality) + principal display name/department. effective_principals = member_count.'
  AS SELECT
    g.grant_id, g.asset_id, a.asset_name, a.asset_type, a.has_pii AS asset_has_pii, a.criticality AS asset_criticality,
    g.principal, g.principal_type, p.display_name, p.department,
    g.privilege, g.member_count, g.member_count AS effective_principals,
    g.granted_by, g.granted_date, g.is_over_broad
  FROM {CATALOG}.{SCHEMA}.raw_access_grants g
  JOIN {CATALOG}.{SCHEMA}.raw_assets a ON g.asset_id = a.asset_id
  LEFT JOIN {CATALOG}.{SCHEMA}.raw_principals p ON g.principal = p.principal
""")

print("Building gold_group_members …")
spark.sql(f"""
  CREATE OR REPLACE TABLE {CATALOG}.{SCHEMA}.gold_group_members
  COMMENT 'One row per user-group membership. Powers the dashboard Users tab.'
  AS SELECT
    group_name, group_display_name, group_department, member_count,
    member_email, member_display_name, member_department
  FROM {CATALOG}.{SCHEMA}.raw_group_members
""")

print("Building gold_service_principals …")
spark.sql(f"""
  CREATE OR REPLACE TABLE {CATALOG}.{SCHEMA}.gold_service_principals
  COMMENT 'Service principals (automation identities). Powers the dashboard Users tab.'
  AS SELECT principal, display_name, department, application_id, owner_email
  FROM {CATALOG}.{SCHEMA}.raw_service_principals
""")

print("Building gold_lineage_events_daily …")
spark.sql(f"""
  CREATE OR REPLACE TABLE {CATALOG}.{SCHEMA}.gold_lineage_events_daily
  COMMENT 'Daily lineage-edge creation timeseries. new_edges spikes ~3-4x over baseline on the MV publish date; new_edges_from_mv isolates the MV fan-out.'
  AS SELECT CAST(event_date AS DATE) AS date, new_edges, new_edges_from_mv, assets_touched
  FROM {CATALOG}.{SCHEMA}.raw_lineage_events_daily
""")

spark.sql(f"DROP TABLE IF EXISTS {CATALOG}.{SCHEMA}._asset_metrics")

# Column-level lineage tables for every generated asset and graph edge.
_save([(a, c, d, p, o) for (a, c, d, p, o) in columns],
      "asset_id string, column_name string, data_type string, is_pii boolean, ordinal int",
      "gold_columns", "Columns for all generated assets, including Tableau and AI/BI dashboard fields.")

col_edge_rows = []
for i, (sa, sc, ta, tc, tr) in enumerate(col_edges):
    col_edge_rows.append((f"COLEDGE-{i:04d}", sa, sc, ta, tc, tr))
_save(col_edge_rows,
      "col_edge_id string, source_asset_id string, source_column string, "
      "target_asset_id string, target_column string, transform string",
      "gold_column_lineage", "Column→column mappings for every generated object-level lineage edge.")

print(f"\nDone. AFFECTED_MV_DATE={AFFECTED_MV_DATE.date()}")
for row in spark.sql(f"SHOW TABLES IN {CATALOG}.{SCHEMA}").collect():
    print(f"  - {row['tableName']}")

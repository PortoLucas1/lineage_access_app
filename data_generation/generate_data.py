# Databricks notebook source
"""
Northpeak Retail — Lineage & Access Console synthetic data generator.

Builds a synthetic Unity Catalog *governance graph* for the demo in
`specifications/01-lakeflow.md`:
  - raw_assets       (~320 governed assets: tables / MVs / views / dashboards /
                      Tableau dashboards / workflows / notebooks)
  - raw_lineage_edges(~900 DAG edges; the mv_exec_revenue_daily sub-graph is
                      created in the AFFECTED_MV_DATE window → the 3-week-ago
                      lineage-edge spike)
  - raw_access_grants(~600 grants; exactly 3 flagged is_over_broad)
  - raw_principals   (~120 users / groups / service principals)
  - gold_*           (denormalized tables the dashboard + Genie + app read),
                      incl. computed downstream_count / blast_radius_usd via
                      real graph traversal.

Scale is small + highly structured (a coherent DAG, no cycles, computed
reachability), so the graph is built DETERMINISTICALLY on the driver with numpy
and written to Delta via spark.createDataFrame — far cleaner than trying to
express recursive reachability in Spark for a few hundred nodes. Gold tables are
then materialized with spark.sql CTAS so Catalog-Explorer lineage arrows show.

Runtime: pre-provisioned databricks-connect venv (path in system prompt).
"""
from __future__ import annotations

import os
import random
from datetime import datetime, timedelta

import numpy as np
from databricks.connect import DatabricksSession
from pyspark.sql import functions as F

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

SEED = 20260915
random.seed(SEED)
np.random.seed(SEED)

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


def _rand_date(start: datetime, end: datetime) -> str:
    span = max((end - start).days, 1)
    return _d(start + timedelta(days=int(np.random.randint(0, span))))


# ── Domains / departments / people ───────────────────────────────────────────
DOMAINS = ["finance", "sales", "marketing", "supply_chain", "customer"]
DEPARTMENTS = ["Finance", "Sales", "Marketing", "Supply Chain", "Data Platform",
               "Analytics", "Executive", "IT"]
FIRST = ["Priya", "Marcus", "Elena", "David", "Sofia", "James", "Aisha", "Liam",
         "Nina", "Omar", "Grace", "Tomas", "Yuki", "Carlos", "Hannah", "Raj",
         "Chloe", "Diego", "Mei", "Noah", "Farah", "Leo", "Ava", "Ivan"]
LAST = ["Nair", "Chen", "Rossi", "Kim", "Martinez", "Okafor", "Dubois", "Singh",
        "Novak", "Haddad", "Andersson", "Silva", "Tanaka", "Weber", "Costa",
        "Patel", "Brown", "Garcia", "Wang", "Murphy", "Ali", "Schmidt", "Lopez"]

# ── Principals ────────────────────────────────────────────────────────────────
# Groups (name, type, member_count, department). all-analysts + contractors are
# the over-broad-grant holders.
GROUPS = [
    ("all-analysts", "group", 42, "Analytics"),
    ("contractors", "group", 11, "IT"),
    ("finance-analysts", "group", 6, "Finance"),
    ("sales-analysts", "group", 5, "Sales"),
    ("marketing-team", "group", 7, "Marketing"),
    ("supply-chain-team", "group", 4, "Supply Chain"),
    ("data-platform-admins", "group", 5, "Data Platform"),
    ("execs", "group", 4, "Executive"),
    ("data-engineers", "group", 8, "Data Platform"),
    ("bi-developers", "group", 6, "Analytics"),
]
SERVICE_PRINCIPALS = [
    ("sp-tableau-sync", "service_principal", 1, "IT"),
    ("sp-etl-runner", "service_principal", 1, "Data Platform"),
    ("sp-genie-runtime", "service_principal", 1, "Data Platform"),
]

principals = []  # (principal, principal_type, display_name, department, member_count)
for name, ptype, mc, dept in GROUPS:
    principals.append((name, ptype, name.replace("-", " ").title(), dept, mc))
for name, ptype, mc, dept in SERVICE_PRINCIPALS:
    principals.append((name, ptype, name, dept, mc))
# Individual users
N_USERS = 100
seen_emails = set()
for i in range(N_USERS):
    fn, ln = random.choice(FIRST), random.choice(LAST)
    email = f"{fn.lower()}.{ln.lower()}{i}@northpeak.com"
    if email in seen_emails:
        continue
    seen_emails.add(email)
    dept = random.choice(DEPARTMENTS)
    principals.append((email, "user", f"{fn} {ln}", dept, 1))
# Priya (persona) as a real user
principals.append(("priya.nair@northpeak.com", "user", "Priya Nair", "Data Platform", 1))
USER_EMAILS = [p[0] for p in principals if p[1] == "user"]

# ── Assets ────────────────────────────────────────────────────────────────────
# Story-critical assets (fixed). asset_id, name, type, platform, catalog, schema,
# domain, criticality, has_pii, owner, annual_value_usd.
CATALOG_UC = "prod"
FIXED = [
    ("ASSET-0001", "customer_pii", "table", "Databricks", CATALOG_UC, "customer",
     "customer", "high", True, "priya.nair@northpeak.com", None),
    ("ASSET-0002", "orders_gold", "table", "Databricks", CATALOG_UC, "sales",
     "sales", "high", False, "marcus.chen1@northpeak.com", None),
    ("ASSET-0003", "mv_exec_revenue_daily", "materialized_view", "Databricks", CATALOG_UC,
     "finance", "finance", "high", False, "priya.nair@northpeak.com", None),
    ("ASSET-0004", "Executive Revenue", "tableau_dashboard", "Tableau", "-", "-",
     "finance", "high", False, "elena.rossi2@northpeak.com", None),
    ("ASSET-0005", "Executive Revenue AI/BI", "dbsql_dashboard", "Databricks", "-", "-",
     "finance", "high", False, "elena.rossi2@northpeak.com", None),
    ("ASSET-0006", "finance_monthly_close", "workflow", "Databricks", "-", "-",
     "finance", "high", False, "david.kim3@northpeak.com", 250000),
]
assets = []  # (asset_id, name, type, platform, catalog, schema, domain, crit, pii, owner, created, last_refreshed, annual_value_usd)


def _add(row_fixed, created, refreshed):
    a_id, name, atype, plat, cat, sch, dom, crit, pii, owner, val = row_fixed
    assets.append([a_id, name, atype, plat, cat, sch, dom, crit, pii, owner,
                   created, refreshed, val])


# Fixed assets: sources created long ago; MV + its downstream created 3 weeks ago.
_add(FIXED[0], _d(STORY_START), _d(NOW - timedelta(days=1)))                       # customer_pii
_add(FIXED[1], _d(STORY_START), _d(NOW - timedelta(days=1)))                       # orders_gold
_add(FIXED[2], _d(AFFECTED_MV_DATE), _d(NOW - timedelta(days=1)))                  # the MV
_add(FIXED[3], _d(AFFECTED_MV_DATE + timedelta(days=1)), _d(NOW - timedelta(days=1)))  # Tableau
_add(FIXED[4], _d(AFFECTED_MV_DATE + timedelta(days=1)), _d(NOW - timedelta(days=1)))  # AI/BI
_add(FIXED[5], _d(AFFECTED_MV_DATE + timedelta(days=1)), _d(NOW - timedelta(days=1)))  # workflow

# Type mix for the rest of the estate (~314 more → ~320 total).
TYPE_MIX = (["table"] * 168 + ["view"] * 38 + ["materialized_view"] * 26
            + ["dbsql_dashboard"] * 24 + ["tableau_dashboard"] * 7
            + ["workflow"] * 30 + ["notebook"] * 21)
random.shuffle(TYPE_MIX)

next_id = 7
for atype in TYPE_MIX:
    a_id = f"ASSET-{next_id:04d}"
    next_id += 1
    dom = random.choice(DOMAINS)
    plat = "Tableau" if atype == "tableau_dashboard" else "Databricks"
    is_dataish = atype in ("table", "view", "materialized_view")
    cat = CATALOG_UC if is_dataish else "-"
    sch = dom if is_dataish else "-"
    # criticality ~20 high / 45 med / 35 low
    crit = np.random.choice(["high", "medium", "low"], p=[0.20, 0.45, 0.35])
    # ~15% PII, concentrated on tables/views in customer/marketing domains
    pii_base = 0.30 if (is_dataish and dom in ("customer", "marketing")) else 0.08
    pii = bool(np.random.rand() < pii_base)
    owner = random.choice(USER_EMAILS)
    val = int(np.random.choice([50000, 80000, 120000, 30000, 60000])) if atype == "workflow" else None
    name = f"{dom}_{atype}_{next_id}" if not is_dataish else f"{dom}_{random.choice(['fact','dim','agg','stg','rpt'])}_{next_id}"
    if atype == "tableau_dashboard":
        name = f"{dom.title()} {random.choice(['KPIs','Report','Overview','Trends'])} {next_id}"
    elif atype == "dbsql_dashboard":
        name = f"{dom.title()} Dashboard {next_id}"
    elif atype == "workflow":
        name = f"{dom}_{random.choice(['daily','weekly','monthly','close','sync'])}_job_{next_id}"
    elif atype == "notebook":
        name = f"{dom}_analysis_{next_id}"
    created = _rand_date(STORY_START, NOW - timedelta(weeks=5))
    refreshed = _rand_date(datetime.strptime(created, "%Y-%m-%d"), NOW)
    assets.append([a_id, name, atype, plat, cat, sch, dom, str(crit), pii, owner,
                   created, refreshed, val])

# Ensure every asset owner exists as a user principal (fixed assets name owners
# that may not be in the random user pool).
_known = {p[0] for p in principals}
for a in assets:
    owner = a[9]
    if owner not in _known:
        fn = owner.split(".")[0].title()
        principals.append((owner, "user", f"{fn} (owner)", "Data Platform", 1))
        _known.add(owner)
USER_EMAILS = [p[0] for p in principals if p[1] == "user"]

asset_by_id = {a[0]: a for a in assets}
ids_by_type = {}
for a in assets:
    ids_by_type.setdefault(a[2], []).append(a[0])

# ── Lineage edges (a coherent DAG) ────────────────────────────────────────────
# Layering by type so flow goes sources → derived tables → MV/view → dashboards
# /workflows/notebooks. Baseline edges spread across the year (~2-5/day); the MV
# sub-graph edges all created in the AFFECTED_MV_DATE window.
edges = []  # (edge_id, source_id, target_id, edge_type, created_date, is_active)
edge_seq = 1


def _add_edge(src, tgt, etype, created):
    global edge_seq
    edges.append([f"EDGE-{edge_seq:05d}", src, tgt, etype, created, True])
    edge_seq += 1


tables = ids_by_type.get("table", [])
views = ids_by_type.get("view", [])
mvs = [i for i in ids_by_type.get("materialized_view", []) if i != "ASSET-0003"]
dbsql = [i for i in ids_by_type.get("dbsql_dashboard", []) if i != "ASSET-0005"]
tableau = [i for i in ids_by_type.get("tableau_dashboard", []) if i != "ASSET-0004"]
workflows = [i for i in ids_by_type.get("workflow", []) if i != "ASSET-0006"]
notebooks = ids_by_type.get("notebook", [])

# helper: a "baseline" created date (weighted to ~2-5/day, avoiding the MV window)
def _baseline_date():
    d = STORY_START + timedelta(days=int(np.random.randint(0, 360)))
    # keep baseline out of the MV burst window so the spike stands alone
    if abs((d - AFFECTED_MV_DATE).days) <= 2:
        d = d - timedelta(days=7)
    return _d(d)


# derived tables read from 1-3 source tables (same/other domain), views read tables,
# MVs read tables/views, dashboards read MVs/views/tables, workflows read MVs/tables,
# notebooks read tables.
def _wire(consumers, producer_pool, etype, k_lo, k_hi):
    for c in consumers:
        k = np.random.randint(k_lo, k_hi + 1)
        for src in random.sample(producer_pool, min(k, len(producer_pool))):
            if src != c:
                _add_edge(src, c, etype, _baseline_date())


# split tables into "source" (no upstream) and "derived" for realistic depth
random.shuffle(tables)
src_tables = tables[: len(tables) // 2]
derived_tables = tables[len(tables) // 2:]
_wire(derived_tables, src_tables, "derived_from", 1, 3)
_wire(views, src_tables + derived_tables, "derived_from", 1, 2)
_wire(mvs, derived_tables + views, "derived_from", 1, 2)
_wire(dbsql, mvs + views + derived_tables, "reads", 1, 3)
_wire(tableau, mvs + views + derived_tables, "reads", 1, 2)
_wire(workflows, mvs + derived_tables, "reads", 1, 2)
_wire(notebooks, src_tables + derived_tables, "reads", 1, 2)

# ── The catalyst sub-graph — created in the AFFECTED_MV_DATE window ───────────
MV = "ASSET-0003"
mv_window_dates = [_d(AFFECTED_MV_DATE), _d(AFFECTED_MV_DATE + timedelta(days=1)),
                   _d(AFFECTED_MV_DATE + timedelta(days=2))]
NEW_FROM_MV = set()  # edge_ids

# 2 upstream edges into the MV
for src in ("ASSET-0001", "ASSET-0002"):   # customer_pii, orders_gold
    _add_edge(src, MV, "derived_from", random.choice(mv_window_dates))
    NEW_FROM_MV.add(edges[-1][0])

# 18 downstream edges from the MV: the 3 fixed consumers + 15 more.
# The 15 extras are pure *leaf consumers* (dashboards / notebooks — out-degree 0)
# so the MV's downstream sub-graph contains exactly ONE workflow
# (finance_monthly_close, $250K) → blast_radius_usd resolves to exactly $250K.
fixed_down = ["ASSET-0004", "ASSET-0005", "ASSET-0006"]
leaf_pool = [a[0] for a in assets
             if a[0] not in (MV, "ASSET-0001", "ASSET-0002") + tuple(fixed_down)
             and a[2] in ("dbsql_dashboard", "tableau_dashboard", "notebook")]
extra_down = random.sample(leaf_pool, 15)
for tgt in fixed_down + extra_down:
    etype = "reads" if asset_by_id[tgt][2] in ("dbsql_dashboard", "tableau_dashboard", "workflow", "notebook") else "derived_from"
    _add_edge(MV, tgt, etype, random.choice(mv_window_dates))
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


# downstream_count = DIRECT fan-out (out-degree) — "how many assets this one
# directly feeds". The MV's deliberate 18-edge burst makes it the clear #1.
# blast_radius_usd = transitive: total $ of downstream *workflows* reachable
# (so a change to this asset puts that workflow value at risk).
downstream_count = {}
blast_radius = {}
for a in assets:
    downstream_count[a[0]] = len(adj.get(a[0], []))
    ds = _downstream(a[0])
    blast_radius[a[0]] = sum(annual_value[d] for d in ds
                             if asset_by_id[d][2] == "workflow")

# ── Access grants ─────────────────────────────────────────────────────────────
grants = []  # (grant_id, asset_id, principal, principal_type, privilege, granted_by, granted_date, member_count, is_over_broad)
grant_seq = 1
principal_lookup = {p[0]: p for p in principals}  # name -> (name,type,display,dept,mc)


def _add_grant(asset_id, principal, privilege, over_broad, granted_date=None):
    global grant_seq
    p = principal_lookup[principal]
    grants.append([f"GRANT-{grant_seq:05d}", asset_id, principal, p[1], privilege,
                   random.choice(["priya.nair@northpeak.com", "sp-etl-runner"]),
                   granted_date or _rand_date(STORY_START, NOW), p[4], over_broad])
    grant_seq += 1


# The 3 over-broad grants (verbatim from the spec).
_add_grant("ASSET-0001", "all-analysts", "SELECT", True, random.choice(mv_window_dates))   # customer_pii (PII)
_add_grant("ASSET-0002", "all-analysts", "SELECT", True, random.choice(mv_window_dates))   # orders_gold
_add_grant("ASSET-0003", "contractors", "SELECT", True, random.choice(mv_window_dates))    # the MV

# Scoped grants for the story assets (owners + small role groups).
for a_id in ("ASSET-0001", "ASSET-0002", "ASSET-0003", "ASSET-0005", "ASSET-0006"):
    _add_grant(a_id, "data-platform-admins", "ALL_PRIVILEGES", False)
    _add_grant(a_id, "finance-analysts", "SELECT", False)
    _add_grant(a_id, asset_by_id[a_id][9], "ALL_PRIVILEGES", False)  # owner
_add_grant("ASSET-0004", "execs", "SELECT", False)          # Tableau consumers
_add_grant("ASSET-0004", "sp-tableau-sync", "SELECT", False)
_add_grant("ASSET-0006", "sp-etl-runner", "EXECUTE", False)

# Scoped grants across the rest of the estate — mostly small role groups + a few
# individuals. A handful of *other* PII tables get scoped-only grants (so the
# exposure ranking clearly puts customer_pii on top).
role_groups = ["finance-analysts", "sales-analysts", "marketing-team",
               "supply-chain-team", "bi-developers", "data-engineers", "execs"]
for a in assets:
    if a[0] in ("ASSET-0001", "ASSET-0002", "ASSET-0003", "ASSET-0004", "ASSET-0005", "ASSET-0006"):
        continue
    n_grants = np.random.randint(1, 4)
    chosen = random.sample(role_groups, min(n_grants, len(role_groups)))
    for g in chosen:
        priv = "SELECT" if a[2] in ("table", "view", "materialized_view") else \
               ("EXECUTE" if a[2] == "workflow" else "SELECT")
        _add_grant(a[0], g, priv, False)
    # occasionally an individual user grant
    if np.random.rand() < 0.4:
        _add_grant(a[0], random.choice(USER_EMAILS), "SELECT", False)
    # data-platform-admins own everything
    if np.random.rand() < 0.5:
        _add_grant(a[0], "data-platform-admins", "ALL_PRIVILEGES", False)

# principals_with_access + has_over_broad_grant per asset (expand member_count)
access_by_asset = defaultdict(lambda: {"people": 0, "over_broad": False, "principals": set()})
for _, a_id, principal, ptype, priv, gb, gd, mc, ob in grants:
    entry = access_by_asset[a_id]
    if principal not in entry["principals"]:
        entry["principals"].add(principal)
        entry["people"] += int(mc)
    if ob:
        entry["over_broad"] = True

print(f"grants={len(grants)}  over_broad={sum(1 for g in grants if g[8])}")

# ── Daily lineage events ──────────────────────────────────────────────────────
# new_edges per day from the edges' created_date; new_edges_from_mv from the burst.
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
# Curated columns for the story-critical tables/MV + column→column edges, so the
# app can expand a table node into its column-level lineage (Unity Catalog
# "column lineage" style). Only the revenue pipeline is modeled at column grain —
# that's the asset the demo drills into.
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
}
for a_id, cols in COLS.items():
    for i, (cname, dtype, pii) in enumerate(cols):
        columns.append((a_id, cname, dtype, pii, i))

# column→column edges feeding mv_exec_revenue_daily (source_asset,source_col →
# mv,target_col + a short transform note). This is the "expand" payload.
col_edges = []  # (source_asset_id, source_column, target_asset_id, target_column, transform)
def _ce(sa, sc, tc, transform):
    col_edges.append((sa, sc, "ASSET-0003", tc, transform))

_ce("ASSET-0002", "order_ts", "revenue_date", "DATE_TRUNC('day', order_ts)")
_ce("ASSET-0002", "region", "region", "passthrough")
_ce("ASSET-0002", "net_amount", "net_revenue", "SUM(net_amount)")
_ce("ASSET-0002", "order_id", "orders_count", "COUNT(DISTINCT order_id)")
_ce("ASSET-0002", "net_amount", "avg_order_value", "AVG(net_amount)")
_ce("ASSET-0001", "segment", "customer_segment", "passthrough (joined on customer_id)")
_ce("ASSET-0001", "customer_id", "orders_count", "JOIN key customer_id")
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

_save([tuple(a) for a in assets],
      "asset_id string, asset_name string, asset_type string, platform string, catalog string, "
      "schema string, domain string, criticality string, has_pii boolean, owner_email string, "
      "created_date string, last_refreshed string, annual_value_usd int",
      "raw_assets", "Governed asset catalog — tables, MVs, views, dashboards, Tableau dashboards, workflows, notebooks.")

_save([tuple(e) for e in edges],
      "edge_id string, source_asset_id string, target_asset_id string, edge_type string, "
      "created_date string, is_active boolean",
      "raw_lineage_edges", "Lineage edges (the DAG). mv_exec_revenue_daily sub-graph edges are created in the 3-weeks-ago window.")

_save([tuple(g) for g in grants],
      "grant_id string, asset_id string, principal string, principal_type string, privilege string, "
      "granted_by string, granted_date string, member_count int, is_over_broad boolean",
      "raw_access_grants", "Access grants per asset. Exactly 3 are flagged is_over_broad (large groups on PII/high-criticality assets).")

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
  COMMENT 'Governed asset catalog enriched with computed downstream_count, blast_radius_usd (sum of downstream workflow value), principals_with_access, and has_over_broad_grant. The dashboard, Genie, and app read this.'
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
  COMMENT 'Access grants denormalized with asset attributes (type, PII, criticality) + principal display name/department. is_over_broad flags the remediation candidates. effective_principals = member_count.'
  AS SELECT
    g.grant_id, g.asset_id, a.asset_name, a.asset_type, a.has_pii AS asset_has_pii, a.criticality AS asset_criticality,
    g.principal, g.principal_type, p.display_name, p.department,
    g.privilege, g.member_count, g.member_count AS effective_principals,
    g.granted_by, g.granted_date, g.is_over_broad
  FROM {CATALOG}.{SCHEMA}.raw_access_grants g
  JOIN {CATALOG}.{SCHEMA}.raw_assets a ON g.asset_id = a.asset_id
  LEFT JOIN {CATALOG}.{SCHEMA}.raw_principals p ON g.principal = p.principal
""")

print("Building gold_lineage_events_daily …")
spark.sql(f"""
  CREATE OR REPLACE TABLE {CATALOG}.{SCHEMA}.gold_lineage_events_daily
  COMMENT 'Daily lineage-edge creation timeseries. new_edges spikes ~3-4x over baseline on the MV publish date; new_edges_from_mv isolates the MV fan-out.'
  AS SELECT CAST(event_date AS DATE) AS date, new_edges, new_edges_from_mv, assets_touched
  FROM {CATALOG}.{SCHEMA}.raw_lineage_events_daily
""")

spark.sql(f"DROP TABLE IF EXISTS {CATALOG}.{SCHEMA}._asset_metrics")

# Column-level lineage tables (revenue pipeline only).
_save([(a, c, d, p, o) for (a, c, d, p, o) in columns],
      "asset_id string, column_name string, data_type string, is_pii boolean, ordinal int",
      "gold_columns", "Columns for the revenue-pipeline assets — powers the app's column-level lineage expansion.")

col_edge_rows = []
for i, (sa, sc, ta, tc, tr) in enumerate(col_edges):
    col_edge_rows.append((f"COLEDGE-{i:04d}", sa, sc, ta, tc, tr))
_save(col_edge_rows,
      "col_edge_id string, source_asset_id string, source_column string, "
      "target_asset_id string, target_column string, transform string",
      "gold_column_lineage", "Column→column lineage feeding mv_exec_revenue_daily (source col → MV col + transform). Powers the app's expand-to-column-lineage view.")

print(f"\nDone. AFFECTED_MV_DATE={AFFECTED_MV_DATE.date()}")
for row in spark.sql(f"SHOW TABLES IN {CATALOG}.{SCHEMA}").collect():
    print(f"  - {row['tableName']}")

import json, uuid

def nid(): return uuid.uuid4().hex

CAT = "solution_builder"
SCH = "demo_lineage_access_for_every_team_b89e91"
def t(name): return f"{CAT}.{SCH}.{name}"

sample_questions = [
    "How many governed assets do we have, and how many new lineage edges appeared this month?",
    "Which asset added the most downstream connections in the last month?",
    "What feeds the Executive Revenue Tableau dashboard?",
    "Who can access customer_pii?",
    "What breaks downstream if mv_exec_revenue_daily changes? Include workflow value.",
    "Which PII tables are readable by the most principals?",
]

example_sqls = [
    ("Which asset added the most downstream connections?",
     f"SELECT asset_name, asset_type, downstream_count, blast_radius_usd FROM {t('gold_assets')} ORDER BY downstream_count DESC LIMIT 5"),
    ("Who can access customer_pii?",
     f"SELECT asset_name, principal, principal_type, privilege, member_count FROM {t('gold_access_grants')} WHERE asset_name = 'customer_pii' ORDER BY member_count DESC"),
    ("What breaks downstream if mv_exec_revenue_daily changes, and what workflow value is at risk?",
     f"SELECT e.target_asset_name, e.target_asset_type, a.annual_value_usd FROM {t('gold_lineage_edges')} e LEFT JOIN {t('gold_assets')} a ON e.target_asset_id = a.asset_id WHERE e.source_asset_name = 'mv_exec_revenue_daily' AND e.is_new_from_mv ORDER BY a.annual_value_usd DESC NULLS LAST"),
]

text = [
    "## PURPOSE",
    "- Answer questions about Northpeak Retail's Unity Catalog governance graph: asset lineage, downstream blast radius, and access grants.",
    "- Audience is Priya Nair, Head of Data Platform (non-DBA) — keep answers plain and business-oriented.",
    "## DISAMBIGUATION",
    "- 'blast radius' means downstream workflow value at risk: use gold_assets.blast_radius_usd (SUM of downstream workflow annual_value_usd).",
    "- 'what feeds X' means walk gold_lineage_edges backward: rows WHERE target_asset_name = X give the upstream sources.",
    "- The recent event: mv_exec_revenue_daily (a materialized view) was published ~3 weeks ago; its 18 downstream edges have is_new_from_mv = TRUE.",
    "## DATA QUALITY NOTES",
    "- annual_value_usd is non-null only on workflow assets; finance_monthly_close = 250000.",
    "- Group grants expand by member_count (all-analysts = 42 people); principals_with_access already expands this.",
    "## Instructions you must follow when providing summaries",
    "- State the date range when summarizing lineage-edge counts over time.",
]

def cc(cols): return sorted(cols, key=lambda c: c["column_name"])

tables = [
    {"identifier": t("gold_assets"), "column_configs": cc([
        {"column_name": "asset_name", "enable_entity_matching": True, "description": ["Governed asset name, e.g. mv_exec_revenue_daily, customer_pii, Executive Revenue."]},
        {"column_name": "asset_type", "enable_format_assistance": True, "enable_entity_matching": True, "description": ["table / materialized_view / view / dbsql_dashboard / tableau_dashboard / workflow / notebook."]},
        {"column_name": "domain", "enable_format_assistance": True, "enable_entity_matching": True},
        {"column_name": "criticality", "enable_format_assistance": True, "enable_entity_matching": True},
        {"column_name": "has_pii", "description": ["TRUE if the asset contains PII."]},
        {"column_name": "downstream_count", "description": ["Number of assets this one directly feeds (direct fan-out). mv_exec_revenue_daily is the top at 18."], "synonyms": ["downstream connections", "fan-out"]},
        {"column_name": "blast_radius_usd", "description": ["Total annual $ value of downstream workflows reachable from this asset — the value at risk if it changes."], "synonyms": ["blast radius", "value at risk"]},
        {"column_name": "principals_with_access", "description": ["Distinct people who can access this asset (group grants expanded by member_count)."]},
    ])},
    {"identifier": t("gold_lineage_edges"), "column_configs": cc([
        {"column_name": "source_asset_name", "enable_entity_matching": True},
        {"column_name": "target_asset_name", "enable_entity_matching": True},
        {"column_name": "edge_type", "enable_format_assistance": True},
        {"column_name": "is_new_from_mv", "description": ["TRUE for edges on the mv_exec_revenue_daily sub-graph created ~3 weeks ago (the lineage spike)."]},
        {"column_name": "created_date", "description": ["Date the lineage edge was created."]},
    ])},
    {"identifier": t("gold_access_grants"), "column_configs": cc([
        {"column_name": "asset_name", "enable_entity_matching": True},
        {"column_name": "principal", "enable_entity_matching": True, "description": ["User email, group name (e.g. all-analysts, contractors), or service principal."]},
        {"column_name": "principal_type", "enable_format_assistance": True},
        {"column_name": "privilege", "enable_format_assistance": True, "enable_entity_matching": True},
        {"column_name": "member_count", "description": ["People in the principal (1 for users; group size)."]},
        {"column_name": "department", "enable_format_assistance": True},
    ])},
    {"identifier": t("gold_lineage_events_daily"), "column_configs": cc([
        {"column_name": "new_edges", "description": ["New lineage edges created that day (~2-5 baseline; spikes ~3-4x on the MV publish date)."]},
        {"column_name": "new_edges_from_mv", "description": ["Subset of new_edges belonging to the mv_exec_revenue_daily fan-out."]},
    ])},
    {"identifier": t("raw_principals"), "column_configs": cc([
        {"column_name": "principal", "enable_entity_matching": True},
        {"column_name": "department", "enable_format_assistance": True},
    ])},
]
tables = sorted(tables, key=lambda x: x["identifier"])

payload = {
    "version": 2,
    "config": {"sample_questions": sorted([{"id": nid(), "question": [q]} for q in sample_questions], key=lambda x: x["id"])},
    "data_sources": {"tables": tables},
    "instructions": {
        "example_question_sqls": sorted([{"id": nid(), "question": [q], "sql": [s]} for q, s in example_sqls], key=lambda x: x["id"]),
        "text_instructions": [{"id": nid(), "content": text}],
    },
}
print(json.dumps(payload))

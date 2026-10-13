# Northpeak Retail — Lineage & Access Console · Architecture

This diagram matches the deployed solution: the Unity Catalog governance graph (asset lineage,
downstream Tableau + workflow consumers, and access grants) is ingested into a governed Databricks
lakehouse, then surfaced through an AI/BI dashboard, a Genie space, and the Lineage & Access Console
app (Lakebase-backed), all reachable via Genie One.

```json
[
  {
    "name": "Lineage & Access Console — Architecture",
    "story": "Unity Catalog's lineage + access-grant system tables and the Tableau server's asset catalog enter a governed Databricks platform through Lakeflow; the governed governance-graph gold tables then power the AI/BI dashboard, the Genie space, and the Lakebase-backed Lineage & Access Console app — all reached through Genie One. SDP/ML/KA/MAS are out of scope for this Simple build.",
    "aspect": "16:9",
    "theme": "slide",
    "direction": "horizontal",
    "options": { "trademarkLogos": false },
    "columns": ["sources", "data", "work", "entry"],
    "nodes": [
      { "id": "src-uc", "type": "source", "col": "sources", "row": 1, "label": "Unity Catalog metastore", "icon": "databricksMetastore", "desc": "Lineage + access grants", "showDesc": true,
        "ai_reasoning": "the governance graph's primary source — system.lineage + system.access (asset catalog, lineage edges, grants). Talking track: arrives via Lakeflow Connect." },
      { "id": "src-tableau", "type": "source", "col": "sources", "row": 2, "label": "Tableau Server", "icon": "text", "desc": "Downstream BI asset catalog", "showDesc": true,
        "ai_reasoning": "external BI system whose dashboards are downstream consumers (Executive Revenue); no approved logo → icon:text renders a neutral brand badge." },
      { "id": "src-jobs", "type": "source", "col": "sources", "row": 3, "label": "Jobs & Workflows", "icon": "text", "desc": "$250K finance_monthly_close", "showDesc": true,
        "ai_reasoning": "the orchestrated reporting workflows that are downstream consumers with $ value at risk." },
      { "id": "lakeflow-genie-block", "type": "lakeflow-genie-block", "col": "data", "row": 1,
        "ai_reasoning": "the one ingest + bronze→silver→gold block. Here it produces the governance-graph gold tables (gold_assets / gold_lineage_edges / gold_access_grants / gold_columns / gold_column_lineage). Talking track — the Simple build loads them directly, no SDP." },
      { "id": "sql-lakehouse", "type": "sql-lakehouse", "col": "data", "row": 0,
        "ai_reasoning": "governed serving copy the dashboard + Genie read." },
      { "id": "lakebase", "type": "lakebase", "col": "data", "row": 2,
        "ai_reasoning": "OLTP mirror behind the Console app — working asset/grant set + remediation flags + audit trail; synced from the gold tables." },
      { "id": "ai-bi-dashboard", "type": "ai-bi-dashboard", "col": "work", "row": 1, "label": "Lineage & Access Dashboard",
        "ai_reasoning": "the edge-spike + blast-radius + PII-exposure dashboard." },
      { "id": "genie", "type": "genie", "col": "work", "row": 2, "label": "Lineage & Access Genie",
        "ai_reasoning": "NL over the governance graph — what feeds the dashboard, who can access it." },
      { "id": "console-app", "type": "databricks-apps-work", "col": "work", "row": 3, "label": "Lineage & Access Console",
        "ai_reasoning": "the hero app — lineage graph explorer + column-level lineage + access panel + Genie-backed remediation agent." },
      { "id": "genie-one", "type": "genie-one", "col": "entry", "rot": 90,
        "ai_reasoning": "business-user front door onto the dashboard / Genie / app; persona built in; rotated into a slim lane." },
      { "id": "db-platform", "type": "db-platform", "pin": { "at": "top-left", "to": "platform-box" } },
      { "id": "governance-block", "type": "governance-block", "pin": { "at": "bottom", "to": "platform-box" },
        "ai_reasoning": "Unity Catalog governs the whole platform — and IS the subject of this demo (lineage + grants); pinned as a full-width bar." },
      { "id": "platform-box", "type": "box", "z": -1, "pad": 40,
        "wraps": ["lakeflow-genie-block", "sql-lakehouse", "lakebase", "ai-bi-dashboard", "genie", "console-app", "genie-one"],
        "ai_reasoning": "wraps only Databricks components; the metastore/Tableau/jobs sources stay outside the platform boundary." }
    ],
    "edges": [
      { "id": "e1", "from": "src-uc", "to": "lakeflow-genie-block@in-lakeflow-connect", "flow": true },
      { "id": "e2", "from": "src-tableau", "to": "lakeflow-genie-block@in-lakeflow-connect", "flow": true },
      { "id": "e3", "from": "src-jobs", "to": "lakeflow-genie-block@in-lakeflow-connect", "flow": true },
      { "id": "e4", "from": "lakeflow-genie-block", "to": "sql-lakehouse", "flow": true },
      { "id": "e5", "from": "lakeflow-genie-block", "to": "lakebase", "flow": true },
      { "id": "e6", "from": "sql-lakehouse", "to": "ai-bi-dashboard", "flow": true },
      { "id": "e7", "from": "sql-lakehouse", "to": "genie", "flow": true },
      { "id": "e8", "from": "lakebase", "to": "console-app", "flow": true },
      { "id": "e9", "from": "genie@b", "to": "console-app@t", "ai_reasoning": "the app's assistant delegates to the Genie space" },
      { "id": "e10", "from": "ai-bi-dashboard@b", "to": "console-app@t", "ai_reasoning": "the app embeds the dashboard" },
      { "id": "e11", "from": "genie-one", "to": "ai-bi-dashboard" },
      { "id": "e12", "from": "genie-one", "to": "genie" },
      { "id": "e13", "from": "genie-one", "to": "console-app" }
    ]
  }
]
```

# Northpeak Retail — Lineage & Access Console

> A Databricks demo for the **data platform / governance** team: one console to see the **lineage** of every table & materialized view, the **downstream Tableau dashboards and workflows** they feed, and **who can access** each asset — before a change breaks a $250K workflow or an over-broad grant leaks PII. Built on synthetic Unity Catalog governance data → AI/BI Dashboard + Genie + a Databricks App (Lakebase-backed remediation).

## The Story

| | |
|---|---|
| **Company** | Northpeak Retail — national omnichannel retailer, central lakehouse platform |
| **Hero** | Priya Nair, Head of Data Platform (owns governance, lineage, access) |
| **Problem** | 3 weeks ago a new materialized view (`mv_exec_revenue_daily`) appeared and its lineage fan-out spiked — it now feeds a **Tableau** "Executive Revenue" dashboard and a **$250K/yr finance reporting workflow**. Priya has no single place to see who can access each asset and what breaks downstream if the pipeline changes. |
| **Investigation** | Priya opens the Lineage & Access Console, sees the lineage-edge spike, drills into the new MV, and finds it reads from `customer_pii` — a table the entire `all-analysts` group can `SELECT` via an over-broad group grant (42 principals). |
| **Root cause** | The new MV silently widened blast radius: one MV now sits between a PII-bearing source and a $250K executive workflow, and the access on its upstream was never scoped. |
| **Resolution** | Priya asks Genie *"what feeds the executive revenue dashboard and who can access it?"*, confirms the 3 over-broad grants, and flags them for revocation review in one click — protecting the $250K workflow and closing the PII access gap. |
| **Impact** | 1 MV, 18 new downstream edges, **$250K workflow** + 1 Tableau dashboard at risk, **42 principals** with unscoped access to PII — all visible and remediated from one screen. |

---

## Overview

Priya runs Northpeak's central lakehouse — hundreds of tables and materialized views, dozens of dashboards, downstream Tableau reports, and orchestrated finance workflows, all governed by Unity Catalog. Governance is invisible until something changes.

Three weeks ago, something changed. A new materialized view `mv_exec_revenue_daily` was published. Its lineage fan-out spiked overnight — it now feeds the Tableau **Executive Revenue** dashboard and a **$250K/yr** finance reporting workflow. Two questions land on Priya's desk at once: *"If we refactor the revenue pipeline, what breaks?"* and *"Who can actually see this data?"*

Today those answers live in three different tools. The **Lineage & Access Console** puts them in one: the lineage graph (upstream sources → the MV → downstream Tableau + workflow), the access panel (every user and group that can touch each asset), and the downstream **blast radius in dollars**. Priya asks Genie one question, sees the over-broad `all-analysts` grant on the PII source, and flags it for revocation — human-in-the-loop, audited, done.

**Duration:** 6–8 minutes.

---

## Key Numbers

| Metric | Value |
|--------|-------|
| Total governed assets | ~320 (tables, MVs, dashboards, Tableau, workflows) |
| New MV published | `mv_exec_revenue_daily` — 3 weeks ago |
| New downstream lineage edges from the MV | 18 (spike from ~0) |
| Downstream Tableau dashboards | 1 (Executive Revenue) |
| Downstream reporting workflow value | **$250K / yr** |
| Principals with SELECT on the PII source | 42 (via `all-analysts` group grant) |
| Over-broad grants flagged for review | 3 |

---

## Demo Walkthrough

**Frame:** Monday. A refactor of the revenue pipeline is scheduled. Priya needs to know the blast radius and the access exposure before signing off.

### Act 1 — Spot the spike (1–2 min)

**Open the Northpeak Lineage & Access dashboard.**

KPI tiles: ~320 governed assets, 18 new downstream edges this month, $250K workflow value at risk, 42 principals with PII access. The **lineage-edges-over-time** line shows a clear 3x spike three weeks ago and a tail — the moment the new MV went live and fanned out. A bar of **top assets by downstream count** puts `mv_exec_revenue_daily` at the top; a **criticality × PII** matrix flags the assets that are both business-critical and PII-bearing.

> *"This is **AI/BI Dashboards** over **Unity Catalog** governance data — lineage, grants, and asset metadata that Databricks tracks for you. The asset catalog here was populated as if it came in through **Lakeflow Connect** from the metastore and the Tableau server — no custom plumbing."*

### Act 2 — Ask why, in Genie (1–2 min)

**Open the Genie space attached to the dashboard.**

**Priya types:** `What feeds the Executive Revenue Tableau dashboard, and who can access those tables?`

Genie walks lineage backward: Tableau dashboard ← `mv_exec_revenue_daily` ← `customer_pii` + `orders_gold`, then joins access grants and surfaces that `customer_pii` is readable by the entire `all-analysts` group (42 principals). Follow-up: `Which assets did mv_exec_revenue_daily add downstream 3 weeks ago?` returns the 18 edges and the $250K workflow.

> *"**AI/BI Genie** — natural language over the same governed tables. No JOIN across lineage + grants written by hand. Same Unity Catalog, same permissions, same answer as the dashboard."*

### Act 3 — Investigate & remediate in the Console (3–4 min)

**Open the Northpeak Lineage & Access Console (the app).**

The console's hero is a **lineage graph** for the selected asset — upstream sources and downstream consumers as a network, Tableau and workflow nodes clearly marked, node color = criticality, a PII badge on the exposed source. Selecting `mv_exec_revenue_daily` lights up the full path to the Tableau dashboard and the $250K workflow, and the side panel lists **every principal that can access each asset** with an "over-broad" flag on the `all-analysts` grant.

In the assistant dock, **Priya types:** `Review over-broad access to the revenue pipeline`. The Genie-backed agent traces the pipeline, identifies the 3 over-broad grants on PII-bearing sources, drafts a **revocation-review request** (asset, principal, current privilege, justification), and **stops for approval**. Priya approves. The grants flip to `flagged_for_review`, an audit timeline records who/what/when, and the KPI cards tick down the exposed-principal count live.

> *"This is **Databricks Apps + Lakebase** — a React + Node app hosted on Databricks with OAuth. The console reads lineage & access from the lakehouse and mirrors the working set into **Lakebase** (serverless Postgres) so remediation flags and the audit trail are transactional. The assistant is one Genie-backed agent that investigates, drafts, and — only after Priya approves — writes."*

### Act 4 — Zoom out: Databricks One (30s)

> *"Priya's team uses the console because they take governance actions daily. Everyone else — security, finance, auditors — gets the same lineage and access answers from **Databricks One**: same dashboard, same Genie space, same Unity Catalog governance, no code."*

### Closing

> **Lineage, access, and downstream blast radius — for every asset, in one place.** See what a change breaks and who can see the data *before* it becomes an incident. Ingest the governance graph once, ask in natural language, act with an audit trail. Same governance covers the table, the materialized view, the Tableau dashboard, and the $250K workflow.

---

## Products Showcased

| Product | Mode | What it does in this demo |
|---------|------|---------------------------|
| **Synthetic Data Generation** | Build | Generates a realistic Unity Catalog governance graph — ~320 assets (tables, MVs, dashboards, Tableau, workflows), lineage edges (with the 3-weeks-ago MV spike), access grants (with the over-broad `all-analysts` grant), and a daily lineage-events timeseries — into gold tables the dashboard, Genie, and app consume. |
| **Lakeflow Connect** | Talk track | "In production this is how the metastore's lineage/grants and the Tableau server's asset catalog arrive — managed connectors, no custom plumbing." |
| **AI/BI Dashboard** | Build | The lineage-edge spike, downstream blast radius, and PII-access exposure at a glance. |
| **AI/BI Genie** | Build | Answers *"what feeds this dashboard and who can access it?"* by walking lineage + grants in natural language. |
| **Databricks Apps** | Build | Hosts the Lineage & Access Console — lineage graph explorer + access panel + Genie-backed remediation agent. |
| **Lakebase** | Build | Serverless Postgres behind the app — the working asset/grant set, remediation flags, and audit timeline. |
| **Unity Catalog** | Talk track | The source of the lineage and access model; one permission layer across tables, MVs, dashboards, and the app. |
| **Genie One** | Talk track | The business-user front door — same governed answers for security, finance, and audit. |
| **Genie Code** | Talk track | AI authoring assist inside the SQL/Genie editor — referenced, not provisioned. |

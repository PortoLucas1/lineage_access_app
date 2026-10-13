# App Specification — Overview, Home & Assistant

> **Build-time note.** Read `DEMO_SKILL_DIR/app/app.md` FIRST and follow it end-to-end (rsync template → customize → Lakebase → env → smoke test). This is **not** a from-scratch build: the template at `DEMO_SKILL_DIR/app/app_template/` is a Node.js + React + Express app with Lakebase, MLflow tracing, OBO auth, chat dock, and scripted demo chain wired. rsync into `PROJECT/app/`, read `TEMPLATE_MAP.md`, then **rewrite the domain pieces wholesale** — this demo's primary surface is a **lineage graph explorer**, not a returns queue, so the operations page is a full rewrite (see `01_LINEAGE_EXPLORER.md`). On conflict: `app.md` governs *how*, this spec governs *what*.

> **Simple-demo contract.** A **Lineage & Access Console**: an embedded dashboard + Genie + a **single Genie-backed agent** that reviews over-broad access on the revenue pipeline, drafts revocation-review requests for the 3 flagged grants, and waits for one approval before flipping them to `flagged_for_review` in Lakebase. **No MAS, no KA, no ML.** The agent's only data tool is **Genie, used directly** (leave `masEndpointName` empty, set `genieSpaceId` in `config/app.json`; swap `ask_mas` → `askGenieTool` in `makeTools` per `app.md`).

## Pitch

One console where Priya sees the **lineage** of any table / materialized view, the **downstream Tableau dashboards and workflows** it feeds, and **who can access** each asset. She selects the new `mv_exec_revenue_daily`, sees it light a path from the PII source `customer_pii` to the Executive Revenue Tableau dashboard and the $250K workflow, and the access panel flags the over-broad `all-analysts` grant. The dock assistant investigates via Genie, drafts a revocation-review request for the 3 flagged grants, and — only after Priya approves — writes the flags + audit trail to Lakebase, and the KPI cards tick down the exposed-principal count live.

## Databricks capabilities mapped

| Capability | Where it shows |
|---|---|
| **SQL Warehouse on Delta** | Lineage graph + access panel + analytics query the live `gold_*` tables |
| **AI/BI Genie (single-agent tool)** | The dock assistant has one `ask_data` tool that calls Genie directly |
| **Lakebase** | OLTP write surface — the working grant set, remediation flags (`flagged_for_review`), append-only audit trail. Same UC governance as Delta |
| **MLflow tracing** | Per-turn traces with tool spans; thumbs → assessments; header links to the experiment |
| **Databricks Apps** | SSO, OBO auth (actions stamped with Priya's email), auto-scaling |
| **AI/BI Dashboards** | Embedded as iframe with SSO |

## Pages

| Page | Purpose | Key capability |
|---|---|---|
| **Home** | Narrative landing — story, persona, journey diagram, starter chips, featured action, activity feed | Config-driven (`config/app.json`) |
| **Lineage Explorer** (primary) | The hero: an interactive **lineage graph** for a selected asset (upstream sources → asset → downstream consumers), a right-side **Access panel** listing every principal that can touch each node with an over-broad flag, and KPI cards (Assets / New edges / Blast radius $ / Principals with PII access). See `01_LINEAGE_EXPLORER.md` | **SQL Warehouse** on Delta + **Lakebase** for flags |
| **Analytics** | Warehouse-backed charts: new-edges-per-day trend, top assets by downstream count, PII assets by exposure. Links into Lineage Explorer for a selected asset | **SQL Warehouse** on Delta |
| **Dashboard** | Embedded AI/BI dashboard iframe | **AI/BI Dashboards** |

## Assistant

Lives on every page. Floating dock (bottom-right, persistent per user) + full-page chat. Thinking panel streams reasoning + tool calls (Genie query, asset found, grants flagged) live and persists on the message as `thinking[]` JSONB.

### Human-in-the-loop — strict 3-phase action chain

1. **Discover** (read-only) — trace the revenue pipeline from a seed asset (`mv_exec_revenue_daily`), find its downstream blast radius (Tableau + $250K workflow) and the over-broad grants on its upstream PII sources.
2. **Draft + confirm** — build a **revocation-review request**: for each of the 3 flagged grants list `asset`, `principal`, `member_count`, `current privilege`, and a one-line `justification`. Show the summary (3 grants, 42+ principals affected, the PII asset) → **STOP, wait for approval**.
3. **Execute** (after "yes") — one atomic UPDATE against Lakebase: flip the 3 grants' `status` → `flagged_for_review`, stamp `reviewed_by` = Priya's email, append an audit entry per grant. Emit `dataMutated`.

> **Write tools must trigger a visible UI refresh.** The write tool (`flag_grants_for_review`) publishes `dataMutated` on commit. The Lineage Explorer subscribes and refetches: the **Principals with PII access** KPI ticks down, the flagged grants in the access panel gain a `Flagged for review` badge, and any open node drawer re-fetches its audit timeline. The user must **see** it change without reloading — this is the moment the demo lands.

### Agent tools (Northpeak — 4 tools, in demo-loop order)

| Tool | What it does | Phase |
|---|---|---|
| `ask_data` | Calls Genie. Streams the question + Genie's tool calls into the Thinking panel (lineage + access answers). | Investigation |
| `find_pipeline_exposure` | Queries Lakebase: for a seed asset, returns downstream consumers (Tableau + workflow with $ value) and the over-broad grants on its upstream PII sources (asset, principal, member_count, privilege). | Discovery |
| `draft_revocation_review` | Pure function — builds the revocation-review request object (list of {asset, principal, member_count, privilege, justification}) for the flagged grants. Called **once**. | Draft |
| `flag_grants_for_review` | Bulk: SELECTs the flagged grants, sets `status='flagged_for_review'`, `reviewed_by`, appends audit entries — **one atomic UPDATE against Lakebase**. Input: the review request from `draft_revocation_review`. | Execution (requires approval) |

## Home page

**Story section:** Persona badge (*"Priya Nair · Head of Data Platform · Northpeak Retail"*), headline (*"A new materialized view just widened your blast radius"*), situation (`mv_exec_revenue_daily` published 3 weeks ago, 18 new downstream edges, now feeds the Executive Revenue Tableau dashboard + a $250K/yr workflow, reads from a PII table 42 people can access), goal (see the lineage → see who has access → flag the over-broad grants), preview bullets.

**Journey diagram:** 3-beat strip — *See the spike* → Lineage Explorer | *Ask why* → chat | *Flag it* → remediation flow.

**Starter chips:** *"What feeds the Executive Revenue dashboard?"* / *"Who can access customer_pii?"* / *"What breaks if mv_exec_revenue_daily changes?"* — each starts a fresh conversation.

**Featured action card:** *"Review over-broad access to the revenue pipeline"* — one click triggers the investigate → draft revocation-review → approve flow.

**Activity feed:** Live tail of agent actions (*"Flagged 3 over-broad grants on the revenue pipeline for review"*, *"Reviewed all-analysts SELECT on customer_pii"*). Auto-refreshes.

## Scripted demo flow (~2–3 min)

Assistant supports a scripted chain via `config.assistantScript` with `triggerAfter` keywords.

**Step 1 — "What feeds the Executive Revenue dashboard, and who can access those tables?"**
Always available. `ask_data` → Genie streams: Tableau ← `mv_exec_revenue_daily` ← `customer_pii` + `orders_gold` → then the grants on `customer_pii` → surfaces the over-broad `all-analysts` (42) grant. Suggests reviewing the pipeline's access.

**Step 2 — "Review the over-broad access on the revenue pipeline."**
Unlocks when *"access"* / *"grant"* / *"pipeline"* appears. `find_pipeline_exposure` → reports 3 over-broad grants, the PII asset, 42+ affected principals, and the $250K downstream workflow. `draft_revocation_review` builds the request. Shows the 3 grants + justifications → **stops and waits**.

**Step 3 — "Yes — flag them for review."**
Unlocks when *"flag"* / *"approve"* / *"review"* appears. `flag_grants_for_review` runs one atomic UPDATE on Lakebase: `status='flagged_for_review'`, `reviewed_by`, audit entry per grant. Emits `dataMutated`. On screen: the **Principals with PII access** KPI drops, the 3 grants gain the `Flagged for review` badge, the access panel re-renders. **That live cascade is the story beat.**

All narrative config lives in `config/app.json`. Read it directly.

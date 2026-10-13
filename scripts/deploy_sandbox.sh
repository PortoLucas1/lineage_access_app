#!/usr/bin/env bash
# Deploy the Lineage Access demo to the melissap FEVM sandbox workspace.
#
# Prerequisite (one-time, interactive SSO):
#   databricks auth login \
#     --host https://fe-sandbox-serverless-sandbox-melissap.cloud.databricks.com \
#     --profile fe-vm-melissap
#
# Usage:
#   ./scripts/deploy_sandbox.sh [--warehouse-id <id>] [--profile <name>]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
export PATH="/opt/homebrew/opt/libpq/bin:$PATH"

PROFILE="${DATABRICKS_CONFIG_PROFILE:-fe-vm-melissap}"
WAREHOUSE_ID=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile) PROFILE="$2"; shift 2 ;;
    --warehouse-id) WAREHOUSE_ID="$2"; shift 2 ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

PROFILE_FLAG=(--profile "$PROFILE")
export DATABRICKS_CONFIG_PROFILE="$PROFILE"

echo "[deploy] checking auth for profile: $PROFILE"
if ! databricks auth profiles 2>/dev/null | awk -v p="$PROFILE" '$1==p && $NF=="YES" { ok=1 } END { exit ok ? 0 : 1 }'; then
  echo "[deploy] Profile '$PROFILE' is missing or expired." >&2
  echo "Run this first (complete SSO in the browser):" >&2
  echo "  databricks auth login --host https://fe-sandbox-serverless-sandbox-melissap.cloud.databricks.com --profile $PROFILE" >&2
  exit 1
fi

if [[ -z "$WAREHOUSE_ID" ]]; then
  echo "[deploy] discovering SQL warehouse..."
  WAREHOUSE_ID="$(databricks warehouses list "${PROFILE_FLAG[@]}" -o json \
    | python3 -c "
import sys, json
items = json.load(sys.stdin)
warehouses = items if isinstance(items, list) else items.get('warehouses', [])
running = [w for w in warehouses if w.get('state') == 'RUNNING']
pick = (running or warehouses)[0] if warehouses else {}
print(pick.get('id', ''))
")"
fi
[[ -n "$WAREHOUSE_ID" ]] || { echo "[deploy] ERROR: no SQL warehouse found. Pass --warehouse-id." >&2; exit 1; }
echo "[deploy] warehouse_id: $WAREHOUSE_ID"

CATALOG="serverless_sandbox_melissap_catalog"
SCHEMA="demo_lineage_access_for_every_team_b89e91"
DB_NAME="dbgen_lineage_access"
APP_NAME="dbgen-lineage-access"
PROJECT_SLUG="dbdemos-asset-generator"

echo "[deploy] step 1/5: Lakebase database"
./app/scripts/lakebase_setup_db.sh --db-name "$DB_NAME"

echo "[deploy] step 2/5: bundle deploy"
databricks bundle deploy "${PROFILE_FLAG[@]}" \
  --var "catalog=$CATALOG" \
  --var "schema=$SCHEMA" \
  --var "warehouse_id=$WAREHOUSE_ID"

echo "[deploy] step 3/5: setup job"
databricks bundle run lineage_access_setup "${PROFILE_FLAG[@]}" \
  --var "catalog=$CATALOG" \
  --var "schema=$SCHEMA" \
  --var "warehouse_id=$WAREHOUSE_ID"

echo "[deploy] step 4/5: Lakebase app credential grant"
./app/scripts/lakebase_grant_app_credential.sh \
  --app-name "$APP_NAME" \
  --project-id "$PROJECT_SLUG" \
  --db-name "$DB_NAME"

echo "[deploy] step 5/5: finalize app env + deploy"
./app/scripts/finalize_app.sh --profile "$PROFILE"

echo "[deploy] done."

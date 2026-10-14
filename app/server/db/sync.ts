import { sql } from 'drizzle-orm';
import { getExecutionContext } from '@databricks/appkit';
import type { AppDb } from './index.js';
import { assets, lineageEdges, accessGrants, assetColumns, columnLineage } from './schema.js';

/**
 * One-shot Delta → Lakebase sync for the Lineage & Access Console.
 *
 * Pulls the governance graph subset (assets + lineage edges + access grants)
 * from the `gold_*` Delta tables via the Databricks SQL Statements API into
 * the Lakebase mirror. Idempotent in the "only-if-destination-empty" sense —
 * if `app.assets` already has rows we skip. Pass `{ forceIfAnyEmpty: true }`
 * to re-sync (used by the "Reset demo" button).
 *
 * All grants are synced with status='active', reviewedBy=null, auditTrail=[].
 */

export type DataConfig = {
  catalog: string;
  schema: string;
  tables: {
    /** gold_assets — the governed asset catalog + computed columns. */
    assets: string;
    /** gold_lineage_edges — the DAG the graph explorer renders. */
    lineageEdges: string;
    /** gold_access_grants — the access panel source + remediation target. */
    accessGrants: string;
    /** gold_lineage_events_daily — analytics only (queried live, not mirrored). */
    lineageEvents?: string;
    /** gold_columns — columns/fields for every governed object. */
    columns?: string;
    /** gold_column_lineage — column→column mappings for object lineage edges. */
    columnLineage?: string;
  };
};

export async function syncFromDelta(
  db: AppDb,
  cfg: DataConfig,
  opts: { forceIfAnyEmpty?: boolean } = {},
): Promise<void> {
  const exists = await db.execute(sql`SELECT COUNT(*)::int AS n FROM app.assets`);
  const n = (exists.rows[0] as { n: number } | undefined)?.n ?? 0;
  if (n > 0 && !opts.forceIfAnyEmpty) return;

  const warehouseId = process.env.DATABRICKS_WAREHOUSE_ID;
  if (!warehouseId) {
    console.warn('[sync] DATABRICKS_WAREHOUSE_ID not set — skipping Delta sync');
    return;
  }

  console.log('[sync] Starting Delta → Lakebase sync (parallel)…');
  const t0 = Date.now();

  const fq = (name: 'assets' | 'lineageEdges' | 'accessGrants' | 'columns' | 'columnLineage') =>
    `${cfg.catalog}.${cfg.schema}.${cfg.tables[name]}`;
  const colTable = cfg.tables.columns ?? 'gold_columns';
  const colLinTable = cfg.tables.columnLineage ?? 'gold_column_lineage';

  const [assetRows, edgeRows, grantRows] = await Promise.all([
    execSql<{
      asset_id: string;
      asset_name: string;
      asset_type: string;
      platform: string | null;
      catalog: string | null;
      schema: string | null;
      domain: string | null;
      criticality: string | null;
      has_pii: boolean | null;
      owner_email: string | null;
      created_date: string | null;
      last_refreshed: string | null;
      downstream_count: number | null;
      principals_with_access: number | null;
      has_over_broad_grant: boolean | null;
    }>(
      warehouseId,
      `SELECT asset_id, asset_name, asset_type, platform, catalog, schema,
              domain, criticality, has_pii, owner_email, created_date,
              last_refreshed, downstream_count, principals_with_access,
              has_over_broad_grant
       FROM ${fq('assets')}`,
    ),
    execSql<{
      edge_id: string;
      source_asset_id: string;
      source_asset_name: string | null;
      source_asset_type: string | null;
      source_has_pii: boolean | null;
      target_asset_id: string;
      target_asset_name: string | null;
      target_asset_type: string | null;
      target_criticality: string | null;
      edge_type: string | null;
      created_date: string | null;
      is_new_from_mv: boolean | null;
    }>(
      warehouseId,
      `SELECT edge_id, source_asset_id, source_asset_name, source_asset_type,
              source_has_pii, target_asset_id, target_asset_name,
              target_asset_type, target_criticality, edge_type, created_date,
              is_new_from_mv
       FROM ${fq('lineageEdges')}`,
    ),
    execSql<{
      grant_id: string;
      asset_id: string;
      asset_name: string | null;
      asset_type: string | null;
      asset_has_pii: boolean | null;
      asset_criticality: string | null;
      principal: string;
      principal_type: string | null;
      display_name: string | null;
      department: string | null;
      privilege: string | null;
      member_count: number | null;
      effective_principals: number | null;
      is_over_broad: boolean | null;
      granted_by: string | null;
      granted_date: string | null;
    }>(
      warehouseId,
      `SELECT grant_id, asset_id, asset_name, asset_type, asset_has_pii,
              asset_criticality, principal, principal_type, display_name,
              department, privilege, member_count, effective_principals,
              is_over_broad, granted_by, granted_date
       FROM ${fq('accessGrants')}`,
    ),
  ]);
  console.log(`[sync]   queries done (${((Date.now() - t0) / 1000).toFixed(1)}s) — inserting…`);

  const toBool = (v: unknown): boolean => v === true || v === 'true' || v === 't';
  const toInt = (v: unknown): number =>
    v === null || v === undefined || v === '' ? 0 : Math.round(Number(v));

  if (assetRows.length) {
    await chunkInsert(assetRows, 2_000, (chunk) =>
      db.insert(assets).values(
        chunk.map((r) => ({
          id: r.asset_id,
          assetName: r.asset_name,
          assetType: r.asset_type,
          platform: r.platform,
          catalog: r.catalog,
          schema: r.schema,
          domain: r.domain,
          criticality: r.criticality,
          hasPii: toBool(r.has_pii),
          ownerEmail: r.owner_email,
          createdDate: r.created_date,
          lastRefreshed: r.last_refreshed,
          downstreamCount: toInt(r.downstream_count),
          principalsWithAccess: toInt(r.principals_with_access),
          hasOverBroadGrant: toBool(r.has_over_broad_grant),
        })),
      ).onConflictDoNothing(),
    );
  }
  console.log(`[sync]   assets: ${assetRows.length} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);

  if (edgeRows.length) {
    await chunkInsert(edgeRows, 3_000, (chunk) =>
      db.insert(lineageEdges).values(
        chunk.map((r) => ({
          id: r.edge_id,
          sourceAssetId: r.source_asset_id,
          sourceAssetName: r.source_asset_name,
          sourceAssetType: r.source_asset_type,
          sourceHasPii: toBool(r.source_has_pii),
          targetAssetId: r.target_asset_id,
          targetAssetName: r.target_asset_name,
          targetAssetType: r.target_asset_type,
          targetCriticality: r.target_criticality,
          edgeType: r.edge_type,
          createdDate: r.created_date,
          isNewFromMv: toBool(r.is_new_from_mv),
        })),
      ).onConflictDoNothing(),
    );
  }
  console.log(`[sync]   lineage edges: ${edgeRows.length} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);

  if (grantRows.length) {
    await chunkInsert(grantRows, 2_500, (chunk) =>
      db.insert(accessGrants).values(
        chunk.map((r) => ({
          id: r.grant_id,
          assetId: r.asset_id,
          assetName: r.asset_name,
          assetType: r.asset_type,
          assetHasPii: toBool(r.asset_has_pii),
          assetCriticality: r.asset_criticality,
          principal: r.principal,
          principalType: r.principal_type,
          displayName: r.display_name,
          department: r.department,
          privilege: r.privilege,
          memberCount: toInt(r.member_count) || 1,
          effectivePrincipals: toInt(r.effective_principals) || 1,
          isOverBroad: toBool(r.is_over_broad),
          grantedBy: r.granted_by,
          grantedDate: r.granted_date,
          status: 'active' as const,
        })),
      ).onConflictDoNothing(),
    );
  }
  console.log(`[sync]   access grants: ${grantRows.length} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);

  // Column-level lineage for all governed objects. Best-effort: if the tables
  // don't exist (older data-gen), log and continue — the rest of the app works.
  try {
    const [colRows, colEdgeRows] = await Promise.all([
      execSql<{
        asset_id: string;
        column_name: string;
        data_type: string | null;
        is_pii: boolean | null;
        ordinal: number | null;
      }>(
        warehouseId,
        `SELECT asset_id, column_name, data_type, is_pii, ordinal
         FROM ${cfg.catalog}.${cfg.schema}.${colTable}`,
      ),
      execSql<{
        col_edge_id: string;
        source_asset_id: string;
        source_column: string;
        target_asset_id: string;
        target_column: string;
        transform: string | null;
      }>(
        warehouseId,
        `SELECT col_edge_id, source_asset_id, source_column, target_asset_id,
                target_column, transform
         FROM ${cfg.catalog}.${cfg.schema}.${colLinTable}`,
      ),
    ]);

    if (colRows.length) {
      await chunkInsert(colRows, 2_000, (chunk) =>
        db.insert(assetColumns).values(
          chunk.map((r) => ({
            id: `${r.asset_id}:${r.column_name}`,
            assetId: r.asset_id,
            columnName: r.column_name,
            dataType: r.data_type,
            isPii: toBool(r.is_pii),
            ordinal: toInt(r.ordinal),
          })),
        ).onConflictDoNothing(),
      );
    }
    if (colEdgeRows.length) {
      await chunkInsert(colEdgeRows, 2_000, (chunk) =>
        db.insert(columnLineage).values(
          chunk.map((r) => ({
            id: r.col_edge_id,
            sourceAssetId: r.source_asset_id,
            sourceColumn: r.source_column,
            targetAssetId: r.target_asset_id,
            targetColumn: r.target_column,
            transform: r.transform,
          })),
        ).onConflictDoNothing(),
      );
    }
    console.log(`[sync]   columns: ${colRows.length}, column-lineage: ${colEdgeRows.length}`);
  } catch (e) {
    console.warn(`[sync]   column lineage skipped: ${(e as Error).message}`);
  }

  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[sync] Done in ${dt}s`);
}

export async function wipeMirroredTables(db: AppDb): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`TRUNCATE TABLE app.feedback RESTART IDENTITY CASCADE`);
    await tx.execute(sql`TRUNCATE TABLE app.messages RESTART IDENTITY CASCADE`);
    await tx.execute(sql`TRUNCATE TABLE app.conversations RESTART IDENTITY CASCADE`);
    await tx.execute(sql`TRUNCATE TABLE app.access_grants RESTART IDENTITY CASCADE`);
    await tx.execute(sql`TRUNCATE TABLE app.column_lineage RESTART IDENTITY CASCADE`);
    await tx.execute(sql`TRUNCATE TABLE app.asset_columns RESTART IDENTITY CASCADE`);
    await tx.execute(sql`TRUNCATE TABLE app.lineage_edges RESTART IDENTITY CASCADE`);
    await tx.execute(sql`TRUNCATE TABLE app.assets RESTART IDENTITY CASCADE`);
  });
}

async function execSql<T>(
  warehouseId: string,
  statement: string,
): Promise<T[]> {
  const { client } = getExecutionContext();
  type StmtResp = {
    statement_id: string;
    status: { state: string; error?: { message: string } };
    manifest?: {
      schema: { columns: Array<{ name: string }> };
      chunks?: Array<{ chunk_index: number; row_count: number }>;
    };
    result?: {
      chunk_index: number;
      row_count: number;
      data_array?: Array<Array<unknown>>;
      next_chunk_index?: number;
    };
  };

  const initial = (await client.apiClient.request({
    method: 'POST',
    path: '/api/2.0/sql/statements',
    payload: {
      statement,
      warehouse_id: warehouseId,
      wait_timeout: '50s',
      on_wait_timeout: 'CONTINUE',
      disposition: 'INLINE',
      format: 'JSON_ARRAY',
    },
    headers: new Headers(),
    raw: false,
    query: {},
  })) as StmtResp;

  const POLL_DEADLINE_MS = 10 * 60 * 1000;
  const startedAt = Date.now();

  let cur = initial;
  while (
    cur.status.state !== 'SUCCEEDED' &&
    cur.status.state !== 'FAILED' &&
    cur.status.state !== 'CANCELED'
  ) {
    if (Date.now() - startedAt > POLL_DEADLINE_MS) {
      throw new Error(
        `[sync] SQL still ${cur.status.state} after 10 minutes — aborting (statement_id=${cur.statement_id})`,
      );
    }
    await new Promise((r) => setTimeout(r, 1000));
    cur = (await client.apiClient.request({
      method: 'GET',
      path: `/api/2.0/sql/statements/${cur.statement_id}`,
      headers: new Headers(),
      raw: false,
      query: {},
    })) as StmtResp;
  }
  if (cur.status.state !== 'SUCCEEDED') {
    throw new Error(
      `[sync] SQL failed: ${cur.status.error?.message ?? cur.status.state}`,
    );
  }

  const cols = cur.manifest?.schema.columns.map((c) => c.name) ?? [];
  const rows: T[] = [];
  let chunk = cur.result;
  while (chunk) {
    for (const row of chunk.data_array ?? []) {
      const obj: Record<string, unknown> = {};
      for (let i = 0; i < cols.length; i++) obj[cols[i]] = row[i];
      rows.push(obj as T);
    }
    if (chunk.next_chunk_index === undefined || chunk.next_chunk_index === null) break;
    chunk = (await client.apiClient.request({
      method: 'GET',
      path: `/api/2.0/sql/statements/${cur.statement_id}/result/chunks/${chunk.next_chunk_index}`,
      headers: new Headers(),
      raw: false,
      query: {},
    })) as StmtResp['result'];
  }
  return rows;
}

async function chunkInsert<T>(
  rows: T[],
  size: number,
  fn: (chunk: T[]) => Promise<unknown>,
): Promise<void> {
  for (let i = 0; i < rows.length; i += size) {
    await fn(rows.slice(i, i + size));
  }
}

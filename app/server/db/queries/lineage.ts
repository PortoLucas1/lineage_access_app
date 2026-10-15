import { sql } from 'drizzle-orm';
import type { AppDb } from '../index.js';
import type { AuditEntry } from '../schema.js';
export type { AuditEntry };

export type GrantStatus = 'active' | 'flagged_for_review';

// ============================================================================
// Row shapes (client/server boundary — keep in sync with shared/types.ts)
// ============================================================================

export type AssetRow = {
  id: string;
  assetName: string;
  assetType: string;
  platform: string | null;
  catalog: string | null;
  schema: string | null;
  domain: string | null;
  criticality: string | null;
  hasPii: boolean;
  ownerEmail: string | null;
  createdDate: string | null;
  lastRefreshed: string | null;
  downstreamCount: number;
  principalsWithAccess: number;
  hasOverBroadGrant: boolean;
};

export type EdgeRow = {
  id: string;
  sourceAssetId: string;
  sourceAssetName: string | null;
  sourceAssetType: string | null;
  sourceHasPii: boolean;
  targetAssetId: string;
  targetAssetName: string | null;
  targetAssetType: string | null;
  targetCriticality: string | null;
  edgeType: string | null;
  createdDate: string | null;
  isNewFromMv: boolean;
};

export type GrantRow = {
  id: string;
  assetId: string;
  assetName: string | null;
  assetType: string | null;
  assetHasPii: boolean;
  assetCriticality: string | null;
  principal: string;
  principalType: string | null;
  displayName: string | null;
  department: string | null;
  privilege: string | null;
  memberCount: number;
  effectivePrincipals: number;
  isOverBroad: boolean;
  grantedBy: string | null;
  grantedDate: string | null;
  status: GrantStatus;
  reviewedBy: string | null;
  auditTrail: AuditEntry[];
  comparisonStatus?: 'in_sync' | 'declared_only' | 'effective_only';
  inheritedFromName?: string | null;
  inheritedFromType?: string | null;
  declaredScope?: string | null;
};

function toAsset(r: Record<string, unknown>): AssetRow {
  return {
    id: r.id as string,
    assetName: r.asset_name as string,
    assetType: r.asset_type as string,
    platform: (r.platform as string) ?? null,
    catalog: (r.catalog as string) ?? null,
    schema: (r.schema as string) ?? null,
    domain: (r.domain as string) ?? null,
    criticality: (r.criticality as string) ?? null,
    hasPii: r.has_pii === true,
    ownerEmail: (r.owner_email as string) ?? null,
    createdDate: (r.created_date as string) ?? null,
    lastRefreshed: (r.last_refreshed as string) ?? null,
    downstreamCount: Number(r.downstream_count ?? 0),
    principalsWithAccess: Number(r.principals_with_access ?? 0),
    hasOverBroadGrant: r.has_over_broad_grant === true,
  };
}

function toEdge(r: Record<string, unknown>): EdgeRow {
  return {
    id: r.id as string,
    sourceAssetId: r.source_asset_id as string,
    sourceAssetName: (r.source_asset_name as string) ?? null,
    sourceAssetType: (r.source_asset_type as string) ?? null,
    sourceHasPii: r.source_has_pii === true,
    targetAssetId: r.target_asset_id as string,
    targetAssetName: (r.target_asset_name as string) ?? null,
    targetAssetType: (r.target_asset_type as string) ?? null,
    targetCriticality: (r.target_criticality as string) ?? null,
    edgeType: (r.edge_type as string) ?? null,
    createdDate: (r.created_date as string) ?? null,
    isNewFromMv: r.is_new_from_mv === true,
  };
}

function toGrant(r: Record<string, unknown>): GrantRow {
  return {
    id: r.id as string,
    assetId: r.asset_id as string,
    assetName: (r.asset_name as string) ?? null,
    assetType: (r.asset_type as string) ?? null,
    assetHasPii: r.asset_has_pii === true,
    assetCriticality: (r.asset_criticality as string) ?? null,
    principal: r.principal as string,
    principalType: (r.principal_type as string) ?? null,
    displayName: (r.display_name as string) ?? null,
    department: (r.department as string) ?? null,
    privilege: (r.privilege as string) ?? null,
    memberCount: Number(r.member_count ?? 1),
    effectivePrincipals: Number(r.effective_principals ?? 1),
    isOverBroad: r.is_over_broad === true,
    grantedBy: (r.granted_by as string) ?? null,
    grantedDate: (r.granted_date as string) ?? null,
    status: (r.status as GrantStatus) ?? 'active',
    reviewedBy: (r.reviewed_by as string) ?? null,
    auditTrail: (r.audit_trail as AuditEntry[]) ?? [],
  };
}

// ============================================================================
// Asset catalog
// ============================================================================

export async function listAssets(
  db: AppDb,
  opts: { search?: string; type?: string; limit?: number } = {},
): Promise<AssetRow[]> {
  const limit = opts.limit ?? 500;
  const whereSearch = opts.search
    ? sql`AND (LOWER(a.asset_name) LIKE ${'%' + opts.search.toLowerCase() + '%'} OR a.id = ${opts.search})`
    : sql``;
  const whereType = opts.type ? sql`AND a.asset_type = ${opts.type}` : sql``;
  const res = await db.execute(sql`
    SELECT a.* FROM app.assets a
    WHERE 1=1 ${whereSearch} ${whereType}
    ORDER BY a.downstream_count DESC, a.asset_name ASC
    LIMIT ${limit}
  `);
  return (res.rows as Record<string, unknown>[]).map(toAsset);
}

export async function getAsset(db: AppDb, id: string): Promise<AssetRow | null> {
  const res = await db.execute(sql`SELECT a.* FROM app.assets a WHERE a.id = ${id} LIMIT 1`);
  const row = res.rows[0] as Record<string, unknown> | undefined;
  return row ? toAsset(row) : null;
}

// ============================================================================
// Lineage neighborhood — upstream + downstream edges within N hops of a seed
// asset. Returns the edge set + the involved assets so the graph explorer can
// render the whole neighborhood.
// ============================================================================

export type LineageNeighborhood = {
  seed: AssetRow | null;
  assets: AssetRow[];
  edges: EdgeRow[];
};

export async function getLineageNeighborhood(
  db: AppDb,
  seedId: string,
  hops = 2,
): Promise<LineageNeighborhood> {
  const seed = await getAsset(db, seedId);

  // The estate is small (hundreds of edges), so load ALL edges once and BFS in
  // memory. Avoids per-hop `= ANY(<array>)` binding, which the Lakebase pg
  // driver rejects (22P02: "Array value must start with {").
  const allEdgesRes = await db.execute(sql`SELECT e.* FROM app.lineage_edges e`);
  const allEdges = (allEdgesRes.rows as Record<string, unknown>[]).map(toEdge);

  // Adjacency in both directions, keyed by asset id → incident edges.
  const incident = new Map<string, EdgeRow[]>();
  for (const e of allEdges) {
    (incident.get(e.sourceAssetId) ?? incident.set(e.sourceAssetId, []).get(e.sourceAssetId)!).push(e);
    (incident.get(e.targetAssetId) ?? incident.set(e.targetAssetId, []).get(e.targetAssetId)!).push(e);
  }

  // BFS out from the seed in both directions up to `hops`.
  let frontier = new Set<string>([seedId]);
  const visited = new Set<string>([seedId]);
  const edges: EdgeRow[] = [];
  const seenEdge = new Set<string>();

  for (let h = 0; h < hops && frontier.size > 0; h++) {
    const next = new Set<string>();
    for (const id of frontier) {
      for (const edge of incident.get(id) ?? []) {
        if (!seenEdge.has(edge.id)) {
          seenEdge.add(edge.id);
          edges.push(edge);
        }
        for (const nid of [edge.sourceAssetId, edge.targetAssetId]) {
          if (!visited.has(nid)) {
            visited.add(nid);
            next.add(nid);
          }
        }
      }
    }
    frontier = next;
  }

  // Load all assets once, filter to the visited set in memory (same reason:
  // no array-param binding against the Lakebase driver).
  const allAssetsRes = await db.execute(sql`SELECT a.* FROM app.assets a`);
  const assets = (allAssetsRes.rows as Record<string, unknown>[])
    .map(toAsset)
    .filter((a) => visited.has(a.id));

  return { seed, assets, edges };
}

// ============================================================================
// Column-level lineage for any governed object. Returns the object's columns
// plus the column→column edges touching it (either as the upstream source or
// downstream target), with the neighbor columns.
// ============================================================================

export type ColumnRow = {
  assetId: string;
  columnName: string;
  dataType: string | null;
  isPii: boolean;
  ordinal: number;
};

export type ColumnEdgeRow = {
  id: string;
  sourceAssetId: string;
  sourceColumn: string;
  targetAssetId: string;
  targetColumn: string;
  transform: string | null;
};

export type ColumnLineage = {
  assetId: string;
  columns: ColumnRow[];
  edges: ColumnEdgeRow[];
  neighborColumns: ColumnRow[];
};

function toColumn(r: Record<string, unknown>): ColumnRow {
  return {
    assetId: r.asset_id as string,
    columnName: r.column_name as string,
    dataType: (r.data_type as string) ?? null,
    isPii: r.is_pii === true,
    ordinal: Number(r.ordinal ?? 0),
  };
}

export async function getColumnLineage(db: AppDb, assetId: string): Promise<ColumnLineage> {
  const ownCols = await db.execute(sql`
    SELECT asset_id, column_name, data_type, is_pii, ordinal
    FROM app.asset_columns WHERE asset_id = ${assetId} ORDER BY ordinal
  `);

  const edgeRes = await db.execute(sql`
    SELECT id, source_asset_id, source_column, target_asset_id, target_column, transform
    FROM app.column_lineage
    WHERE source_asset_id = ${assetId} OR target_asset_id = ${assetId}
  `);
  const edges: ColumnEdgeRow[] = (edgeRes.rows as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    sourceAssetId: r.source_asset_id as string,
    sourceColumn: r.source_column as string,
    targetAssetId: r.target_asset_id as string,
    targetColumn: r.target_column as string,
    transform: (r.transform as string) ?? null,
  }));

  // Pull the neighbor assets' columns too (so the expanded view can show the
  // linked columns on the other side of each edge).
  const neighborIds = new Set<string>();
  for (const e of edges) {
    if (e.sourceAssetId !== assetId) neighborIds.add(e.sourceAssetId);
    if (e.targetAssetId !== assetId) neighborIds.add(e.targetAssetId);
  }
  let neighborColumns: ColumnRow[] = [];
  if (neighborIds.size) {
    const ids = [...neighborIds];
    const nRes = await db.execute(sql`
      SELECT asset_id, column_name, data_type, is_pii, ordinal
      FROM app.asset_columns
      WHERE asset_id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
      ORDER BY asset_id, ordinal
    `);
    neighborColumns = (nRes.rows as Record<string, unknown>[]).map(toColumn);
  }

  return {
    assetId,
    columns: (ownCols.rows as Record<string, unknown>[]).map(toColumn),
    edges,
    neighborColumns,
  };
}

// ============================================================================
// Access grants for an asset — the access panel source. Over-broad grants
// sorted to the top.
// ============================================================================

export async function getGrantsForAsset(db: AppDb, assetId: string): Promise<GrantRow[]> {
  const res = await db.execute(sql`
    SELECT g.* FROM app.access_grants g
    WHERE g.asset_id = ${assetId}
    ORDER BY g.member_count DESC, g.principal ASC
  `);
  return (res.rows as Record<string, unknown>[]).map(toGrant);
}

// ============================================================================
// KPI summary for the selected asset's sub-graph.
//   - governedAssets: total assets in the estate
//   - newEdges30d: lineage edges created in the last 30 days
//   - piiPrincipals: distinct effective principals with ACTIVE (not-yet-flagged)
//     grants on PII assets reachable in the seed's sub-graph
// ============================================================================

export type LineageKpis = {
  governedAssets: number;
  newEdges30d: number;
  piiPrincipals: number;
};

export async function getKpis(db: AppDb, seedId: string): Promise<LineageKpis> {
  const totalRes = await db.execute(sql`SELECT COUNT(*)::int AS n FROM app.assets`);
  const governedAssets = Number((totalRes.rows[0] as { n: number })?.n ?? 0);

  const edgesRes = await db.execute(sql`
    SELECT COUNT(*)::int AS n FROM app.lineage_edges
    WHERE created_date >= (CURRENT_DATE - INTERVAL '30 days')
  `);
  const newEdges30d = Number((edgesRes.rows[0] as { n: number })?.n ?? 0);

  // Sub-graph asset ids around the seed (2 hops), then PII exposure.
  const { assets } = await getLineageNeighborhood(db, seedId, 2);

  const subGraphPiiAssets = assets.filter((a) => a.hasPii).map((a) => a.id);
  let piiPrincipals = 0;
  if (subGraphPiiAssets.length) {
    const res = await db.execute(sql`
      SELECT COALESCE(SUM(effective_principals), 0)::int AS n
      FROM app.access_grants
      WHERE asset_id IN (${sql.join(subGraphPiiAssets.map((id) => sql`${id}`), sql`, `)})
        AND status = 'active'
    `);
    piiPrincipals = Number((res.rows[0] as { n: number })?.n ?? 0);
  }

  return { governedAssets, newEdges30d, piiPrincipals };
}

// ============================================================================
// Pipeline exposure — for a seed asset: downstream dashboards, notebooks,
// agents, and access grants on the seed plus its upstream PII sources.
// ============================================================================

export type PipelineExposure = {
  seed: string;
  downstreamConsumers: Array<{
    asset_id: string;
    asset_name: string;
    asset_type: string;
    platform: string | null;
  }>;
  grants: Array<{
    grant_id: string;
    asset_id: string;
    asset_name: string;
    principal: string;
    principal_type: string | null;
    member_count: number;
    privilege: string | null;
    asset_has_pii: boolean;
    status: GrantStatus;
  }>;
};

export async function getPipelineExposure(
  db: AppDb,
  seedId: string,
): Promise<PipelineExposure> {
  const { assets, edges } = await getLineageNeighborhood(db, seedId, 3);

  // Downstream = reachable following edges forward from the seed.
  const forward = new Map<string, string[]>();
  for (const e of edges) {
    if (!forward.has(e.sourceAssetId)) forward.set(e.sourceAssetId, []);
    forward.get(e.sourceAssetId)!.push(e.targetAssetId);
  }
  const downstreamIds = new Set<string>();
  const stackD = [seedId];
  while (stackD.length) {
    const cur = stackD.pop()!;
    for (const nxt of forward.get(cur) ?? []) {
      if (!downstreamIds.has(nxt)) {
        downstreamIds.add(nxt);
        stackD.push(nxt);
      }
    }
  }

  // Upstream = reachable following edges backward from the seed.
  const backward = new Map<string, string[]>();
  for (const e of edges) {
    if (!backward.has(e.targetAssetId)) backward.set(e.targetAssetId, []);
    backward.get(e.targetAssetId)!.push(e.sourceAssetId);
  }
  const upstreamIds = new Set<string>();
  const stackU = [seedId];
  while (stackU.length) {
    const cur = stackU.pop()!;
    for (const nxt of backward.get(cur) ?? []) {
      if (!upstreamIds.has(nxt)) {
        upstreamIds.add(nxt);
        stackU.push(nxt);
      }
    }
  }

  const assetById = new Map(assets.map((a) => [a.id, a]));
  const downstreamConsumers = [...downstreamIds]
    .map((id) => assetById.get(id))
    .filter((a): a is AssetRow => Boolean(a))
    .filter((a) =>
      ['tableau_dashboard', 'dbsql_dashboard', 'notebook', 'agent'].includes(a.assetType),
    )
    .map((a) => ({
      asset_id: a.id,
      asset_name: a.assetName,
      asset_type: a.assetType,
      platform: a.platform,
    }));

  const pipelineAssetIds = [seedId, ...upstreamIds];
  let grants: PipelineExposure['grants'] = [];
  if (pipelineAssetIds.length) {
    const res = await db.execute(sql`
      SELECT g.id AS grant_id, g.asset_id, g.asset_name, g.principal,
             g.principal_type, g.member_count, g.privilege, g.asset_has_pii,
             g.status
      FROM app.access_grants g
      WHERE g.asset_id IN (${sql.join(pipelineAssetIds.map((id) => sql`${id}`), sql`, `)})
      ORDER BY g.member_count DESC, g.principal ASC
    `);
    grants = (res.rows as Record<string, unknown>[]).map((r) => ({
      grant_id: r.grant_id as string,
      asset_id: r.asset_id as string,
      asset_name: r.asset_name as string,
      principal: r.principal as string,
      principal_type: (r.principal_type as string) ?? null,
      member_count: Number(r.member_count ?? 0),
      privilege: (r.privilege as string) ?? null,
      asset_has_pii: r.asset_has_pii === true,
      status: (r.status as GrantStatus) ?? 'active',
    }));
  }

  return {
    seed: seedId,
    downstreamConsumers,
    grants,
  };
}

// ============================================================================
// Recent activity feed — the append-only audit trail across all grants,
// flattened + sorted by time.
// ============================================================================

export type ActivityEvent = {
  grant_id: string;
  asset_name: string | null;
  principal: string;
  at: string;
  by: string;
  action: string;
  notes: string | null;
  tool: string | null;
};

export async function recentActivity(db: AppDb, limit = 20): Promise<ActivityEvent[]> {
  const res = await db.execute(sql`
    SELECT g.id AS grant_id, g.asset_name, g.principal,
           (a->>'at') AS at, (a->>'by') AS by_email,
           (a->>'action') AS action, (a->>'notes') AS notes, (a->>'tool') AS tool
    FROM app.access_grants g, jsonb_array_elements(g.audit_trail) AS a
    ORDER BY at DESC NULLS LAST
    LIMIT ${limit}
  `);
  return (res.rows as Array<Record<string, unknown>>).map((r) => ({
    grant_id: r.grant_id as string,
    asset_name: (r.asset_name as string) ?? null,
    principal: r.principal as string,
    at: r.at as string,
    by: (r.by_email as string) ?? '',
    action: (r.action as string) ?? '',
    notes: (r.notes as string | null) ?? null,
    tool: (r.tool as string | null) ?? null,
  }));
}

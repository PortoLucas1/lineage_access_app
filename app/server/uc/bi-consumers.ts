import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Request } from 'express';
import type { AssetRow, EdgeRow } from '../db/queries/lineage.js';
import { appAuthHeaders, authHeaders } from '../lib/auth.js';
import { executeStatement, sqlLiteral, workspaceHost } from '../lib/statement-execution.js';

export type BiKind = 'dbsql_dashboard' | 'tableau_dashboard' | 'notebook' | 'workflow';

export type BiConsumer = {
  tableFullName: string;
  kind: BiKind;
  id: string;
  name: string;
  platform: string;
};

type OverlayRow = {
  table?: string;
  kind?: string;
  id?: string;
  name?: string;
  platform?: string;
};

const OVERLAY_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../config/bi-overlays.json',
);

const biAssetCache = new Map<string, AssetRow>();

export function isBiAssetId(id: string): boolean {
  return id.startsWith('bi:');
}

export function biAssetId(kind: BiKind, id: string): string {
  return `bi:${kind}:${id}`;
}

export function getCachedBiAsset(id: string): AssetRow | null {
  return biAssetCache.get(id) ?? fallbackBiAsset(id);
}

function remember(asset: AssetRow): void {
  biAssetCache.set(asset.id, asset);
}

function fallbackBiAsset(id: string): AssetRow {
  const parts = id.split(':');
  const kind = (parts[1] ?? 'dbsql_dashboard') as BiKind;
  const rawId = parts.slice(2).join(':') || id;
  return consumerAsset({
    tableFullName: '',
    kind,
    id: rawId,
    name: rawId,
    platform: kind === 'tableau_dashboard' ? 'Tableau' : 'Databricks',
  });
}

export async function attachBiConsumers(
  req: Request,
  neighborhood: { seed: AssetRow | null; assets: AssetRow[]; edges: EdgeRow[] },
): Promise<{ seed: AssetRow | null; assets: AssetRow[]; edges: EdgeRow[] }> {
  const tableIds = neighborhood.assets
    .map((asset) => asset.id)
    .filter((id) => id.split('.').length === 3 && !isBiAssetId(id));
  if (!tableIds.length) return neighborhood;

  const [lineageConsumers, overlayConsumers] = await Promise.all([
    listDashboardConsumers(req, tableIds),
    Promise.resolve(listOverlayConsumers(tableIds)),
  ]);
  const consumers = [...lineageConsumers, ...overlayConsumers];
  if (!consumers.length) {
    return {
      ...neighborhood,
      assets: neighborhood.assets.map((asset) => withConnections(asset, [])),
    };
  }

  const named = await withDashboardNames(req, consumers);
  const extraAssets: AssetRow[] = [];
  const extraEdges: EdgeRow[] = [];
  const seenAssets = new Set(neighborhood.assets.map((asset) => asset.id));
  const seenEdges = new Set(neighborhood.edges.map((edge) => edge.id));
  const byTable = new Map<string, BiConsumer[]>();

  for (const consumer of named) {
    const asset = consumerAsset(consumer);
    remember(asset);
    if (!seenAssets.has(asset.id)) {
      seenAssets.add(asset.id);
      extraAssets.push(asset);
    }
    const edgeId = `${consumer.tableFullName}->${asset.id}`;
    if (!seenEdges.has(edgeId)) {
      seenEdges.add(edgeId);
      extraEdges.push({
        id: edgeId,
        sourceAssetId: consumer.tableFullName,
        sourceAssetName: leafName(consumer.tableFullName),
        sourceAssetType: null,
        sourceHasPii: false,
        targetAssetId: asset.id,
        targetAssetName: consumer.name,
        targetAssetType: consumer.kind,
        targetCriticality: null,
        edgeType: 'consumed_by',
        createdDate: null,
        isNewFromMv: false,
      });
    }
    const list = byTable.get(consumer.tableFullName) ?? [];
    list.push(consumer);
    byTable.set(consumer.tableFullName, list);
  }

  const assets = [
    ...neighborhood.assets.map((asset) => withConnections(asset, byTable.get(asset.id) ?? [])),
    ...extraAssets,
  ];
  return {
    seed: assets.find((asset) => asset.id === neighborhood.seed?.id) ?? neighborhood.seed,
    assets,
    edges: [...neighborhood.edges, ...extraEdges],
  };
}

async function listDashboardConsumers(req: Request, tableIds: string[]): Promise<BiConsumer[]> {
  const inList = tableIds.map((id) => `'${sqlLiteral(id)}'`).join(', ');
  try {
    const rows = await executeStatement(
      req,
      `SELECT source_table_full_name, entity_type, entity_id, MAX(event_time)
         FROM system.access.table_lineage
        WHERE source_table_full_name IN (${inList})
          AND entity_type IN ('DASHBOARD_V3', 'DASHBOARD', 'NOTEBOOK', 'JOB')
          AND entity_id IS NOT NULL
        GROUP BY source_table_full_name, entity_type, entity_id`,
    );
    return rows.flatMap((row) => {
      const tableFullName = String(row[0] ?? '');
      const entityType = String(row[1] ?? '');
      const entityId = String(row[2] ?? '');
      const kind = kindFromEntity(entityType);
      if (!tableFullName || !entityId || !kind) return [];
      return [{
        tableFullName,
        kind,
        id: entityId,
        name: entityId,
        platform: 'Databricks',
      }];
    });
  } catch (error) {
    console.error(`[lineage] BI consumer lookup failed: ${error instanceof Error ? error.message : error}`);
    return [];
  }
}

function listOverlayConsumers(tableIds: string[]): BiConsumer[] {
  const overlays = loadOverlays();
  const out: BiConsumer[] = [];
  for (const table of tableIds) {
    for (const overlay of overlays) {
      if (!overlay.table || !overlay.kind || !overlay.id) continue;
      if (!tableMatches(table, overlay.table)) continue;
      const kind = overlay.kind as BiKind;
      if (!['dbsql_dashboard', 'tableau_dashboard', 'notebook', 'workflow'].includes(kind)) continue;
      out.push({
        tableFullName: table,
        kind,
        id: overlay.id,
        name: overlay.name?.trim() || overlay.id,
        platform: overlay.platform?.trim() || (kind === 'tableau_dashboard' ? 'Tableau' : 'Databricks'),
      });
    }
  }
  return out;
}

function loadOverlays(): OverlayRow[] {
  try {
    const parsed = JSON.parse(readFileSync(OVERLAY_PATH, 'utf8')) as { consumers?: OverlayRow[] };
    return parsed.consumers ?? [];
  } catch {
    return [];
  }
}

export function tableMatches(tableFullName: string, pattern: string): boolean {
  const needle = pattern.trim().toLowerCase();
  const haystack = tableFullName.trim().toLowerCase();
  if (needle === haystack) return true;
  if (needle.startsWith('*.')) return haystack.endsWith(needle.slice(1));
  return false;
}

function kindFromEntity(entityType: string): BiKind | null {
  switch (entityType.toUpperCase()) {
    case 'DASHBOARD_V3':
    case 'DASHBOARD':
      return 'dbsql_dashboard';
    case 'NOTEBOOK':
      return 'notebook';
    case 'JOB':
      return 'workflow';
    default:
      return null;
  }
}

async function withDashboardNames(req: Request, consumers: BiConsumer[]): Promise<BiConsumer[]> {
  const dashboards = [...new Set(
    consumers.filter((item) => item.kind === 'dbsql_dashboard').map((item) => item.id),
  )];
  const names = new Map<string, string>();
  await Promise.all(dashboards.map(async (id) => {
    const name = await lakeviewName(req, id);
    if (name) names.set(id, name);
  }));
  return consumers.map((item) => (
    item.kind === 'dbsql_dashboard' && names.get(item.id)
      ? { ...item, name: names.get(item.id)! }
      : item
  ));
}

async function lakeviewName(req: Request, dashboardId: string): Promise<string | null> {
  try {
    let headers: Headers;
    try {
      headers = await authHeaders(req);
    } catch {
      headers = await appAuthHeaders();
    }
    const response = await fetch(
      `${workspaceHost()}/api/2.0/lakeview/dashboards/${encodeURIComponent(dashboardId)}`,
      { headers, signal: AbortSignal.timeout(8_000) },
    );
    if (!response.ok) return null;
    const body = (await response.json()) as { display_name?: string };
    return body.display_name?.trim() || null;
  } catch {
    return null;
  }
}

function consumerAsset(consumer: BiConsumer): AssetRow {
  return {
    id: biAssetId(consumer.kind, consumer.id),
    assetName: consumer.name,
    assetType: consumer.kind,
    platform: consumer.platform,
    catalog: null,
    schema: null,
    domain: null,
    criticality: null,
    hasPii: false,
    ownerEmail: null,
    createdDate: null,
    lastRefreshed: null,
    downstreamCount: 0,
    principalsWithAccess: 0,
    hasOverBroadGrant: false,
    biConnections: [{
      kind: consumer.kind,
      id: consumer.id,
      name: consumer.name,
      platform: consumer.platform,
    }],
  };
}

function withConnections(asset: AssetRow, consumers: BiConsumer[]): AssetRow {
  const biConnections = consumers.map((consumer) => ({
    kind: consumer.kind,
    id: consumer.id,
    name: consumer.name,
    platform: consumer.platform,
  }));
  return {
    ...asset,
    biConnections,
    downstreamCount: asset.downstreamCount + consumers.length,
  };
}

function leafName(fullName: string): string {
  const parts = fullName.split('.');
  return parts[parts.length - 1] ?? fullName;
}

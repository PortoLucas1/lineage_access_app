import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getExecutionContext } from '@databricks/appkit';
import type { Request } from 'express';
import type { AssetRow, EdgeRow, GrantRow } from '../db/queries/lineage.js';
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

/** One Tableau/Power BI/... principal with declared access, from external-bi.json. */
type BiAccessEntry = {
  principal?: string;
  role?: string;
  grantedBy?: string;
  grantedDate?: string;
};

/**
 * A BI connection declared in terraform/external-bi.json — synced to
 * config/external-bi.json and checked for staleness by
 * scripts/check-external-bi-manifest.mjs, the same pattern used for
 * declared-grants.json. `externalMetadataName` is the Unity Catalog External
 * Metadata object name registered for this entity (see
 * scripts/register_external_lineage.py); when a table has a real External
 * Lineage relationship to that object, this overlay is only used as a
 * fallback (see attachBiConsumers below).
 */
type BiEntity = {
  id?: string;
  table?: string;
  kind?: string;
  externalMetadataName?: string;
  name?: string;
  platform?: string;
  systemType?: string;
  entityType?: string;
  url?: string;
  description?: string;
  access?: BiAccessEntry[];
};

const EXTERNAL_BI_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../config/external-bi.json',
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

  const [lineageConsumers, externalLineageConsumers, overlayConsumers] = await Promise.all([
    listDashboardConsumers(req, tableIds),
    listExternalLineageConsumers(req, tableIds),
    Promise.resolve(listOverlayConsumers(tableIds)),
  ]);
  // Real Unity Catalog External Lineage (registered via
  // scripts/register_external_lineage.py) is the source of truth; the local
  // overlay is only a fallback for tables that haven't been registered yet,
  // so never show the same BI connection twice.
  const discovered = new Set(externalLineageConsumers.map((c) => `${c.tableFullName}::${c.kind}`));
  const fallbackOverlayConsumers = overlayConsumers.filter(
    (c) => !discovered.has(`${c.tableFullName}::${c.kind}`),
  );
  const consumers = [...lineageConsumers, ...externalLineageConsumers, ...fallbackOverlayConsumers];
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

/**
 * Real Unity Catalog External Lineage for the given tables (Public Preview
 * API) — i.e. BI connections someone actually registered via
 * `databricks external-lineage create-external-lineage-relationship`
 * (or scripts/register_external_lineage.py). External lineage is not
 * recorded in system.access.table_lineage, so it needs its own lookup.
 * https://docs.databricks.com/aws/en/data-governance/unity-catalog/external-lineage
 */
async function listExternalLineageConsumers(req: Request, tableIds: string[]): Promise<BiConsumer[]> {
  const results = await Promise.all(tableIds.map((id) => externalLineageForTable(req, id)));
  return results.flat();
}

type ExternalLineageInfo = { name?: string; system_type?: string; entity_type?: string };
type ExternalLineageListResponse = {
  external_lineage_relationships?: Array<{ external_metadata_info?: ExternalLineageInfo }>;
};

async function externalLineageForTable(req: Request, tableFullName: string): Promise<BiConsumer[]> {
  try {
    let headers: Headers;
    try {
      headers = await authHeaders(req);
    } catch {
      headers = await appAuthHeaders();
    }
    const qs = new URLSearchParams({
      'object_info.table.name': tableFullName,
      lineage_direction: 'DOWNSTREAM',
    });
    const response = await fetch(
      `${workspaceHost()}/api/2.0/lineage-tracking/external-lineage?${qs.toString()}`,
      { headers, signal: AbortSignal.timeout(8_000) },
    );
    if (!response.ok) return [];
    const body = (await response.json()) as ExternalLineageListResponse;
    return (body.external_lineage_relationships ?? []).flatMap((rel) => {
      const info = rel.external_metadata_info;
      // Only Tableau is mapped to a BiKind today; widen BiKind to add others
      // (Power BI, Looker, ...) the same way.
      if (!info?.name || info.system_type !== 'TABLEAU') return [];
      return [{
        tableFullName,
        kind: 'tableau_dashboard',
        id: info.name,
        name: humanizeExternalMetadataName(info.name, info.system_type),
        platform: 'Tableau',
      }];
    });
  } catch (error) {
    console.error(
      `[lineage] external lineage lookup failed for ${tableFullName}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return [];
  }
}

/** "tableau_rides_operations" + "TABLEAU" -> "Rides Operations". */
function humanizeExternalMetadataName(name: string, systemType: string): string {
  const prefix = `${systemType.toLowerCase()}_`;
  const base = name.toLowerCase().startsWith(prefix) ? name.slice(prefix.length) : name;
  return base
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ') || name;
}

function listOverlayConsumers(tableIds: string[]): BiConsumer[] {
  const entities = loadBiEntities();
  const out: BiConsumer[] = [];
  for (const table of tableIds) {
    for (const entity of entities) {
      if (!entity.table || !tableMatches(table, entity.table)) continue;
      const id = entity.externalMetadataName ?? entity.id;
      const kind = (entity.kind ?? (entity.systemType === 'TABLEAU' ? 'tableau_dashboard' : '')) as BiKind;
      if (!id || !['dbsql_dashboard', 'tableau_dashboard', 'notebook', 'workflow'].includes(kind)) continue;
      out.push({
        tableFullName: table,
        kind,
        id,
        name: entity.name?.trim() || id,
        platform: entity.platform?.trim() || (kind === 'tableau_dashboard' ? 'Tableau' : 'Databricks'),
      });
    }
  }
  return out;
}

function loadBiEntities(): BiEntity[] {
  try {
    const parsed = JSON.parse(readFileSync(EXTERNAL_BI_PATH, 'utf8')) as { entities?: BiEntity[] };
    return parsed.entities ?? [];
  } catch {
    return [];
  }
}

/**
 * Grants for a BI asset node.
 *
 * - Databricks AI/BI dashboards: live Workspace Permissions API
 *   (`GET /api/2.0/permissions/dashboards/{id}`).
 * - Tableau (and other external BI): the `access` list in external-bi.json.
 *   Unity Catalog has no permission model for an external tool's own users,
 *   so that list is a declared/simulated manifest — the same role
 *   declared-grants.json plays for catalog grants.
 */
export async function getBiAssetGrants(req: Request, biId: string): Promise<GrantRow[]> {
  const parts = biId.split(':');
  const kind = (parts[1] ?? '') as BiKind;
  const rawId = parts.slice(2).join(':') || biId;
  if (kind === 'dbsql_dashboard') {
    return getLakeviewDashboardGrants(req, biId, rawId);
  }
  return declaredExternalBiGrants(biId, rawId);
}

function declaredExternalBiGrants(biId: string, rawId: string): GrantRow[] {
  const entity = loadBiEntities().find((e) => (e.externalMetadataName ?? e.id) === rawId);
  if (!entity?.access?.length) return [];
  return entity.access
    .filter((entry): entry is Required<Pick<BiAccessEntry, 'principal' | 'role'>> & BiAccessEntry =>
      Boolean(entry.principal && entry.role),
    )
    .map((entry) => biGrantRow(biId, entity, entry));
}

type WorkspacePermission = {
  permission_level?: string;
  inherited?: boolean;
  inherited_from_object?: string[];
};

type WorkspaceAclEntry = {
  user_name?: string;
  group_name?: string;
  service_principal_name?: string;
  display_name?: string;
  all_permissions?: WorkspacePermission[];
};

type WorkspacePermissionsResponse = {
  access_control_list?: WorkspaceAclEntry[];
};

async function getLakeviewDashboardGrants(
  req: Request,
  biId: string,
  dashboardId: string,
): Promise<GrantRow[]> {
  try {
    const result = await fetchWorkspaceJson(
      req,
      `/api/2.0/permissions/dashboards/${encodeURIComponent(dashboardId)}`,
    );
    const acl = result.ok
      ? (result.body as WorkspacePermissionsResponse).access_control_list
      : (await permissionsViaAppClient(dashboardId))?.access_control_list;
    if (!acl) {
      console.error(
        `[lineage] dashboard permissions lookup failed for ${dashboardId}: HTTP ${
          result.ok ? 'empty' : `${result.status} ${result.text}`
        }`,
      );
      return [];
    }
    const cached = getCachedBiAsset(biId);
    const displayName =
      (await lakeviewName(req, dashboardId))
      ?? (cached?.assetName && cached.assetName !== dashboardId ? cached.assetName : null)
      ?? dashboardId;
    return grantRowsFromWorkspaceAcl(biId, displayName, 'dbsql_dashboard', acl);
  } catch (error) {
    console.error(
      `[lineage] dashboard permissions lookup failed for ${dashboardId}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return [];
  }
}

async function permissionsViaAppClient(dashboardId: string): Promise<WorkspacePermissionsResponse | null> {
  try {
    const { client } = getExecutionContext();
    const body = await client.permissions.get({
      request_object_type: 'dashboards',
      request_object_id: dashboardId,
    });
    return body as WorkspacePermissionsResponse;
  } catch (error) {
    console.error(
      `[lineage] dashboard permissions SDK lookup failed for ${dashboardId}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }
}

/**
 * Try the viewer's OBO token, then the app service principal. Lakeview GET
 * often 403s on OBO (no `dashboards` Apps scope) but succeeds as the SP.
 * Workspace Permissions GET needs the `access-management` OAuth scope on
 * whichever token we send.
 */
async function fetchWorkspaceJson(
  req: Request,
  path: string,
): Promise<{ ok: true; body: unknown } | { ok: false; status: number; text: string }> {
  async function once(headers: Headers): Promise<Response> {
    return fetch(`${workspaceHost()}${path}`, {
      headers,
      signal: AbortSignal.timeout(10_000),
    });
  }

  const attempts: Headers[] = [];
  try {
    attempts.push(await authHeaders(req));
  } catch {
    // local / missing forwarded token
  }
  attempts.push(await appAuthHeaders());
  const allApis = await appSpAllApisHeaders();
  if (allApis) attempts.push(allApis);

  let lastStatus = 0;
  let lastText = '';
  const seen = new Set<string>();
  for (const headers of attempts) {
    const auth = headers.get('Authorization') ?? '';
    if (seen.has(auth)) continue;
    seen.add(auth);
    const response = await once(headers);
    if (response.ok) return { ok: true, body: await response.json() };
    lastStatus = response.status;
    lastText = (await response.text()).slice(0, 300);
    if (response.status !== 401 && response.status !== 403) break;
  }
  return { ok: false, status: lastStatus, text: lastText };
}

/**
 * Databricks Apps OBO (and sometimes the injected SP token) cannot mint
 * `access-management`, which Workspace Permissions GET now requires. The app
 * SP's client credentials can still request `all-apis` for this lookup.
 */
async function appSpAllApisHeaders(): Promise<Headers | null> {
  const clientId = process.env.DATABRICKS_CLIENT_ID;
  const clientSecret = process.env.DATABRICKS_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  try {
    const response = await fetch(`${workspaceHost()}/oidc/v1/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        scope: 'all-apis',
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      console.error(
        `[lineage] app SP all-apis token failed: HTTP ${response.status} ${(await response.text()).slice(0, 200)}`,
      );
      return null;
    }
    const body = (await response.json()) as { access_token?: string };
    if (!body.access_token) return null;
    const headers = new Headers();
    headers.set('Authorization', `Bearer ${body.access_token}`);
    return headers;
  } catch (error) {
    console.error(
      `[lineage] app SP all-apis token failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

/** Maps a Workspace Permissions ACL into the GrantRow shape the access panel already understands. */
export function grantRowsFromWorkspaceAcl(
  assetId: string,
  assetName: string,
  assetType: string,
  acl: WorkspaceAclEntry[],
): GrantRow[] {
  const rows: GrantRow[] = [];
  for (const entry of acl) {
    const principal = entry.user_name ?? entry.group_name ?? entry.service_principal_name;
    if (!principal) continue;
    const principalType: GrantRow['principalType'] = entry.user_name
      ? 'user'
      : entry.service_principal_name
        ? 'service_principal'
        : 'group';
    for (const permission of entry.all_permissions ?? []) {
      const privilege = permission.permission_level;
      if (!privilege) continue;
      const inheritedFrom = permission.inherited
        ? (permission.inherited_from_object?.[0] ?? 'workspace')
        : null;
      rows.push({
        id: `${assetId}:${principal}:${privilege}:${inheritedFrom ?? 'direct'}`,
        assetId,
        assetName,
        assetType,
        assetHasPii: false,
        assetCriticality: null,
        principal,
        principalType,
        displayName: entry.display_name ?? null,
        department: null,
        privilege,
        memberCount: 1,
        effectivePrincipals: 1,
        isOverBroad: false,
        grantedBy: null,
        grantedDate: null,
        status: 'active',
        reviewedBy: null,
        auditTrail: [],
        inheritedFromName: inheritedFrom,
        inheritedFromType: inheritedFrom ? inheritedObjectType(inheritedFrom) : null,
      });
    }
  }
  return rows.sort(
    (a, b) =>
      String(a.principal).localeCompare(String(b.principal))
      || String(a.privilege).localeCompare(String(b.privilege)),
  );
}

function inheritedObjectType(path: string): string {
  if (path.startsWith('/directories')) return 'DIRECTORY';
  if (path.startsWith('/dashboards')) return 'DASHBOARD';
  if (path.startsWith('/jobs')) return 'JOB';
  if (path.startsWith('/notebooks')) return 'NOTEBOOK';
  return 'WORKSPACE';
}

function biGrantRow(biId: string, entity: BiEntity, entry: BiAccessEntry & { principal: string; role: string }): GrantRow {
  return {
    id: `${biId}:${entry.principal}:${entry.role}`,
    assetId: biId,
    assetName: entity.name ?? biId,
    assetType: entity.kind ?? 'tableau_dashboard',
    assetHasPii: false,
    assetCriticality: null,
    principal: entry.principal,
    principalType: biPrincipalType(entry.principal),
    displayName: null,
    department: null,
    privilege: entry.role,
    memberCount: 1,
    effectivePrincipals: 1,
    isOverBroad: false,
    grantedBy: entry.grantedBy ?? null,
    grantedDate: entry.grantedDate ?? null,
    status: 'active',
    reviewedBy: null,
    auditTrail: [],
    declaredScope: `${entity.platform ?? 'External BI'} · ${entity.name ?? rawEntityId(entity)}`,
  };
}

function rawEntityId(entity: BiEntity): string {
  return entity.externalMetadataName ?? entity.id ?? 'unknown';
}

function biPrincipalType(principal: string): string {
  if (principal.includes('@')) return 'user';
  if (/^[0-9a-f-]{36}$/i.test(principal)) return 'service_principal';
  return 'group';
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

// Hits are stable; misses are often a missing OBO scope and should retry soon.
const lakeviewNameCache = new Map<string, { value: string | null; expiresAt: number }>();
const NAME_HIT_MS = 10 * 60 * 1000;
const NAME_MISS_MS = 30 * 1000;

async function lakeviewName(req: Request, dashboardId: string): Promise<string | null> {
  const cached = lakeviewNameCache.get(dashboardId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const name = await fetchLakeviewName(req, dashboardId);
  lakeviewNameCache.set(dashboardId, {
    value: name,
    expiresAt: Date.now() + (name ? NAME_HIT_MS : NAME_MISS_MS),
  });
  return name;
}

async function fetchLakeviewName(req: Request, dashboardId: string): Promise<string | null> {
  try {
    const result = await fetchWorkspaceJson(
      req,
      `/api/2.0/lakeview/dashboards/${encodeURIComponent(dashboardId)}`,
    );
    if (!result.ok) {
      console.error(
        `[lineage] lakeview name lookup failed for ${dashboardId}: HTTP ${result.status} ${result.text}`,
      );
      return null;
    }
    return lakeviewDisplayName(result.body);
  } catch {
    return null;
  }
}

export function lakeviewDisplayName(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const record = body as Record<string, unknown>;
  const name = record.display_name ?? record.displayName;
  return typeof name === 'string' && name.trim() ? name.trim() : null;
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

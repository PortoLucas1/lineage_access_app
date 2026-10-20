import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appAuthHeaders } from '../lib/auth.js';
import { workspaceHost } from '../lib/statement-execution.js';

export type PrincipalPrivileges = Record<string, string[]>;

export type DeclaredManifest = {
  catalog: PrincipalPrivileges;
  schemas: Record<string, PrincipalPrivileges>;
  tables: Record<string, PrincipalPrivileges>;
  sourcePath: string | null;
};

type WorkspaceListResponse = {
  objects?: Array<{ path?: string; object_type?: string }>;
};

type WorkspaceExportResponse = {
  content?: string;
  file_type?: string;
};

const here = dirname(fileURLToPath(import.meta.url));
const DISK_CANDIDATES = [
  resolve(here, '../../config/.declared-grants.json'),
  resolve(here, '../../../terraform/.declared-grants.json'),
  resolve(here, '../../config/declared-grants.json'),
];
const BUNDLED_PATH = 'terraform/declared-grants.json';
const GRANT_JSON_NAMES = ['.declared-grants.json', 'declared-grants.json'];
const GRANT_TF_NAMES = ['databricks_permissions.tf', 'extsystem_permissions.tf'];

let runtimePath: string | null = null;
let runtimeManifest: DeclaredManifest | null = null;

export function parseDeclaredManifest(raw: unknown, sourcePath: string | null): DeclaredManifest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { catalog: {}, schemas: {}, tables: {}, sourcePath };
  }
  const record = raw as Record<string, unknown>;
  if (isPrincipalMap(record.catalog) || isNestedPrincipalMap(record.schemas) || isNestedPrincipalMap(record.tables)) {
    return {
      catalog: isPrincipalMap(record.catalog) ? record.catalog : {},
      schemas: isNestedPrincipalMap(record.schemas) ? record.schemas : {},
      tables: isNestedPrincipalMap(record.tables) ? record.tables : {},
      sourcePath,
    };
  }
  if (isPrincipalMap(record)) {
    return { catalog: record, schemas: {}, tables: {}, sourcePath };
  }
  return { catalog: {}, schemas: {}, tables: {}, sourcePath };
}

function loadDiskManifest(): DeclaredManifest {
  for (const candidate of DISK_CANDIDATES) {
    if (!existsSync(candidate)) continue;
    const raw = JSON.parse(readFileSync(candidate, 'utf8')) as unknown;
    const hidden = candidate.endsWith('/.declared-grants.json');
    return parseDeclaredManifest(raw, hidden ? '.declared-grants.json' : BUNDLED_PATH);
  }
  return parseDeclaredManifest({}, null);
}

export function getDeclaredManifest(): DeclaredManifest {
  return runtimeManifest ?? loadDiskManifest();
}

export function getDeclaredSourcePath(): string | null {
  return runtimePath;
}

export function clearDeclaredSource(): DeclaredManifest {
  runtimePath = null;
  runtimeManifest = null;
  return getDeclaredManifest();
}

export async function loadDeclaredSourceFromWorkspace(path: string): Promise<DeclaredManifest> {
  const normalized = normalizeWorkspacePath(path);
  const headers = await appAuthHeaders();
  const source = await resolveGrantSource(normalized, headers);
  if (!source.jsonPath) {
    runtimePath = source.folderPath;
    runtimeManifest = { ...loadDiskManifest(), sourcePath: source.folderPath };
    return runtimeManifest;
  }
  const raw = await exportWorkspaceJson(source.jsonPath, headers);
  const manifest = parseDeclaredManifest(raw, source.jsonPath);
  runtimePath = source.jsonPath;
  runtimeManifest = manifest;
  return manifest;
}

export function privilegesForTable(
  manifest: DeclaredManifest,
  assetId: string,
): Array<{ principal: string; privilege: string; inheritedFromType: string; inheritedFromName: string }> {
  const [catalog, schema, table] = assetId.split('.');
  if (!catalog || !schema || !table) return [];
  const rows: Array<{
    principal: string;
    privilege: string;
    inheritedFromType: string;
    inheritedFromName: string;
  }> = [];
  pushPrivileges(rows, manifest.catalog, 'CATALOG', catalog);
  const schemaKeys = [`${catalog}.${schema}`, schema];
  for (const key of schemaKeys) {
    const grants = manifest.schemas[key];
    if (grants) pushPrivileges(rows, grants, 'SCHEMA', `${catalog}.${schema}`);
  }
  const tableKeys = [assetId, `${schema}.${table}`, table];
  for (const key of tableKeys) {
    const grants = manifest.tables[key];
    if (grants) pushPrivileges(rows, grants, 'TABLE', assetId);
  }
  return rows;
}

function pushPrivileges(
  rows: Array<{ principal: string; privilege: string; inheritedFromType: string; inheritedFromName: string }>,
  grants: PrincipalPrivileges,
  inheritedFromType: string,
  inheritedFromName: string,
): void {
  for (const [principal, privileges] of Object.entries(grants)) {
    for (const privilege of privileges) {
      rows.push({ principal, privilege, inheritedFromType, inheritedFromName });
    }
  }
}

function isPrincipalMap(value: unknown): value is PrincipalPrivileges {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value).every((item) => Array.isArray(item) && item.every((entry) => typeof entry === 'string'));
}

function isNestedPrincipalMap(value: unknown): value is Record<string, PrincipalPrivileges> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value).every((item) => isPrincipalMap(item));
}

function normalizeWorkspacePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) throw new Error('folder path is required');
  const withSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withSlash.replace(/\/+$/, '') || '/';
}

async function resolveGrantSource(
  path: string,
  headers: Headers,
): Promise<{ jsonPath: string | null; folderPath: string }> {
  if (GRANT_JSON_NAMES.some((name) => path.endsWith(name))) {
    return { jsonPath: path, folderPath: path };
  }
  const listed = await listWorkspace(path, headers);
  const files = listed.objects ?? [];
  const json = GRANT_JSON_NAMES
    .map((name) => files.find((object) => (object.path ?? '').endsWith(name)))
    .find((object) => object?.path);
  if (json?.path) return { jsonPath: json.path, folderPath: path };
  const hasTf = files.some((object) =>
    GRANT_TF_NAMES.some((name) => (object.path ?? '').endsWith(name)),
  );
  if (hasTf) return { jsonPath: null, folderPath: path };
  const names = files.map((object) => object.path?.split('/').pop()).filter(Boolean).join(', ');
  throw new Error(
    names
      ? `No databricks_permissions.tf, extsystem_permissions.tf, or declared-grants.json in ${path}. Found: ${names}`
      : `The App service principal cannot see files in ${path}. Grant it CAN_READ on that workspace folder.`,
  );
}

async function listWorkspace(path: string, headers: Headers): Promise<WorkspaceListResponse> {
  const url = `${workspaceHost()}/api/2.0/workspace/list?path=${encodeURIComponent(path)}`;
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
  if (response.status === 404) {
    throw new Error(`Folder not found: ${path}`);
  }
  if (response.status === 403) {
    throw new Error(
      `The App service principal cannot access ${path}. Grant it CAN_READ on that workspace folder.`,
    );
  }
  if (!response.ok) {
    throw new Error(`Workspace list returned ${response.status}: ${await response.text()}`);
  }
  return (await response.json()) as WorkspaceListResponse;
}

async function exportWorkspaceJson(path: string, headers: Headers): Promise<unknown> {
  const url =
    `${workspaceHost()}/api/2.0/workspace/export?path=${encodeURIComponent(path)}`
    + '&format=AUTO&direct_download=false';
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) {
    throw new Error(`Could not read ${path}: HTTP ${response.status}`);
  }
  const body = (await response.json()) as WorkspaceExportResponse;
  if (!body.content) throw new Error(`Workspace export for ${path} had no content`);
  const decoded = Buffer.from(body.content, 'base64').toString('utf8');
  try {
    return JSON.parse(decoded);
  } catch {
    throw new Error(`${path} is not valid JSON`);
  }
}

export const bundledManifestPath = BUNDLED_PATH;

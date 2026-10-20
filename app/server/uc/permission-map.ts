import type { Request } from 'express';
import { appAuthHeaders } from '../lib/auth.js';
import { getDeclaredManifest } from './declared-grants.js';
import { executeStatement, sqlLiteral, workspaceHost } from '../lib/statement-execution.js';
import {
  accessLevel,
  privilegeAppliesTo,
  type AccessLevel,
  type AssetCategory,
} from './access-level.js';
import type { IdentityKind } from './identities.js';

export type PrivilegeGrant = {
  privilege: string;
  inheritedFromType: string | null;
  inheritedFromName: string | null;
  conveyedBy: string;
};

export type MappedAsset = {
  category: AssetCategory;
  securableType: string;
  fullName: string;
  name: string;
  tableType: string | null;
  privileges: PrivilegeGrant[];
  accessLevel: AccessLevel;
};

export type PermissionMap = {
  catalog: string | null;
  principal: string;
  truncated: boolean;
  errors: string[];
  categories: Record<AssetCategory, MappedAsset[]>;
  source: 'declared' | 'effective';
};

export function principalsToQuery(
  principal: string,
  kind: IdentityKind | undefined,
  conveyedBy: Iterable<string>,
): string[] {
  const trimmed = principal.trim();
  if (kind === 'group') return [trimmed];
  const names = new Set<string>([trimmed]);
  for (const name of conveyedBy) {
    const next = name.trim();
    if (next) names.add(next);
  }
  return [...names];
}

type EffectiveResponse = {
  privilege_assignments?: Array<{
    principal?: string;
    privileges?: Array<{
      privilege?: string;
      inherited_from_name?: string;
      inherited_from_type?: string;
    }>;
  }>;
};

const IDENTIFIER = /^[A-Za-z0-9_-]+$/;
const TABLE_LIMIT = 2000;
const SCHEMA_LIMIT = 400;
const LIVE_CACHE_TTL_MS = 45_000;
const liveCache = new Map<string, { expires: number; value: PermissionMap }>();

function baselineCatalogName(): string | null {
  return process.env.DEMO_CATALOG || process.env.DATABRICKS_DEFAULT_CATALOG || null;
}

function emptyCategories(): PermissionMap['categories'] {
  return { catalog: [], schema: [], table: [], volume: [], function: [] };
}

/**
 * Instant map from terraform/declared-grants.json — no warehouse, no UC API.
 * Catalog grants in that file are for the Terraform target catalog (DEMO_CATALOG).
 */
export function getDeclaredPermissionMap(
  catalog: string | null,
  principal: string,
  kind?: IdentityKind,
): PermissionMap {
  const catalogFilter = catalog && catalog !== 'all' ? catalog : null;
  const trimmedPrincipal = principal.trim();
  const targetCatalog = catalogFilter || baselineCatalogName();
  const baseline = baselineCatalogName();
  if (!trimmedPrincipal || !targetCatalog || (catalogFilter && baseline && catalogFilter !== baseline)) {
    return {
      catalog: catalogFilter,
      principal: trimmedPrincipal,
      truncated: false,
      errors: [],
      categories: emptyCategories(),
      source: 'declared',
    };
  }

  return assembleMap({
    catalog: catalogFilter,
    principal: trimmedPrincipal,
    grants: declaredGrantsForPrincipal(trimmedPrincipal, kind, targetCatalog),
    extraCatalogGrants: [],
    extraCatalogName: null,
    truncated: false,
    errors: [],
    source: 'declared',
  });
}

function declaredGrantsForPrincipal(
  principal: string,
  kind: IdentityKind | undefined,
  catalogName: string,
): SqlGrant[] {
  const manifest = getDeclaredManifest();
  const keys = matchingDeclaredPrincipals(Object.keys(manifest.catalog), principal, kind);
  const grants: SqlGrant[] = [];
  for (const key of keys) {
    const inherited = key.toLowerCase() !== principal.toLowerCase();
    for (const privilege of manifest.catalog[key] ?? []) {
      grants.push({
        fullName: catalogName,
        category: 'catalog',
        grant: {
          privilege,
          inheritedFromType: inherited ? 'GROUP' : null,
          inheritedFromName: inherited ? key : null,
          conveyedBy: key,
        },
      });
    }
  }
  for (const [schemaKey, principals] of Object.entries(manifest.schemas)) {
    const schemaName = schemaKey.includes('.') ? schemaKey : `${catalogName}.${schemaKey}`;
    for (const key of matchingDeclaredPrincipals(Object.keys(principals), principal, kind)) {
      const inherited = key.toLowerCase() !== principal.toLowerCase();
      for (const privilege of principals[key] ?? []) {
        grants.push({
          fullName: schemaName,
          category: 'schema',
          grant: {
            privilege,
            inheritedFromType: inherited ? 'GROUP' : 'SCHEMA',
            inheritedFromName: inherited ? key : schemaName,
            conveyedBy: key,
          },
        });
      }
    }
  }
  for (const [tableKey, principals] of Object.entries(manifest.tables)) {
    const tableName = tableKey.split('.').length >= 3 ? tableKey : `${catalogName}.${tableKey}`;
    for (const key of matchingDeclaredPrincipals(Object.keys(principals), principal, kind)) {
      const inherited = key.toLowerCase() !== principal.toLowerCase();
      for (const privilege of principals[key] ?? []) {
        grants.push({
          fullName: tableName,
          category: 'table',
          grant: {
            privilege,
            inheritedFromType: inherited ? 'GROUP' : 'TABLE',
            inheritedFromName: inherited ? key : tableName,
            conveyedBy: key,
          },
        });
      }
    }
  }
  return grants;
}

function matchingDeclaredPrincipals(
  names: string[],
  principal: string,
  kind: IdentityKind | undefined,
): string[] {
  const keys = new Set<string>();
  const exact = names.find((key) => key.toLowerCase() === principal.toLowerCase());
  if (exact) keys.add(exact);
  if (kind !== 'group') {
    const accountUsers = names.find((key) => key.toLowerCase() === 'account users');
    if (accountUsers) keys.add(accountUsers);
  }
  return [...keys];
}

export async function getPermissionMap(
  req: Request,
  catalog: string | null,
  principal: string,
  kind?: IdentityKind,
): Promise<PermissionMap> {
  const catalogFilter = catalog && catalog !== 'all' ? catalog : null;
  if (catalogFilter && !IDENTIFIER.test(catalogFilter)) {
    throw new Error('catalog must contain only letters, numbers, underscores, or hyphens');
  }
  const trimmedPrincipal = principal.trim();
  if (!trimmedPrincipal) throw new Error('principal is required');

  const cacheKey = `${catalogFilter ?? 'all'}\u0000${trimmedPrincipal}\u0000${kind ?? ''}`;
  const cached = process.env.VITEST ? undefined : liveCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.value;

  const errors: string[] = [];
  const probeCatalog = catalogFilter || baselineCatalogName() || '';

  const principalGrantsPromise = listDirectGrants(req, catalogFilter, [trimmedPrincipal], errors);
  const schemasPromise = catalogFilter ? listSchemas(req, catalogFilter, errors) : Promise.resolve([]);
  const probePromise =
    kind === 'group' || !probeCatalog
      ? Promise.resolve(null)
      : getEffective('catalog', probeCatalog, trimmedPrincipal).catch((error) => {
          if (catalogFilter) throw error;
          errors.push(error instanceof Error ? error.message : String(error));
          return [] as PrivilegeGrant[];
        });

  const [principalGrants, probed, schemas] = await Promise.all([
    principalGrantsPromise,
    probePromise,
    schemasPromise,
  ]);

  let effectiveCatalogGrants: PrivilegeGrant[] = [];
  let conveyedBy: string[] = [];
  if (probed) {
    conveyedBy = probed.map((grant) => grant.conveyedBy);
    if (catalogFilter) effectiveCatalogGrants = probed;
  }

  const principals = principalsToQuery(trimmedPrincipal, kind, conveyedBy);
  const extraPrincipals = principals.filter((name) => name !== trimmedPrincipal);
  const extraGrants = extraPrincipals.length
    ? await listDirectGrants(req, catalogFilter, extraPrincipals, errors)
    : [];
  const sqlGrants = [...principalGrants, ...extraGrants];

  const result = assembleMap({
    catalog: catalogFilter,
    principal: trimmedPrincipal,
    grants: sqlGrants,
    extraCatalogGrants: effectiveCatalogGrants,
    extraCatalogName: catalogFilter,
    schemas,
    truncated: sqlGrants.length >= TABLE_LIMIT || schemas.length >= SCHEMA_LIMIT,
    errors,
    source: 'effective',
  });
  if (!process.env.VITEST) {
    liveCache.set(cacheKey, { expires: Date.now() + LIVE_CACHE_TTL_MS, value: result });
  }
  return result;
}

export async function getPermissionMapChildren(
  req: Request,
  catalog: string,
  schema: string,
  principal: string,
  kind?: IdentityKind,
): Promise<MappedAsset[]> {
  if (!IDENTIFIER.test(catalog) || !IDENTIFIER.test(schema)) {
    throw new Error('catalog and schema must contain only letters, numbers, underscores, or hyphens');
  }
  const trimmedPrincipal = principal.trim();
  if (!trimmedPrincipal) throw new Error('principal is required');

  const errors: string[] = [];
  let schemaGrants: PrivilegeGrant[] = [];
  try {
    schemaGrants = await getEffective('schema', `${catalog}.${schema}`, trimmedPrincipal);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  const objects = await listSchemaObjects(req, catalog, schema, errors);
  const byObject = new Map<string, ObjectAccum>();
  const add = (
    fullName: string,
    grant: PrivilegeGrant,
    category: AssetCategory,
    tableType: string | null,
  ) => {
    if (!privilegeAppliesTo(grant.privilege, category)) return;
    const current = byObject.get(fullName);
    if (!current) {
      byObject.set(fullName, {
        category,
        name: fullName.split('.').pop() ?? fullName,
        tableType,
        privileges: [grant],
      });
      return;
    }
    if (tableType && !current.tableType) current.tableType = tableType;
    if (current.privileges.some((item) => item.privilege === grant.privilege && item.conveyedBy === grant.conveyedBy)) {
      return;
    }
    current.privileges.push(grant);
  };

  for (const object of objects) {
    for (const grant of schemaGrants) {
      add(
        object.fullName,
        inherit(grant, grant.inheritedFromType ?? 'SCHEMA', grant.inheritedFromName ?? `${catalog}.${schema}`),
        object.category,
        object.tableType,
      );
    }
  }

  void kind;
  return [...byObject.entries()]
    .map(([fullName, object]) => ({
      category: object.category,
      securableType: object.category,
      fullName,
      name: object.name,
      tableType: object.tableType,
      privileges: object.privileges.sort((a, b) => a.privilege.localeCompare(b.privilege)),
      accessLevel: accessLevel(object.privileges.map((grant) => grant.privilege)),
    }))
    .sort(
      (a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name),
    );
}

function inherit(grant: PrivilegeGrant, type: string, name: string): PrivilegeGrant {
  if (grant.inheritedFromType && grant.inheritedFromName) return grant;
  return { ...grant, inheritedFromType: type, inheritedFromName: name };
}

function assembleMap(input: {
  catalog: string | null;
  principal: string;
  grants: SqlGrant[];
  extraCatalogGrants: PrivilegeGrant[];
  extraCatalogName: string | null;
  schemas?: string[];
  truncated: boolean;
  errors: string[];
  source: PermissionMap['source'];
}): PermissionMap {
  const byObject = new Map<string, ObjectAccum>();
  const add = (
    fullName: string,
    grant: PrivilegeGrant,
    category: AssetCategory,
    tableType: string | null = null,
  ) => {
    if (category !== 'catalog' && !privilegeAppliesTo(grant.privilege, category)) return;
    const current = byObject.get(fullName);
    if (!current) {
      byObject.set(fullName, {
        category,
        name: fullName.split('.').pop() ?? fullName,
        tableType,
        privileges: [grant],
      });
      return;
    }
    if (tableType && !current.tableType) current.tableType = tableType;
    if (current.privileges.some((item) => item.privilege === grant.privilege && item.conveyedBy === grant.conveyedBy)) {
      return;
    }
    current.privileges.push(grant);
  };

  if (input.extraCatalogName) {
    for (const grant of input.extraCatalogGrants) add(input.extraCatalogName, grant, 'catalog');
  }
  for (const row of input.grants) add(row.fullName, row.grant, row.category);

  const catalogGrants = [
    ...input.extraCatalogGrants,
    ...input.grants.filter((row) => row.category === 'catalog').map((row) => row.grant),
  ];
  for (const schemaName of input.schemas ?? []) {
    const catalogName = schemaName.split('.')[0] ?? input.extraCatalogName;
    if (!catalogName) continue;
    for (const grant of catalogGrants) {
      add(schemaName, inherit(grant, 'CATALOG', catalogName), 'schema');
    }
  }

  const categories = emptyCategories();
  for (const [fullName, object] of byObject) {
    categories[object.category].push({
      category: object.category,
      securableType: object.category,
      fullName,
      name: object.name,
      tableType: object.tableType,
      privileges: object.privileges.sort((a, b) => a.privilege.localeCompare(b.privilege)),
      accessLevel: accessLevel(object.privileges.map((grant) => grant.privilege)),
    });
  }
  for (const key of Object.keys(categories) as AssetCategory[]) {
    categories[key].sort((a, b) => a.fullName.localeCompare(b.fullName));
  }

  return {
    catalog: input.catalog,
    principal: input.principal,
    truncated: input.truncated,
    errors: input.errors,
    categories,
    source: input.source,
  };
}

type ObjectAccum = {
  category: AssetCategory;
  name: string;
  tableType: string | null;
  privileges: PrivilegeGrant[];
};

async function getEffective(
  securableType: string,
  fullName: string,
  principal: string,
): Promise<PrivilegeGrant[]> {
  const headers = await appAuthHeaders();
  const url =
    `${workspaceHost()}/api/2.1/unity-catalog/effective-permissions/`
    + `${securableType}/${encodeURIComponent(fullName)}`
    + `?principal=${encodeURIComponent(principal)}`;
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`Effective Permissions API returned ${response.status}: ${await response.text()}`);
  }
  const body = (await response.json()) as EffectiveResponse;
  const grants: PrivilegeGrant[] = [];
  for (const assignment of body.privilege_assignments ?? []) {
    const conveyedBy = assignment.principal || principal;
    for (const item of assignment.privileges ?? []) {
      if (!item.privilege) continue;
      grants.push({
        privilege: item.privilege,
        inheritedFromType: item.inherited_from_type ?? null,
        inheritedFromName: item.inherited_from_name ?? null,
        conveyedBy,
      });
    }
  }
  return grants;
}

type SchemaObject = {
  fullName: string;
  category: AssetCategory;
  tableType: string | null;
};

async function listSchemas(req: Request, catalog: string, errors: string[]): Promise<string[]> {
  try {
    const rows = await executeStatement(
      req,
      `SELECT schema_name
         FROM system.information_schema.schemata
        WHERE catalog_name = '${sqlLiteral(catalog)}'
          AND schema_name <> 'information_schema'
        ORDER BY schema_name
        LIMIT ${SCHEMA_LIMIT}`,
    );
    return rows.map(([name]) => `${catalog}.${String(name)}`);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
    return [];
  }
}

async function listSchemaObjects(
  req: Request,
  catalog: string,
  schema: string,
  errors: string[],
): Promise<SchemaObject[]> {
  const catalogLit = sqlLiteral(catalog);
  const schemaLit = sqlLiteral(schema);
  const queries: Array<{ sql: string; category: AssetCategory; fallbackType: string }> = [
    {
      sql: `SELECT table_name, table_type
              FROM system.information_schema.tables
             WHERE table_catalog = '${catalogLit}'
               AND table_schema = '${schemaLit}'
               AND NOT STARTSWITH(table_name, '__materialization')
             ORDER BY table_name
             LIMIT ${TABLE_LIMIT}`,
      category: 'table',
      fallbackType: 'TABLE',
    },
    {
      sql: `SELECT volume_name, volume_type
              FROM system.information_schema.volumes
             WHERE volume_catalog = '${catalogLit}'
               AND volume_schema = '${schemaLit}'
             ORDER BY volume_name
             LIMIT ${TABLE_LIMIT}`,
      category: 'volume',
      fallbackType: 'VOLUME',
    },
    {
      sql: `SELECT routine_name, routine_type
              FROM system.information_schema.routines
             WHERE routine_catalog = '${catalogLit}'
               AND routine_schema = '${schemaLit}'
             ORDER BY routine_name
             LIMIT ${TABLE_LIMIT}`,
      category: 'function',
      fallbackType: 'FUNCTION',
    },
  ];
  const batches = await Promise.all(
    queries.map(async (query) => {
      try {
        const rows = await executeStatement(req, query.sql);
        return rows.map(([name, type]) => ({
          fullName: `${catalog}.${schema}.${String(name)}`,
          category: query.category,
          tableType: type == null ? query.fallbackType : String(type),
        }));
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
        return [] as SchemaObject[];
      }
    }),
  );
  return batches.flat();
}

type SqlGrant = { fullName: string; category: AssetCategory; grant: PrivilegeGrant };

async function listDirectGrants(
  req: Request,
  catalog: string | null,
  principals: string[],
  errors: string[],
): Promise<SqlGrant[]> {
  if (!principals.length) return [];
  const inList = principals.map((principal) => `'${sqlLiteral(principal)}'`).join(', ');
  const catalogPred = (column: string) =>
    catalog ? ` AND ${column} = '${sqlLiteral(catalog)}'` : '';
  const directPred = " AND COALESCE(inherited_from, 'NONE') IN ('NONE', 'none', '')";

  const scopeQueries: Array<{ sql: string; parse: (row: unknown[]) => SqlGrant | null }> = [
    {
      sql: `SELECT catalog_name, privilege_type, inherited_from, grantee
              FROM system.information_schema.catalog_privileges
             WHERE grantee IN (${inList})${catalogPred('catalog_name')}${directPred}
             LIMIT ${TABLE_LIMIT}`,
      parse: (row) => sqlGrant('catalog', String(row[0]), row, 1),
    },
    {
      sql: `SELECT catalog_name, schema_name, privilege_type, inherited_from, grantee
              FROM system.information_schema.schema_privileges
             WHERE grantee IN (${inList})${catalogPred('catalog_name')}${directPred}
               AND schema_name <> 'information_schema'
             LIMIT ${TABLE_LIMIT}`,
      parse: (row) => sqlGrant('schema', `${row[0]}.${row[1]}`, row, 2),
    },
  ];
  const grants = await runGrantQueries(req, scopeQueries, errors);
  if (!catalog) return grants;

  const catalogIn = catalogPred('table_catalog');
  const volumeCatalogIn = catalogPred('volume_catalog');
  const routineCatalogIn = catalogPred('routine_catalog');

  const objectQueries: Array<{ sql: string; parse: (row: unknown[]) => SqlGrant | null }> = [
    {
      sql: `SELECT table_catalog, table_schema, table_name, privilege_type, inherited_from, grantee
              FROM system.information_schema.table_privileges
             WHERE grantee IN (${inList})${catalogIn}${directPred}
             LIMIT ${TABLE_LIMIT}`,
      parse: (row) => sqlGrant('table', `${row[0]}.${row[1]}.${row[2]}`, row, 3),
    },
    {
      sql: `SELECT volume_catalog, volume_schema, volume_name, privilege_type, inherited_from, grantee
              FROM system.information_schema.volume_privileges
             WHERE grantee IN (${inList})${volumeCatalogIn}${directPred}
             LIMIT ${TABLE_LIMIT}`,
      parse: (row) => sqlGrant('volume', `${row[0]}.${row[1]}.${row[2]}`, row, 3),
    },
    {
      sql: `SELECT routine_catalog, routine_schema, routine_name, privilege_type, inherited_from, grantee
              FROM system.information_schema.routine_privileges
             WHERE grantee IN (${inList})${routineCatalogIn}${directPred}
             LIMIT ${TABLE_LIMIT}`,
      parse: (row) => sqlGrant('function', `${row[0]}.${row[1]}.${row[2]}`, row, 3),
    },
  ];
  grants.push(...await runGrantQueries(req, objectQueries, errors));
  return grants;
}

async function runGrantQueries(
  req: Request,
  queries: Array<{ sql: string; parse: (row: unknown[]) => SqlGrant | null }>,
  errors: string[],
): Promise<SqlGrant[]> {
  const batches = await Promise.all(
    queries.map(async (query) => {
      try {
        const rows = await executeStatement(req, query.sql);
        return rows.map((row) => query.parse(row)).filter((row): row is SqlGrant => row !== null);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
        return [];
      }
    }),
  );
  return batches.flat();
}

function sqlGrant(
  category: AssetCategory,
  fullName: string,
  row: unknown[],
  privilegeIndex = 1,
): SqlGrant | null {
  const privilege = row[privilegeIndex];
  const inheritedFrom = row[privilegeIndex + 1];
  const grantee = row[privilegeIndex + 2];
  if (privilege == null || grantee == null) return null;
  const inherited = inheritedFrom == null ? 'NONE' : String(inheritedFrom).toUpperCase();
  const isDirect = inherited === 'NONE' || inherited === '';
  return {
    fullName: String(fullName),
    category,
    grant: {
      privilege: String(privilege),
      inheritedFromType: isDirect ? null : inherited,
      inheritedFromName: isDirect ? null : String(inheritedFrom),
      conveyedBy: String(grantee),
    },
  };
}

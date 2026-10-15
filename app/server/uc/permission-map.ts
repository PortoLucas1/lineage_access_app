import type { Request } from 'express';
import { authHeaders } from '../lib/auth.js';
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

  const errors: string[] = [];
  let effectiveCatalogGrants: PrivilegeGrant[] = [];
  let conveyedBy: string[] = [];

  if (kind !== 'group') {
    const probeCatalog = catalogFilter ?? process.env.DATABRICKS_DEFAULT_CATALOG ?? 'porto_catalog';
    try {
      const probed = await getEffective(req, 'catalog', probeCatalog, trimmedPrincipal);
      conveyedBy = probed.map((grant) => grant.conveyedBy);
      if (catalogFilter) effectiveCatalogGrants = probed;
    } catch (error) {
      if (catalogFilter) throw error;
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  const principals = principalsToQuery(trimmedPrincipal, kind, conveyedBy);
  const sqlGrants = await listDirectGrants(req, catalogFilter, principals, errors);

  const schemas: NamedObject[] = [];
  const tables: NamedObject[] = [];
  const volumes: NamedObject[] = [];
  const functions: NamedObject[] = [];

  if (catalogFilter) {
    const [listedSchemas, listedTables, listedVolumes, listedFunctions] = await Promise.all([
      listSchemas(req, catalogFilter),
      listTables(req, catalogFilter),
      listOptional(req, catalogFilter, 'volume', errors),
      listOptional(req, catalogFilter, 'function', errors),
    ]);
    schemas.push(...listedSchemas);
    tables.push(...listedTables);
    volumes.push(...listedVolumes);
    functions.push(...listedFunctions);
  }

  const truncated =
    schemas.length >= SCHEMA_LIMIT
    || tables.length >= TABLE_LIMIT
    || sqlGrants.length >= TABLE_LIMIT;

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

  const propagateCatalogGrant = (catalogName: string, grant: PrivilegeGrant) => {
    add(catalogName, grant, 'catalog');
    for (const schema of schemas) {
      if (schema.fullName.startsWith(`${catalogName}.`) && privilegeAppliesTo(grant.privilege, 'schema')) {
        add(schema.fullName, inherit(grant, 'CATALOG', catalogName), 'schema');
      }
    }
    for (const table of tables) {
      if (table.fullName.startsWith(`${catalogName}.`) && privilegeAppliesTo(grant.privilege, 'table')) {
        add(table.fullName, inherit(grant, 'CATALOG', catalogName), 'table', table.tableType);
      }
    }
    for (const volume of volumes) {
      if (volume.fullName.startsWith(`${catalogName}.`) && privilegeAppliesTo(grant.privilege, 'volume')) {
        add(volume.fullName, inherit(grant, 'CATALOG', catalogName), 'volume', volume.tableType);
      }
    }
    for (const fn of functions) {
      if (fn.fullName.startsWith(`${catalogName}.`) && privilegeAppliesTo(grant.privilege, 'function')) {
        add(fn.fullName, inherit(grant, 'CATALOG', catalogName), 'function', fn.tableType);
      }
    }
  };

  for (const grant of effectiveCatalogGrants) {
    if (catalogFilter) propagateCatalogGrant(catalogFilter, grant);
  }

  for (const row of sqlGrants) {
    add(row.fullName, row.grant, row.category);
    if (row.category === 'catalog') propagateCatalogGrant(row.fullName, row.grant);
    if (row.category === 'schema') {
      for (const table of tables) {
        if (table.schemaFullName !== row.fullName) continue;
        if (privilegeAppliesTo(row.grant.privilege, 'table')) {
          add(table.fullName, inherit(row.grant, 'SCHEMA', row.fullName), 'table', table.tableType);
        }
      }
      for (const volume of volumes) {
        if (volume.schemaFullName !== row.fullName) continue;
        if (privilegeAppliesTo(row.grant.privilege, 'volume')) {
          add(volume.fullName, inherit(row.grant, 'SCHEMA', row.fullName), 'volume', volume.tableType);
        }
      }
      for (const fn of functions) {
        if (fn.schemaFullName !== row.fullName) continue;
        if (privilegeAppliesTo(row.grant.privilege, 'function')) {
          add(fn.fullName, inherit(row.grant, 'SCHEMA', row.fullName), 'function', fn.tableType);
        }
      }
    }
  }

  const categories: PermissionMap['categories'] = {
    catalog: [],
    schema: [],
    table: [],
    volume: [],
    function: [],
  };
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

  return { catalog: catalogFilter, principal: trimmedPrincipal, truncated, errors, categories };
}

type ObjectAccum = {
  category: AssetCategory;
  name: string;
  tableType: string | null;
  privileges: PrivilegeGrant[];
};

function inherit(
  grant: PrivilegeGrant,
  type: string,
  name: string,
): PrivilegeGrant {
  if (grant.inheritedFromType && grant.inheritedFromName) return grant;
  return {
    ...grant,
    inheritedFromType: type,
    inheritedFromName: name,
  };
}

async function getEffective(
  req: Request,
  securableType: string,
  fullName: string,
  principal: string,
): Promise<PrivilegeGrant[]> {
  const headers = await authHeaders(req);
  const url =
    `${workspaceHost()}/api/2.1/unity-catalog/effective-permissions/`
    + `${securableType}/${encodeURIComponent(fullName)}`
    + `?principal=${encodeURIComponent(principal)}`;
  const response = await fetch(url, { headers });
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

type NamedObject = {
  name: string;
  fullName: string;
  schemaFullName: string;
  tableType: string | null;
};

async function listSchemas(req: Request, catalog: string): Promise<NamedObject[]> {
  const rows = await executeStatement(
    req,
    `SELECT schema_name
       FROM system.information_schema.schemata
      WHERE catalog_name = '${sqlLiteral(catalog)}'
        AND schema_name <> 'information_schema'
      ORDER BY schema_name
      LIMIT ${SCHEMA_LIMIT}`,
  );
  return rows.map(([name]) => {
    const schema = String(name);
    return {
      name: schema,
      fullName: `${catalog}.${schema}`,
      schemaFullName: `${catalog}.${schema}`,
      tableType: null,
    };
  });
}

async function listTables(req: Request, catalog: string): Promise<NamedObject[]> {
  const rows = await executeStatement(
    req,
    `SELECT table_schema, table_name, table_type
       FROM system.information_schema.tables
      WHERE table_catalog = '${sqlLiteral(catalog)}'
        AND table_schema <> 'information_schema'
        AND NOT STARTSWITH(table_name, '__materialization')
      ORDER BY table_schema, table_name
      LIMIT ${TABLE_LIMIT}`,
  );
  return rows.map(([schema, name, tableType]) => ({
    name: String(name),
    fullName: `${catalog}.${String(schema)}.${String(name)}`,
    schemaFullName: `${catalog}.${String(schema)}`,
    tableType: tableType == null ? 'TABLE' : String(tableType),
  }));
}

async function listOptional(
  req: Request,
  catalog: string,
  kind: 'volume' | 'function',
  errors: string[],
): Promise<NamedObject[]> {
  try {
    if (kind === 'volume') {
      const rows = await executeStatement(
        req,
        `SELECT volume_schema, volume_name, volume_type
           FROM system.information_schema.volumes
          WHERE volume_catalog = '${sqlLiteral(catalog)}'
          ORDER BY volume_schema, volume_name
          LIMIT ${TABLE_LIMIT}`,
      );
      return rows.map(([schema, name, type]) => ({
        name: String(name),
        fullName: `${catalog}.${String(schema)}.${String(name)}`,
        schemaFullName: `${catalog}.${String(schema)}`,
        tableType: type == null ? 'VOLUME' : String(type),
      }));
    }
    const rows = await executeStatement(
      req,
      `SELECT routine_schema, routine_name, routine_type
         FROM system.information_schema.routines
        WHERE routine_catalog = '${sqlLiteral(catalog)}'
        ORDER BY routine_schema, routine_name
        LIMIT ${TABLE_LIMIT}`,
    );
    return rows.map(([schema, name, type]) => ({
      name: String(name),
      fullName: `${catalog}.${String(schema)}.${String(name)}`,
      schemaFullName: `${catalog}.${String(schema)}`,
      tableType: type == null ? 'FUNCTION' : String(type),
    }));
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
    return [];
  }
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

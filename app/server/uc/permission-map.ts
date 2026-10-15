import type { Request } from 'express';
import { authHeaders } from '../lib/auth.js';
import { executeStatement, sqlLiteral, workspaceHost } from '../lib/statement-execution.js';
import {
  accessLevel,
  privilegeAppliesTo,
  grantKey,
  type AccessLevel,
  type AssetCategory,
} from './access-level.js';

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
  catalog: string;
  principal: string;
  truncated: boolean;
  errors: string[];
  categories: Record<AssetCategory, MappedAsset[]>;
};

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
  catalog: string,
  principal: string,
): Promise<PermissionMap> {
  if (!IDENTIFIER.test(catalog)) {
    throw new Error('catalog must contain only letters, numbers, underscores, or hyphens');
  }
  const trimmedPrincipal = principal.trim();
  if (!trimmedPrincipal) throw new Error('principal is required');

  const errors: string[] = [];
  const catalogGrants = await getEffective(req, 'catalog', catalog, trimmedPrincipal);

  const conveying = new Set<string>([trimmedPrincipal]);
  for (const grant of catalogGrants) conveying.add(grant.conveyedBy);

  const [schemas, tables, volumes, functions, sqlGrants] = await Promise.all([
    listSchemas(req, catalog),
    listTables(req, catalog),
    listOptional(req, catalog, 'volume', errors),
    listOptional(req, catalog, 'function', errors),
    listDirectGrants(req, catalog, [...conveying], errors),
  ]);

  const truncated =
    schemas.length >= SCHEMA_LIMIT || tables.length >= TABLE_LIMIT;

  const byObject = new Map<string, PrivilegeGrant[]>();
  const add = (fullName: string, grant: PrivilegeGrant, category: AssetCategory) => {
    if (category !== 'catalog' && !privilegeAppliesTo(grant.privilege, category)) return;
    const list = byObject.get(fullName) ?? [];
    const key = grantKey(
      grant.privilege,
      grant.conveyedBy,
      grant.inheritedFromType,
      grant.inheritedFromName,
    );
    if (list.some((item) => grantKey(item.privilege, item.conveyedBy, item.inheritedFromType, item.inheritedFromName) === key)) {
      return;
    }
    list.push(grant);
    byObject.set(fullName, list);
  };

  for (const grant of catalogGrants) {
    add(catalog, grant, 'catalog');
    for (const schema of schemas) {
      if (privilegeAppliesTo(grant.privilege, 'schema')) {
        add(schema.fullName, inherit(grant, 'CATALOG', catalog), 'schema');
      }
    }
    for (const table of tables) {
      if (privilegeAppliesTo(grant.privilege, 'table')) {
        add(table.fullName, inherit(grant, 'CATALOG', catalog), 'table');
      }
    }
    for (const volume of volumes) {
      if (privilegeAppliesTo(grant.privilege, 'volume')) {
        add(volume.fullName, inherit(grant, 'CATALOG', catalog), 'volume');
      }
    }
    for (const fn of functions) {
      if (privilegeAppliesTo(grant.privilege, 'function')) {
        add(fn.fullName, inherit(grant, 'CATALOG', catalog), 'function');
      }
    }
  }

  for (const row of sqlGrants) {
    add(row.fullName, row.grant, row.category);
    if (row.category === 'schema') {
      for (const table of tables) {
        if (table.schemaFullName !== row.fullName) continue;
        if (privilegeAppliesTo(row.grant.privilege, 'table')) {
          add(table.fullName, inherit(row.grant, 'SCHEMA', row.fullName), 'table');
        }
      }
      for (const volume of volumes) {
        if (volume.schemaFullName !== row.fullName) continue;
        if (privilegeAppliesTo(row.grant.privilege, 'volume')) {
          add(volume.fullName, inherit(row.grant, 'SCHEMA', row.fullName), 'volume');
        }
      }
      for (const fn of functions) {
        if (fn.schemaFullName !== row.fullName) continue;
        if (privilegeAppliesTo(row.grant.privilege, 'function')) {
          add(fn.fullName, inherit(row.grant, 'SCHEMA', row.fullName), 'function');
        }
      }
    }
  }

  const catalogAsset = materialize(catalog, 'catalog', catalog, catalog, null, byObject);
  const categories: PermissionMap['categories'] = {
    catalog: catalogAsset ? [catalogAsset] : [],
    schema: schemas
      .map((schema) =>
        materialize(schema.fullName, 'schema', schema.name, schema.fullName, null, byObject),
      )
      .filter((asset): asset is MappedAsset => asset !== null),
    table: tables
      .map((table) =>
        materialize(table.fullName, 'table', table.name, table.fullName, table.tableType, byObject),
      )
      .filter((asset): asset is MappedAsset => asset !== null),
    volume: volumes
      .map((volume) =>
        materialize(volume.fullName, 'volume', volume.name, volume.fullName, volume.tableType, byObject),
      )
      .filter((asset): asset is MappedAsset => asset !== null),
    function: functions
      .map((fn) =>
        materialize(fn.fullName, 'function', fn.name, fn.fullName, fn.tableType, byObject),
      )
      .filter((asset): asset is MappedAsset => asset !== null),
  };

  return { catalog, principal: trimmedPrincipal, truncated, errors, categories };
}

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

function materialize(
  fullName: string,
  category: AssetCategory,
  name: string,
  id: string,
  tableType: string | null,
  byObject: Map<string, PrivilegeGrant[]>,
): MappedAsset | null {
  const privileges = byObject.get(fullName);
  if (!privileges?.length) return null;
  return {
    category,
    securableType: category,
    fullName: id,
    name,
    tableType,
    privileges: privileges.sort((a, b) => a.privilege.localeCompare(b.privilege)),
    accessLevel: accessLevel(privileges.map((grant) => grant.privilege)),
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
  catalog: string,
  principals: string[],
  errors: string[],
): Promise<SqlGrant[]> {
  if (!principals.length) return [];
  const inList = principals.map((principal) => `'${sqlLiteral(principal)}'`).join(', ');
  const grants: SqlGrant[] = [];
  const queries: Array<{ sql: string; parse: (row: unknown[]) => SqlGrant | null }> = [
    {
      sql: `SELECT schema_name, privilege_type, inherited_from, grantee
              FROM system.information_schema.schema_privileges
             WHERE catalog_name = '${sqlLiteral(catalog)}'
               AND grantee IN (${inList})`,
      parse: (row) => sqlGrant('schema', `${catalog}.${row[0]}`, row),
    },
    {
      sql: `SELECT table_schema, table_name, privilege_type, inherited_from, grantee
              FROM system.information_schema.table_privileges
             WHERE table_catalog = '${sqlLiteral(catalog)}'
               AND grantee IN (${inList})`,
      parse: (row) => sqlGrant('table', `${catalog}.${row[0]}.${row[1]}`, row, 2),
    },
    {
      sql: `SELECT volume_schema, volume_name, privilege_type, inherited_from, grantee
              FROM system.information_schema.volume_privileges
             WHERE volume_catalog = '${sqlLiteral(catalog)}'
               AND grantee IN (${inList})`,
      parse: (row) => sqlGrant('volume', `${catalog}.${row[0]}.${row[1]}`, row, 2),
    },
    {
      sql: `SELECT routine_schema, routine_name, privilege_type, inherited_from, grantee
              FROM system.information_schema.routine_privileges
             WHERE routine_catalog = '${sqlLiteral(catalog)}'
               AND grantee IN (${inList})`,
      parse: (row) => sqlGrant('function', `${catalog}.${row[0]}.${row[1]}`, row, 2),
    },
  ];

  for (const query of queries) {
    try {
      const rows = await executeStatement(req, query.sql);
      for (const row of rows) {
        const parsed = query.parse(row);
        if (parsed) grants.push(parsed);
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  return grants;
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

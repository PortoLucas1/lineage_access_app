import type { Application, Request, Response } from 'express';
import { authHeaders } from '../lib/auth.js';

type StatementResponse = {
  statement_id: string;
  status: {
    state: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELED' | 'CLOSED';
    error?: { message?: string };
  };
  result?: {
    data_array?: unknown[][];
  };
};

const DEFAULT_CATALOG = 'porto_catalog';
const DEFAULT_SCHEMA = 'dbdemos_pipeline_bike';
const IDENTIFIER = /^[A-Za-z0-9_-]+$/;

function workspaceHost(): string {
  const raw = (process.env.DATABRICKS_HOST ?? '').replace(/\/+$/, '');
  if (!raw) throw new Error('DATABRICKS_HOST is not configured');
  return raw.startsWith('http') ? raw : `https://${raw}`;
}

function strParam(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function requireIdentifier(value: unknown, label: string): string {
  const parsed = strParam(value);
  if (!parsed || !IDENTIFIER.test(parsed)) {
    throw new Error(`${label} must contain only letters, numbers, underscores, or hyphens`);
  }
  return parsed;
}

function sqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

async function executeSql(req: Request, statement: string): Promise<unknown[][]> {
  const warehouseId = process.env.DATABRICKS_WAREHOUSE_ID;
  if (!warehouseId) throw new Error('DATABRICKS_WAREHOUSE_ID is not configured');

  const headers = await authHeaders(req);
  headers.set('Content-Type', 'application/json');
  const host = workspaceHost();
  const response = await fetch(`${host}/api/2.0/sql/statements`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      warehouse_id: warehouseId,
      statement,
      wait_timeout: '30s',
      on_wait_timeout: 'CONTINUE',
      disposition: 'INLINE',
      format: 'JSON_ARRAY',
    }),
  });
  if (!response.ok) {
    throw new Error(`Statement Execution API returned ${response.status}: ${await response.text()}`);
  }

  let body = (await response.json()) as StatementResponse;
  const deadline = Date.now() + 60_000;
  while (body.status.state === 'PENDING' || body.status.state === 'RUNNING') {
    if (Date.now() >= deadline) throw new Error('Unity Catalog query timed out');
    await new Promise((resolve) => setTimeout(resolve, 500));
    const poll = await fetch(
      `${host}/api/2.0/sql/statements/${encodeURIComponent(body.statement_id)}`,
      { headers },
    );
    if (!poll.ok) {
      throw new Error(`Statement status returned ${poll.status}: ${await poll.text()}`);
    }
    body = (await poll.json()) as StatementResponse;
  }

  if (body.status.state !== 'SUCCEEDED') {
    throw new Error(body.status.error?.message ?? `Unity Catalog query ${body.status.state}`);
  }
  return body.result?.data_array ?? [];
}

function routeError(res: Response, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  res.status(502).json({ error: message });
}

export function registerUnityCatalogRoutes(app: Application): void {
  app.get('/api/uc/catalogs', async (req, res) => {
    try {
      const query = sqlLiteral(strParam(req.query.q).toLowerCase());
      const where = query ? `WHERE LOWER(catalog_name) LIKE '%${query}%'` : '';
      const rows = await executeSql(
        req,
        `SELECT catalog_name, catalog_owner, comment
           FROM system.information_schema.catalogs
           ${where}
          ORDER BY CASE WHEN catalog_name = '${DEFAULT_CATALOG}' THEN 0 ELSE 1 END,
                   catalog_name
          LIMIT 100`,
      );
      res.json(
        rows.map(([name, owner, comment]) => ({
          name: String(name),
          owner: owner == null ? null : String(owner),
          comment: comment == null ? null : String(comment),
        })),
      );
    } catch (error) {
      routeError(res, error);
    }
  });

  app.get('/api/uc/schemas', async (req, res) => {
    try {
      const catalog = requireIdentifier(req.query.catalog, 'catalog');
      const rows = await executeSql(
        req,
        `SELECT catalog_name, schema_name, schema_owner, comment
           FROM system.information_schema.schemata
          WHERE catalog_name = '${sqlLiteral(catalog)}'
            AND schema_name <> 'information_schema'
          ORDER BY CASE WHEN schema_name = '${DEFAULT_SCHEMA}' THEN 0 ELSE 1 END,
                   schema_name
          LIMIT 500`,
      );
      res.json(
        rows.map(([catalogName, name, owner, comment]) => ({
          catalogName: String(catalogName),
          name: String(name),
          fullName: `${String(catalogName)}.${String(name)}`,
          owner: owner == null ? null : String(owner),
          comment: comment == null ? null : String(comment),
        })),
      );
    } catch (error) {
      routeError(res, error);
    }
  });

  app.get('/api/uc/assets', async (req, res) => {
    try {
      const catalog = requireIdentifier(req.query.catalog, 'catalog');
      const schema = requireIdentifier(req.query.schema, 'schema');
      const rows = await executeSql(
        req,
        `SELECT table_catalog, table_schema, table_name, table_type, table_owner, comment
           FROM system.information_schema.tables
          WHERE table_catalog = '${sqlLiteral(catalog)}'
            AND table_schema = '${sqlLiteral(schema)}'
            AND NOT STARTSWITH(table_name, '__materialization')
          ORDER BY table_name
          LIMIT 1000`,
      );
      res.json(rows.map(toAsset));
    } catch (error) {
      routeError(res, error);
    }
  });

  app.get('/api/uc/search', async (req, res) => {
    try {
      const query = sqlLiteral(strParam(req.query.q).toLowerCase());
      if (query.length < 2) {
        res.json([]);
        return;
      }
      const catalog = req.query.catalog
        ? requireIdentifier(req.query.catalog, 'catalog')
        : DEFAULT_CATALOG;
      const schema = req.query.schema
        ? requireIdentifier(req.query.schema, 'schema')
        : DEFAULT_SCHEMA;
      const scopedRows = await executeSql(
        req,
        `SELECT table_catalog, table_schema, table_name, table_type, table_owner, comment
           FROM system.information_schema.tables
          WHERE table_catalog = '${sqlLiteral(catalog)}'
            AND table_schema = '${sqlLiteral(schema)}'
            AND NOT STARTSWITH(table_name, '__materialization')
            AND LOWER(table_name) LIKE '%${query}%'
          ORDER BY table_name
          LIMIT 50`,
      );
      if (scopedRows.length) {
        res.json(scopedRows.map(toAsset));
        return;
      }

      const globalRows = await executeSql(
        req,
        `SELECT table_catalog, table_schema, table_name, table_type, table_owner, comment
           FROM system.information_schema.tables
          WHERE NOT STARTSWITH(table_name, '__materialization')
            AND LOWER(CONCAT(table_catalog, '.', table_schema, '.', table_name))
                LIKE '%${query}%'
          ORDER BY CASE
                     WHEN table_catalog = '${DEFAULT_CATALOG}'
                      AND table_schema = '${DEFAULT_SCHEMA}' THEN 0
                     ELSE 1
                   END,
                   table_catalog, table_schema, table_name
          LIMIT 50`,
      );
      res.json(globalRows.map(toAsset));
    } catch (error) {
      routeError(res, error);
    }
  });
}

function toAsset(row: unknown[]) {
  const [catalogName, schemaName, name, tableType, owner, comment] = row;
  return {
    catalogName: String(catalogName),
    schemaName: String(schemaName),
    name: String(name),
    fullName: `${String(catalogName)}.${String(schemaName)}.${String(name)}`,
    tableType: String(tableType),
    owner: owner == null ? null : String(owner),
    comment: comment == null ? null : String(comment),
  };
}

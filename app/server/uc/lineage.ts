import type { Request } from 'express';
import { executeStatement, sqlLiteral } from '../lib/statement-execution.js';
import type {
  AssetRow,
  ColumnLineage,
  EdgeRow,
  LineageKpis,
  LineageNeighborhood,
} from '../db/queries/lineage.js';

const FQN_PATTERN = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/;

export function isUcFullName(value: string): boolean {
  return FQN_PATTERN.test(value);
}

function parseFullName(value: string): {
  catalog: string;
  schema: string;
  name: string;
} {
  const match = FQN_PATTERN.exec(value);
  if (!match) throw new Error('Unity Catalog asset id must be catalog.schema.table');
  return { catalog: match[1], schema: match[2], name: match[3] };
}

export async function getUcAsset(req: Request, fullName: string): Promise<AssetRow | null> {
  const { catalog, schema, name } = parseFullName(fullName);
  const rows = await executeStatement(
    req,
    `SELECT table_catalog, table_schema, table_name, table_type, table_owner
       FROM system.information_schema.tables
      WHERE table_catalog = '${sqlLiteral(catalog)}'
        AND table_schema = '${sqlLiteral(schema)}'
        AND table_name = '${sqlLiteral(name)}'
      LIMIT 1`,
  );
  return rows[0] ? assetFromMetadata(rows[0]) : null;
}

export async function getUcLineageNeighborhood(
  req: Request,
  seedId: string,
  hops = 2,
): Promise<LineageNeighborhood> {
  const seedParts = parseFullName(seedId);
  const schemaPrefix = `${seedParts.catalog}.${seedParts.schema}.`;
  const [edgeRows, metadataRows] = await Promise.all([
    executeStatement(
      req,
      `SELECT source_table_full_name, target_table_full_name, MAX(event_time) AS latest_event
         FROM system.access.table_lineage
        WHERE source_table_full_name IS NOT NULL
          AND target_table_full_name IS NOT NULL
          AND (
            STARTSWITH(source_table_full_name, '${sqlLiteral(schemaPrefix)}')
            OR STARTSWITH(target_table_full_name, '${sqlLiteral(schemaPrefix)}')
          )
        GROUP BY source_table_full_name, target_table_full_name`,
    ),
    executeStatement(
      req,
      `SELECT table_catalog, table_schema, table_name, table_type, table_owner
         FROM system.information_schema.tables
        WHERE table_catalog = '${sqlLiteral(seedParts.catalog)}'
          AND table_schema = '${sqlLiteral(seedParts.schema)}'
          AND NOT STARTSWITH(table_name, '__materialization')`,
    ),
  ]);

  const allEdges: EdgeRow[] = edgeRows.map(([source, target, latest]) => {
    const sourceId = String(source);
    const targetId = String(target);
    const createdDate = latest == null ? null : String(latest).slice(0, 10);
    return {
      id: `${sourceId}->${targetId}`,
      sourceAssetId: sourceId,
      sourceAssetName: leafName(sourceId),
      sourceAssetType: null,
      sourceHasPii: false,
      targetAssetId: targetId,
      targetAssetName: leafName(targetId),
      targetAssetType: null,
      targetCriticality: null,
      edgeType: 'derived_from',
      createdDate,
      isNewFromMv: isWithinDays(createdDate, 30),
    };
  });

  const { visited, edges } = neighborhood(seedId, allEdges, hops);
  const metadata = new Map(metadataRows.map((row) => {
    const asset = assetFromMetadata(row);
    return [asset.id, asset];
  }));
  const directDownstream = new Map<string, number>();
  const latestByAsset = new Map<string, string>();
  for (const edge of allEdges) {
    directDownstream.set(
      edge.sourceAssetId,
      (directDownstream.get(edge.sourceAssetId) ?? 0) + 1,
    );
    if (edge.createdDate) {
      for (const id of [edge.sourceAssetId, edge.targetAssetId]) {
        if (!latestByAsset.get(id) || edge.createdDate > latestByAsset.get(id)!) {
          latestByAsset.set(id, edge.createdDate);
        }
      }
    }
  }

  const assets = [...visited].map((id) => {
    const asset = metadata.get(id) ?? fallbackAsset(id);
    return {
      ...asset,
      downstreamCount: directDownstream.get(id) ?? 0,
      lastRefreshed: latestByAsset.get(id) ?? asset.lastRefreshed,
    };
  });

  return {
    seed: assets.find((asset) => asset.id === seedId) ?? null,
    assets,
    edges,
  };
}

export async function getUcKpis(
  req: Request,
  seedId: string,
  _hops = 2,
): Promise<LineageKpis> {
  const { catalog, schema } = parseFullName(seedId);
  const prefix = `${catalog}.${schema}.`;
  const rows = await executeStatement(
    req,
    `SELECT
       (SELECT COUNT(*)
          FROM system.information_schema.tables
         WHERE table_catalog = '${sqlLiteral(catalog)}'
           AND table_schema = '${sqlLiteral(schema)}'
           AND NOT STARTSWITH(table_name, '__materialization')) AS governed_assets,
       (SELECT COUNT(*)
          FROM (
            SELECT source_table_full_name, target_table_full_name
              FROM system.access.table_lineage
             WHERE event_date >= CURRENT_DATE() - INTERVAL 30 DAYS
               AND source_table_full_name IS NOT NULL
               AND target_table_full_name IS NOT NULL
               AND (
                 STARTSWITH(source_table_full_name, '${sqlLiteral(prefix)}')
                 OR STARTSWITH(target_table_full_name, '${sqlLiteral(prefix)}')
               )
             GROUP BY source_table_full_name, target_table_full_name
          )) AS new_edges_30d`,
  );
  const [governedAssets, newEdges30d] = rows[0] ?? [0, 0];
  return {
    governedAssets: Number(governedAssets ?? 0),
    newEdges30d: Number(newEdges30d ?? 0),
    piiPrincipals: 0,
  };
}

export async function getUcColumnLineage(
  req: Request,
  assetId: string,
): Promise<ColumnLineage> {
  const { catalog, schema, name } = parseFullName(assetId);
  const [columnRows, edgeRows] = await Promise.all([
    executeStatement(
      req,
      `SELECT column_name, data_type, ordinal_position
         FROM system.information_schema.columns
        WHERE table_catalog = '${sqlLiteral(catalog)}'
          AND table_schema = '${sqlLiteral(schema)}'
          AND table_name = '${sqlLiteral(name)}'
        ORDER BY ordinal_position`,
    ),
    executeStatement(
      req,
      `SELECT source_table_full_name, source_column_name,
              target_table_full_name, target_column_name
         FROM system.access.column_lineage
        WHERE source_table_full_name = '${sqlLiteral(assetId)}'
           OR target_table_full_name = '${sqlLiteral(assetId)}'
        GROUP BY source_table_full_name, source_column_name,
                 target_table_full_name, target_column_name`,
    ),
  ]);

  const columns = columnRows.map(([columnName, dataType, ordinal]) => ({
    assetId,
    columnName: String(columnName),
    dataType: dataType == null ? null : String(dataType),
    isPii: false,
    ordinal: Number(ordinal ?? 0),
  }));
  const edges = edgeRows
    .filter(([sourceAsset, sourceColumn, targetAsset, targetColumn]) =>
      Boolean(sourceAsset && sourceColumn && targetAsset && targetColumn),
    )
    .map(([sourceAsset, sourceColumn, targetAsset, targetColumn]) => ({
      id: `${String(sourceAsset)}:${String(sourceColumn)}->${String(targetAsset)}:${String(targetColumn)}`,
      sourceAssetId: String(sourceAsset),
      sourceColumn: String(sourceColumn),
      targetAssetId: String(targetAsset),
      targetColumn: String(targetColumn),
      transform: null,
    }));

  const ownColumnNames = new Set(columns.map((column) => column.columnName));
  const neighborColumns = new Map<string, ColumnLineage['neighborColumns'][number]>();
  for (const edge of edges) {
    if (edge.sourceAssetId !== assetId) {
      const key = `${edge.sourceAssetId}:${edge.sourceColumn}`;
      neighborColumns.set(key, {
        assetId: edge.sourceAssetId,
        columnName: edge.sourceColumn,
        dataType: null,
        isPii: false,
        ordinal: 0,
      });
    }
    if (edge.targetAssetId !== assetId) {
      const key = `${edge.targetAssetId}:${edge.targetColumn}`;
      neighborColumns.set(key, {
        assetId: edge.targetAssetId,
        columnName: edge.targetColumn,
        dataType: null,
        isPii: false,
        ordinal: 0,
      });
    }
  }

  return {
    assetId,
    columns: columns.filter((column) => ownColumnNames.has(column.columnName)),
    edges,
    neighborColumns: [...neighborColumns.values()],
  };
}

function assetFromMetadata(row: unknown[]): AssetRow {
  const [catalog, schema, name, tableType, owner] = row;
  const fullName = `${String(catalog)}.${String(schema)}.${String(name)}`;
  return {
    id: fullName,
    assetName: String(name),
    assetType: normalizeAssetType(String(tableType)),
    platform: 'Databricks',
    catalog: String(catalog),
    schema: String(schema),
    domain: null,
    criticality: null,
    hasPii: false,
    ownerEmail: owner == null ? null : String(owner),
    createdDate: null,
    lastRefreshed: null,
    downstreamCount: 0,
    principalsWithAccess: 0,
    hasOverBroadGrant: false,
  };
}

function fallbackAsset(fullName: string): AssetRow {
  const parsed = parseFullName(fullName);
  return assetFromMetadata([
    parsed.catalog,
    parsed.schema,
    parsed.name,
    'TABLE',
    null,
  ]);
}

function normalizeAssetType(tableType: string): string {
  const normalized = tableType.toUpperCase().replace(/ /g, '_');
  if (normalized === 'STREAMING_TABLE' || normalized === 'STREAMING_LIVE_TABLE') {
    return 'streaming_table';
  }
  if (normalized === 'MATERIALIZED_VIEW') return 'materialized_view';
  if (normalized === 'METRIC_VIEW') return 'metric_view';
  if (normalized === 'VIEW') return 'view';
  if (normalized === 'EXTERNAL') return 'external';
  if (normalized === 'FOREIGN') return 'foreign';
  return 'table';
}

function leafName(fullName: string): string {
  const parts = fullName.split('.');
  return parts[parts.length - 1] ?? fullName;
}

function isWithinDays(date: string | null, days: number): boolean {
  if (!date) return false;
  const timestamp = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(timestamp) && timestamp >= Date.now() - days * 86_400_000;
}

function neighborhood(seedId: string, allEdges: EdgeRow[], hops: number) {
  const incident = new Map<string, EdgeRow[]>();
  for (const edge of allEdges) {
    incident.set(edge.sourceAssetId, [...(incident.get(edge.sourceAssetId) ?? []), edge]);
    incident.set(edge.targetAssetId, [...(incident.get(edge.targetAssetId) ?? []), edge]);
  }

  let frontier = new Set([seedId]);
  const visited = new Set([seedId]);
  const edges: EdgeRow[] = [];
  const seenEdges = new Set<string>();
  for (let hop = 0; hop < hops && frontier.size; hop += 1) {
    const next = new Set<string>();
    for (const id of frontier) {
      for (const edge of incident.get(id) ?? []) {
        if (!seenEdges.has(edge.id)) {
          seenEdges.add(edge.id);
          edges.push(edge);
        }
        for (const neighbor of [edge.sourceAssetId, edge.targetAssetId]) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            next.add(neighbor);
          }
        }
      }
    }
    frontier = next;
  }
  return { visited, edges };
}

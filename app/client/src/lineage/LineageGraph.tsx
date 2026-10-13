/**
 * Lineage graph — the hero visualization, styled after the Unity Catalog
 * lineage tab: clean white asset cards laid out left→right (upstream sources →
 * selected asset → downstream consumers) on a dot-grid canvas, joined by smooth
 * connectors that dock into left/right ports on each card.
 *
 * Each card carries a type-colored icon chip, the asset name, its type label,
 * and its catalog.schema path — plus PII / $ chips. Edges created
 * in the MV window (isNewFromMv) render in the accent orange (the "new
 * fan-out"); baseline edges are a muted grey. Clicking a card selects it.
 *
 * Layout = signed BFS distance from the seed (upstream negative, downstream
 * positive); nodes in a column stack vertically, centered.
 */
import { createElement, useCallback, useMemo, useState } from 'react';
import { ChevronRight, LoaderCircle, Maximize2, Minimize2 } from 'lucide-react';
import { fetchColumnLineage } from '@/lib/lineage';
import type { AssetRow, ColumnLineage, ColumnRow, EdgeRow } from '@/shared/types';
import { assetTypeColor, assetTypeIcon, assetTypeLabel } from './assetVisuals';

const NODE_W = 208;
const EXPANDED_NODE_W = 248;
const NODE_HEADER_H = 62;
const COLUMN_ROW_H = 24;
const COLUMN_PAD_Y = 7;
const COL_GAP = 120;
const ROW_GAP = 28;
const PAD = 40;

const EDGE_NEW = '#FE9000'; // orange — new-from-MV fan-out
const EDGE_BASE = '#9AA6B2'; // muted grey — baseline lineage

type Positioned = AssetRow & {
  col: number;
  row: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export function LineageGraph({
  seedId,
  selectedId,
  assets,
  edges,
  onSelect,
}: {
  seedId: string;
  selectedId: string | null;
  assets: AssetRow[];
  edges: EdgeRow[];
  /** Click a node card → re-scope the graph to that object's lineage. */
  onSelect: (id: string) => void;
}) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [expandedEdgeId, setExpandedEdgeId] = useState<string | null>(null);
  const [columnData, setColumnData] = useState<Record<string, ColumnLineage>>({});
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());

  const ensureColumns = useCallback(
    async (id: string) => {
      if (columnData[id] || loadingIds.has(id)) return;
      setLoadingIds((current) => new Set(current).add(id));
      try {
        const data = await fetchColumnLineage(id);
        setColumnData((current) => ({ ...current, [id]: data }));
      } catch (error) {
        console.error(`[lineage] columns load failed for ${id}`, error);
      } finally {
        setLoadingIds((current) => {
          const next = new Set(current);
          next.delete(id);
          return next;
        });
      }
    },
    [columnData, loadingIds],
  );

  const toggleNodeColumns = (id: string) => {
    const willExpand = !expandedIds.has(id);
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    if (willExpand) void ensureColumns(id);
    else {
      const edge = edges.find((candidate) => candidate.id === expandedEdgeId);
      if (edge && (edge.sourceAssetId === id || edge.targetAssetId === id)) {
        setExpandedEdgeId(null);
      }
    }
  };

  const toggleEdgeColumns = (edge: EdgeRow) => {
    if (expandedEdgeId === edge.id) {
      setExpandedEdgeId(null);
      return;
    }
    setExpandedEdgeId(edge.id);
    setExpandedIds((current) => {
      const next = new Set(current);
      next.add(edge.sourceAssetId);
      next.add(edge.targetAssetId);
      return next;
    });
    void Promise.all([
      ensureColumns(edge.sourceAssetId),
      ensureColumns(edge.targetAssetId),
    ]);
  };

  const { nodes, width, height, nodeById } = useMemo(
    () => layout(seedId, assets, edges, expandedIds, columnData),
    [seedId, assets, edges, expandedIds, columnData],
  );

  const expandedColumnEdges = useMemo(() => {
    if (!expandedEdgeId) return [];
    const edge = edges.find((candidate) => candidate.id === expandedEdgeId);
    if (!edge) return [];
    return (columnData[edge.sourceAssetId]?.edges ?? []).filter(
      (columnEdge) =>
        columnEdge.sourceAssetId === edge.sourceAssetId &&
        columnEdge.targetAssetId === edge.targetAssetId,
    );
  }, [expandedEdgeId, edges, columnData]);

  if (assets.length === 0) {
    return (
      <div className="flex items-center justify-center h-[420px] text-sm text-muted-foreground">
        No lineage for this asset.
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 overflow-hidden rounded-xl border border-border bg-[var(--card)]">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMinYMid meet"
        className="block h-auto w-full"
        role="img"
        aria-label="Lineage graph"
      >
        <defs>
          {/* dot-grid background, like the UC lineage canvas */}
          <pattern id="lin-dots" width={22} height={22} patternUnits="userSpaceOnUse">
            <circle cx={1.5} cy={1.5} r={1.2} fill="var(--border)" opacity={0.55} />
          </pattern>
          <marker
            id="arrow-new"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 z" fill={EDGE_NEW} />
          </marker>
          <marker
            id="arrow-base"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 z" fill={EDGE_BASE} />
          </marker>
          <marker
            id="arrow-column"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 z" fill={EDGE_NEW} />
          </marker>
        </defs>

        <rect width={width} height={height} fill="url(#lin-dots)" />

        {/* edges — smooth S-curves docking into card ports */}
        {edges.map((e) => {
          const s = nodeById.get(e.sourceAssetId);
          const t = nodeById.get(e.targetAssetId);
          if (!s || !t) return null;
          const x1 = s.x + s.width;
          const y1 = s.y + NODE_HEADER_H / 2;
          const x2 = t.x;
          const y2 = t.y + NODE_HEADER_H / 2;
          const dx = Math.max(40, Math.abs(x2 - x1) * 0.5);
          const color = e.isNewFromMv ? EDGE_NEW : EDGE_BASE;
          const marker = e.isNewFromMv ? 'url(#arrow-new)' : 'url(#arrow-base)';
          const isExpanded = e.id === expandedEdgeId;
          const midX = (x1 + x2) / 2;
          const midY = (y1 + y2) / 2;
          return (
            <g key={e.id}>
              <path
                d={`M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`}
                fill="none"
                stroke={color}
                strokeWidth={isExpanded ? 3 : e.isNewFromMv ? 2.25 : 1.5}
                strokeOpacity={isExpanded || e.isNewFromMv ? 0.95 : 0.7}
                markerEnd={marker}
              />
              <path
                d={`M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`}
                fill="none"
                stroke="transparent"
                strokeWidth={18}
                style={{ cursor: 'pointer' }}
                onClick={() => toggleEdgeColumns(e)}
              >
                <title>Show column lineage for this connection</title>
              </path>
              {/* source port dot */}
              <circle cx={x1} cy={y1} r={3} fill={color} />
              <g
                transform={`translate(${midX - 10}, ${midY - 10})`}
                style={{ cursor: 'pointer' }}
                onClick={() => toggleEdgeColumns(e)}
              >
                <title>Show column lineage for this connection</title>
                <circle
                  cx={10}
                  cy={10}
                  r={10}
                  fill={isExpanded ? color : '#FFFFFF'}
                  stroke={color}
                  strokeWidth={1.5}
                />
                <foreignObject width={20} height={20}>
                  <div
                    style={{
                      width: 20,
                      height: 20,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: isExpanded ? '#FFFFFF' : color,
                    }}
                  >
                    <ChevronRight size={12} />
                  </div>
                </foreignObject>
              </g>
            </g>
          );
        })}

        {/* Column connectors for the selected object-level edge. */}
        {expandedColumnEdges.map((edge) => {
          const source = nodeById.get(edge.sourceAssetId);
          const target = nodeById.get(edge.targetAssetId);
          const sourceColumns = columnData[edge.sourceAssetId]?.columns ?? [];
          const targetColumns = columnData[edge.targetAssetId]?.columns ?? [];
          const sourceIndex = sourceColumns.findIndex((c) => c.columnName === edge.sourceColumn);
          const targetIndex = targetColumns.findIndex((c) => c.columnName === edge.targetColumn);
          if (!source || !target || sourceIndex < 0 || targetIndex < 0) return null;
          const x1 = source.x + source.width;
          const y1 =
            source.y + NODE_HEADER_H + COLUMN_PAD_Y + (sourceIndex + 0.5) * COLUMN_ROW_H;
          const x2 = target.x;
          const y2 =
            target.y + NODE_HEADER_H + COLUMN_PAD_Y + (targetIndex + 0.5) * COLUMN_ROW_H;
          const dx = Math.max(30, Math.abs(x2 - x1) * 0.48);
          return (
            <path
              key={edge.id}
              d={`M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`}
              fill="none"
              stroke={EDGE_NEW}
              strokeWidth={1.75}
              strokeOpacity={0.9}
              markerEnd="url(#arrow-column)"
            >
              <title>
                {edge.sourceColumn} → {edge.targetColumn}
                {edge.transform ? ` · ${edge.transform}` : ''}
              </title>
            </path>
          );
        })}

        {/* nodes */}
        {nodes.map((n) => (
          <Node
            key={n.id}
            node={n}
            isSeed={n.id === seedId}
            isSelected={n.id === selectedId}
            isExpanded={expandedIds.has(n.id)}
            columns={columnData[n.id]?.columns}
            isLoading={loadingIds.has(n.id)}
            onSelect={onSelect}
            onExpandColumns={toggleNodeColumns}
          />
        ))}
      </svg>
    </div>
  );
}

function Node({
  node,
  isSeed,
  isSelected,
  isExpanded,
  columns,
  isLoading,
  onSelect,
  onExpandColumns,
}: {
  node: Positioned;
  isSeed: boolean;
  isSelected: boolean;
  isExpanded: boolean;
  columns?: ColumnRow[];
  isLoading: boolean;
  onSelect: (id: string) => void;
  onExpandColumns: (id: string) => void;
}) {
  const accent = assetTypeColor(node.assetType);
  const active = isSelected || isSeed;
  const path =
    node.catalog && node.catalog !== '-'
      ? `${node.catalog}.${node.schema}`
      : node.platform && node.platform !== 'Databricks'
        ? node.platform
        : assetTypeLabel(node.assetType);

  return (
    <g
      transform={`translate(${node.x}, ${node.y})`}
      style={{ cursor: 'pointer' }}
      onClick={() => onSelect(node.id)}
    >
      {/* soft drop shadow */}
      <rect
        x={0}
        y={3}
        width={node.width}
        height={node.height}
        rx={12}
        fill="rgba(15,23,42,0.10)"
      />
      {/* card body — white, with a type-colored left rail */}
      <rect
        width={node.width}
        height={node.height}
        rx={12}
        fill="#FFFFFF"
        stroke={active ? accent : 'var(--border)'}
        strokeWidth={active ? 2.5 : 1}
      />
      {/* left accent rail */}
      <path
        d={`M 12 0 H 5 A 5 5 0 0 0 0 5 V ${node.height - 5} A 5 5 0 0 0 5 ${node.height} H 12 Z`}
        fill={accent}
      />

      {/* icon chip */}
      <g transform={`translate(18, ${NODE_HEADER_H / 2 - 15})`}>
        <rect width={30} height={30} rx={8} fill={accent} opacity={0.14} />
        <foreignObject width={30} height={30}>
          <div
            style={{
              width: 30,
              height: 30,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: accent,
            }}
          >
            {createElement(assetTypeIcon(node.assetType), { size: 17 })}
          </div>
        </foreignObject>
      </g>

      {/* name + type + path */}
      <text x={58} y={22} fill="#0F1730" fontSize={12.5} fontWeight={700} fontFamily="var(--font-sans)">
        {truncate(node.assetName, 20)}
      </text>
      <text x={58} y={37} fill={accent} fontSize={9.5} fontWeight={600} fontFamily="var(--font-sans)">
        {assetTypeLabel(node.assetType).toUpperCase()}
      </text>
      <text x={58} y={51} fill="#64748B" fontSize={9} fontFamily="var(--font-sans)">
        {truncate(path, 24)}
      </text>

      {/* chips (top-right): PII · $ */}
      <g transform={`translate(${node.width - 10}, 9)`}>
        {node.hasPii && (
          <Chip x={-34} label="PII" bg="#FDE2E2" fg="#B91C1C" />
        )}
      </g>
      {node.annualValueUsd ? (
        <g transform={`translate(${node.width - 34}, ${NODE_HEADER_H - 22})`}>
          <Chip x={-52} label={compactUsd(node.annualValueUsd)} bg="#FFE8CC" fg="#9A4B00" wide />
        </g>
      ) : null}

      {/* Every generated object carries columns, including Tableau and AI/BI. */}
      <g
        transform={`translate(${node.width - 26}, ${NODE_HEADER_H - 26})`}
        style={{ cursor: 'pointer' }}
        onClick={(e) => {
          e.stopPropagation();
          onExpandColumns(node.id);
        }}
      >
        <title>{isExpanded ? 'Hide columns' : 'Show columns'}</title>
        <rect
          width={20}
          height={20}
          rx={6}
          fill={isExpanded ? accent : '#FFFFFF'}
          stroke={accent}
          strokeWidth={1.25}
        />
        <foreignObject width={20} height={20}>
          <div
            style={{
              width: 20,
              height: 20,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: isExpanded ? '#FFFFFF' : accent,
            }}
          >
            {isLoading ? (
              <LoaderCircle size={11} className="animate-spin" />
            ) : isExpanded ? (
              <Minimize2 size={11} />
            ) : (
              <Maximize2 size={11} />
            )}
          </div>
        </foreignObject>
      </g>

      {isExpanded && (
        <>
          <line
            x1={12}
            x2={node.width}
            y1={NODE_HEADER_H}
            y2={NODE_HEADER_H}
            stroke="var(--border)"
          />
          {isLoading ? (
            <text
              x={22}
              y={NODE_HEADER_H + 23}
              fill="#64748B"
              fontSize={10}
              fontFamily="var(--font-sans)"
            >
              Loading columns…
            </text>
          ) : columns && columns.length > 0 ? (
            columns.map((column, index) => {
              const y = NODE_HEADER_H + COLUMN_PAD_Y + index * COLUMN_ROW_H;
              return (
                <g key={column.columnName}>
                  {index > 0 && (
                    <line
                      x1={12}
                      x2={node.width}
                      y1={y}
                      y2={y}
                      stroke="var(--border)"
                      strokeOpacity={0.55}
                    />
                  )}
                  <circle cx={18} cy={y + COLUMN_ROW_H / 2} r={2.5} fill={accent} />
                  <text
                    x={26}
                    y={y + 15}
                    fill="#0F1730"
                    fontSize={10}
                    fontFamily="var(--font-mono)"
                  >
                    {truncate(column.columnName, 24)}
                  </text>
                  {column.isPii && (
                    <text
                      x={node.width - 57}
                      y={y + 15}
                      fill="#B91C1C"
                      fontSize={8}
                      fontWeight={700}
                    >
                      PII
                    </text>
                  )}
                  <text
                    x={node.width - 9}
                    y={y + 15}
                    fill="#64748B"
                    fontSize={8}
                    textAnchor="end"
                    fontFamily="var(--font-mono)"
                  >
                    {truncate(column.dataType ?? 'unknown', 15)}
                  </text>
                </g>
              );
            })
          ) : (
            <text
              x={22}
              y={NODE_HEADER_H + 23}
              fill="#64748B"
              fontSize={10}
              fontFamily="var(--font-sans)"
            >
              No columns available
            </text>
          )}
        </>
      )}

      {/* connection ports */}
      <circle cx={0} cy={NODE_HEADER_H / 2} r={3} fill="var(--border)" />
      <circle cx={node.width} cy={NODE_HEADER_H / 2} r={3} fill="var(--border)" />
    </g>
  );
}

function Chip({
  x,
  label,
  bg,
  fg,
  wide,
}: {
  x: number;
  label: string;
  bg: string;
  fg: string;
  wide?: boolean;
}) {
  const w = wide ? 46 : 26;
  return (
    <g transform={`translate(${x}, 0)`}>
      <rect width={w} height={14} rx={7} fill={bg} />
      <text x={w / 2} y={10} fill={fg} fontSize={7.5} fontWeight={700} textAnchor="middle">
        {label}
      </text>
    </g>
  );
}

function compactUsd(n: number): string {
  return (
    '$' +
    new Intl.NumberFormat(undefined, {
      notation: 'compact',
      maximumFractionDigits: 0,
    }).format(n)
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// ---------------------------------------------------------------------------
// Layout: signed BFS distance from the seed defines the column. Upstream
// (following edges backward from seed) are negative columns; downstream
// (following edges forward) positive. Nodes not connected to the seed land
// in column 0 alongside the seed (rare; keeps them visible).
// ---------------------------------------------------------------------------
function layout(
  seedId: string,
  assets: AssetRow[],
  edges: EdgeRow[],
  expandedIds: Set<string>,
  columnData: Record<string, ColumnLineage>,
): {
  nodes: Positioned[];
  width: number;
  height: number;
  nodeById: Map<string, Positioned>;
} {
  const forward = new Map<string, string[]>();
  const backward = new Map<string, string[]>();
  for (const e of edges) {
    if (!forward.has(e.sourceAssetId)) forward.set(e.sourceAssetId, []);
    forward.get(e.sourceAssetId)!.push(e.targetAssetId);
    if (!backward.has(e.targetAssetId)) backward.set(e.targetAssetId, []);
    backward.get(e.targetAssetId)!.push(e.sourceAssetId);
  }

  const col = new Map<string, number>();
  col.set(seedId, 0);

  // Downstream BFS (positive columns).
  let frontier = [seedId];
  const seenD = new Set([seedId]);
  while (frontier.length) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const nxt of forward.get(id) ?? []) {
        if (!seenD.has(nxt)) {
          seenD.add(nxt);
          const c = (col.get(id) ?? 0) + 1;
          if (!col.has(nxt) || (col.get(nxt) ?? 0) < c) col.set(nxt, c);
          next.push(nxt);
        }
      }
    }
    frontier = next;
  }

  // Upstream BFS (negative columns).
  frontier = [seedId];
  const seenU = new Set([seedId]);
  while (frontier.length) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const prev of backward.get(id) ?? []) {
        if (!seenU.has(prev)) {
          seenU.add(prev);
          const c = (col.get(id) ?? 0) - 1;
          if (!col.has(prev) || (col.get(prev) ?? 0) > c) col.set(prev, c);
          next.push(prev);
        }
      }
    }
    frontier = next;
  }

  // Any asset not placed → column 0.
  for (const a of assets) if (!col.has(a.id)) col.set(a.id, 0);

  // Group by column, sort within a column (seed centered).
  const byCol = new Map<number, AssetRow[]>();
  for (const a of assets) {
    const c = col.get(a.id) ?? 0;
    if (!byCol.has(c)) byCol.set(c, []);
    byCol.get(c)!.push(a);
  }
  const cols = [...byCol.keys()].sort((a, b) => a - b);
  const nodes: Positioned[] = [];
  const nodeById = new Map<string, Positioned>();
  const dimensions = (asset: AssetRow) => {
    const isExpanded = expandedIds.has(asset.id);
    const columnCount = columnData[asset.id]?.columns.length ?? 1;
    return {
      width: isExpanded ? EXPANDED_NODE_W : NODE_W,
      height: isExpanded
        ? NODE_HEADER_H + COLUMN_PAD_Y * 2 + columnCount * COLUMN_ROW_H
        : NODE_HEADER_H,
    };
  };
  const columnWidths = cols.map((c) =>
    Math.max(...byCol.get(c)!.map((asset) => dimensions(asset).width)),
  );
  const columnHeights = cols.map((c) => {
    const list = byCol.get(c)!;
    return list.reduce((sum, asset) => sum + dimensions(asset).height, 0) +
      Math.max(0, list.length - 1) * ROW_GAP;
  });
  const graphHeight = Math.max(...columnHeights, NODE_HEADER_H);
  let nextX = PAD;

  cols.forEach((c, colIdx) => {
    const list = byCol.get(c)!;
    list.sort((a, b) => a.assetName.localeCompare(b.assetName));
    const x = nextX;
    let nextY = PAD + (graphHeight - columnHeights[colIdx]) / 2;
    list.forEach((a, i) => {
      const { width, height } = dimensions(a);
      const y = nextY;
      const p: Positioned = { ...a, col: c, row: i, x, y, width, height };
      nodes.push(p);
      nodeById.set(a.id, p);
      nextY += height + ROW_GAP;
    });
    nextX += columnWidths[colIdx] + COL_GAP;
  });

  const width = PAD * 2 + columnWidths.reduce((sum, value) => sum + value, 0) +
    Math.max(0, cols.length - 1) * COL_GAP;
  const height = PAD * 2 + graphHeight;
  return { nodes, width: Math.max(width, 720), height: Math.max(height, 380), nodeById };
}

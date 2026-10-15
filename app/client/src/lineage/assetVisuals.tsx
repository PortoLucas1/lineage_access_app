/**
 * Visual vocabulary for the lineage graph — one icon per asset_type, one
 * color per criticality, plus PII / $ badges. Kept in one file so the graph,
 * drawer, and access panel all read the same way.
 */
import {
  Table2,
  Eye,
  BarChart3,
  PanelsTopLeft,
  Workflow,
  NotebookPen,
  Bot,
  type LucideIcon,
} from 'lucide-react';
import { UcAssetIcon } from './ucIcons';

export type Criticality = 'high' | 'medium' | 'low' | string | null;

// Criticality → node color (spec: high #094074 / medium #5ADBFF / low #FFDD4A).
export function criticalityColor(c: Criticality): string {
  switch (c) {
    case 'high':
      return '#094074';
    case 'medium':
      return '#5ADBFF';
    case 'low':
      return '#FFDD4A';
    default:
      return '#5B6573';
  }
}

// High criticality is a dark fill → needs light text; medium/low are light.
export function criticalityTextColor(c: Criticality): string {
  return c === 'high' ? '#FFFFFF' : '#1F2530';
}

// Per-asset-type accent color — used for the icon chip + left rail on the
// Unity-Catalog-style node cards. Distinct hue per type so the graph reads at
// a glance (table = navy, MV = orange = the catalyst, Tableau = teal, etc.).
export function assetTypeColor(type: string): string {
  switch (normalizeGraphAssetType(type)) {
    case 'table':
      return 'var(--asset-table)';
    case 'streaming_table':
      return '#0284C7';
    case 'materialized_view':
      return '#FE9000';
    case 'view':
    case 'metric_view':
      return 'var(--asset-view)';
    case 'external':
    case 'foreign':
      return '#0F766E';
    case 'dbsql_dashboard':
      return '#2E8B9E';
    case 'tableau_dashboard':
      return '#0E7490';
    case 'workflow':
      return '#B7791F';
    case 'notebook':
      return '#6B7280';
    case 'agent':
      return '#7C3AED';
    default:
      return '#5B6573';
  }
}

export function assetTypeIcon(type: string): LucideIcon {
  switch (normalizeGraphAssetType(type)) {
    case 'view':
    case 'metric_view':
      return Eye;
    case 'dbsql_dashboard':
      return BarChart3;
    case 'tableau_dashboard':
      return PanelsTopLeft;
    case 'workflow':
      return Workflow;
    case 'notebook':
      return NotebookPen;
    case 'agent':
      return Bot;
    default:
      return Table2;
  }
}

export function AssetTypeGlyph({ type, size = 17 }: { type: string; size?: number }) {
  const ucTableType = toUcTableType(type);
  if (ucTableType) {
    return <UcAssetIcon tableType={ucTableType} width={size} height={size} />;
  }
  const Icon = assetTypeIcon(type);
  return <Icon size={size} />;
}

export function assetTypeLabel(type: string): string {
  switch (normalizeGraphAssetType(type)) {
    case 'streaming_table':
      return 'Streaming Table';
    case 'materialized_view':
      return 'Materialized View';
    case 'metric_view':
      return 'Metric View';
    case 'external':
      return 'External Table';
    case 'foreign':
      return 'Foreign Table';
    case 'dbsql_dashboard':
      return 'AI/BI Dashboard';
    case 'tableau_dashboard':
      return 'Tableau Dashboard';
    case 'table':
      return 'Table';
    case 'view':
      return 'View';
    case 'workflow':
      return 'Workflow';
    case 'notebook':
      return 'Notebook';
    case 'agent':
      return 'Agent';
    default:
      return type.replaceAll('_', ' ');
  }
}

function normalizeGraphAssetType(type: string): string {
  return type.toLowerCase().replace(/ /g, '_');
}

function toUcTableType(type: string): string | null {
  switch (normalizeGraphAssetType(type)) {
    case 'table':
    case 'managed':
      return 'MANAGED';
    case 'streaming_table':
    case 'streaming_live_table':
      return 'STREAMING_TABLE';
    case 'materialized_view':
      return 'MATERIALIZED_VIEW';
    case 'view':
      return 'VIEW';
    case 'metric_view':
      return 'METRIC_VIEW';
    case 'external':
      return 'EXTERNAL';
    case 'foreign':
      return 'FOREIGN';
    default:
      return null;
  }
}

export function isTableau(type: string): boolean {
  return type === 'tableau_dashboard';
}

/**
 * Visual vocabulary for the lineage graph — one icon per asset_type, one
 * color per criticality, plus PII / $ badges. Kept in one file so the graph,
 * drawer, and access panel all read the same way.
 */
import {
  Table2,
  Layers,
  Eye,
  BarChart3,
  PanelsTopLeft,
  Workflow,
  NotebookPen,
  Bot,
  type LucideIcon,
} from 'lucide-react';

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
  switch (type) {
    case 'table':
      return '#094074';
    case 'materialized_view':
      return '#FE9000';
    case 'view':
      return '#3C6997';
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
  switch (type) {
    case 'table':
      return Table2;
    case 'materialized_view':
      return Layers;
    case 'view':
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

export function assetTypeLabel(type: string): string {
  switch (type) {
    case 'materialized_view':
      return 'Materialized View';
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
      return type;
  }
}

export function isTableau(type: string): boolean {
  return type === 'tableau_dashboard';
}

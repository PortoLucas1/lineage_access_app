/**
 * KPI strip at the top of the Lineage Explorer. Reads live from Lakebase
 * (via /api/lineage/:id/kpis). usePulseOnChange flashes cards whose value
 * moved when dataMutated fires.
 */
import { Boxes, GitBranch, ShieldAlert } from 'lucide-react';
import { usePulseOnChange } from '@/lib/usePulseOnChange';
import type { LineageKpis } from '@/shared/types';

export function KpiCards({ kpis }: { kpis: LineageKpis | null }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-4">
      <Card
        label="Governed Assets"
        value={kpis ? kpis.governedAssets.toLocaleString() : '—'}
        raw={kpis?.governedAssets ?? 0}
        icon={<Boxes className="size-4" />}
        tone="neutral"
      />
      <Card
        label="New Edges (30d)"
        value={kpis ? kpis.newEdges30d.toLocaleString() : '—'}
        raw={kpis?.newEdges30d ?? 0}
        icon={<GitBranch className="size-4" />}
        tone="info"
      />
      <Card
        label="Principals w/ PII Access"
        value={kpis ? kpis.piiPrincipals.toLocaleString() : '—'}
        raw={kpis?.piiPrincipals ?? 0}
        icon={<ShieldAlert className="size-4" />}
        tone="danger"
      />
    </div>
  );
}

function Card({
  label,
  value,
  raw,
  icon,
  tone,
}: {
  label: string;
  value: string;
  raw: number;
  icon: React.ReactNode;
  tone: 'neutral' | 'info' | 'danger';
}) {
  const pulse = usePulseOnChange(raw);
  const toneClass =
    tone === 'danger'
      ? 'text-destructive'
      : tone === 'info'
        ? 'text-[var(--info-subtle-foreground)]'
        : 'text-foreground';
  return (
    <div
      className={`rounded-xl border border-border bg-card p-3 sm:p-5 transition-shadow ${
        pulse ? 'animate-pulse-ring' : ''
      }`}
    >
      <div className="flex items-center gap-1.5 sm:gap-2 text-[10px] sm:text-xs font-semibold uppercase tracking-[0.12em] sm:tracking-[0.15em] text-muted-foreground">
        <span className={toneClass}>{icon}</span>
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-1.5 sm:mt-2 display text-2xl sm:text-3xl font-semibold text-foreground">
        {value}
      </div>
    </div>
  );
}

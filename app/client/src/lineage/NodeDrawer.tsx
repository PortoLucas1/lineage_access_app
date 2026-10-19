/**
 * Node detail drawer — opens when a graph node is clicked. Three tabs:
 *   Overview — asset metadata (type, catalog.schema, domain, criticality,
 *              PII, owner, downstream count, access, and dates).
 *   Access   — the grants on this asset (same shape as the right rail).
 *   Activity — the append-only audit timeline from the grants' auditTrail.
 * Refetches on dataMutated so the agent's writes land live.
 */
import { useEffect, useState } from 'react';
import { Activity, ShieldCheck, Info } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@databricks/appkit-ui/react';
import { fetchAsset, fetchAssetGrants } from '@/lib/lineage';
import { dataMutated } from '@/lib/events';
import type { AssetRow, GrantRow } from '@/shared/types';
import { assetTypeLabel } from './assetVisuals';
import { AccessPanel } from './AccessPanel';

export function NodeDrawer({
  id,
  open,
  onOpenChange,
}: {
  id: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [asset, setAsset] = useState<AssetRow | null>(null);
  const [grants, setGrants] = useState<GrantRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!id) {
      setAsset(null);
      setGrants([]);
      return;
    }
    let alive = true;
    const load = () => {
      setLoading(true);
      Promise.all([fetchAsset(id), fetchAssetGrants(id)])
        .then(([a, g]) => {
          if (!alive) return;
          setAsset(a);
          setGrants(g);
        })
        .catch(() => {})
        .finally(() => alive && setLoading(false));
    };
    load();
    const unsub = dataMutated.subscribe(load);
    return () => {
      alive = false;
      unsub();
    };
  }, [id]);

  const auditItems = grants
    .flatMap((g) =>
      g.auditTrail.map((a) => ({ ...a, grant: g })),
    )
    .sort((a, b) => (a.at < b.at ? 1 : -1));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="!w-full sm:!w-[60vw] sm:!max-w-[60vw] lg:!w-[560px] lg:!max-w-[560px] p-0 flex flex-col"
      >
        <SheetHeader className="px-6 pt-6 pb-4 border-b border-border">
          <div className="flex items-center gap-2 flex-wrap">
            {(asset?.platform === 'Tableau'
              || (asset?.biConnections ?? []).some((item) => item.kind === 'tableau_dashboard')) && (
              <span className="rounded-full bg-[var(--accent)]/15 text-[var(--accent)] px-2 py-0.5 text-[10px] font-semibold">
                Tableau
              </span>
            )}
            {(asset?.assetType === 'dbsql_dashboard'
              || (asset?.biConnections ?? []).some((item) => item.kind === 'dbsql_dashboard')) && (
              <span className="rounded-full bg-sky-100 text-sky-800 px-2 py-0.5 text-[10px] font-semibold">
                AI/BI
              </span>
            )}
            {asset?.hasPii && (
              <span className="rounded-full bg-[var(--destructive)]/12 text-destructive px-2 py-0.5 text-[10px] font-semibold">
                PII
              </span>
            )}
            <span className="font-mono text-xs text-muted-foreground">{asset?.id ?? id}</span>
          </div>
          <SheetTitle className="text-left text-lg">
            {asset?.assetName ?? 'Loading…'}
          </SheetTitle>
          <div className="text-xs text-muted-foreground">
            {asset ? assetTypeLabel(asset.assetType) : ''}
          </div>
        </SheetHeader>

        {loading && !asset && <div className="p-8 text-muted-foreground">Loading…</div>}

        {asset && (
          <Tabs defaultValue="overview" className="flex-1 min-h-0 flex flex-col">
            <TabsList className="mx-6 mt-4">
              <TabsTrigger value="overview">
                <Info className="size-3.5 mr-1" /> Overview
              </TabsTrigger>
              <TabsTrigger value="access">
                <ShieldCheck className="size-3.5 mr-1" /> Access
              </TabsTrigger>
              <TabsTrigger value="activity">
                <Activity className="size-3.5 mr-1" /> Activity
              </TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="flex-1 overflow-y-auto px-6 py-4">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <Field label="Type" value={assetTypeLabel(asset.assetType)} />
                <Field label="Platform" value={asset.platform ?? '—'} />
                <Field
                  label="Location"
                  value={
                    asset.catalog && asset.catalog !== '-'
                      ? `${asset.catalog}.${asset.schema}`
                      : '—'
                  }
                />
                <Field label="Domain" value={asset.domain ?? '—'} />
                <Field label="Criticality" value={asset.criticality ?? '—'} />
                <Field label="Contains PII" value={asset.hasPii ? 'Yes' : 'No'} />
                <Field label="Owner" value={asset.ownerEmail ?? '—'} />
                <Field label="Downstream assets" value={asset.downstreamCount.toLocaleString()} />
                <Field
                  label="Principals w/ access"
                  value={asset.principalsWithAccess.toLocaleString()}
                />
                <Field label="Created" value={asset.createdDate ?? '—'} />
                <Field label="Last refreshed" value={asset.lastRefreshed ?? '—'} />
              </dl>
              {(asset.biConnections ?? []).length > 0 && (
                <div className="mt-5">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    BI consumers
                  </div>
                  <ul className="mt-2 space-y-2">
                    {(asset.biConnections ?? []).map((item) => (
                      <li
                        key={`${item.kind}:${item.id}`}
                        className="rounded-md border border-border px-3 py-2 text-sm"
                      >
                        <div className="font-medium text-foreground">{item.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {assetTypeLabel(item.kind)} · {item.platform}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </TabsContent>

            <TabsContent value="access" className="flex-1 overflow-y-auto px-6 py-4">
              <AccessPanel asset={asset} grants={grants} loading={loading} />
            </TabsContent>

            <TabsContent value="activity" className="flex-1 overflow-y-auto px-6 py-4">
              {auditItems.length === 0 ? (
                <div className="text-sm text-muted-foreground py-8 text-center">
                  No activity yet.
                </div>
              ) : (
                <ol className="relative border-l border-border ml-2 space-y-4">
                  {auditItems.map((a, i) => (
                    <li key={i} className="ml-4">
                      <div className="absolute -left-1.5 mt-1.5 size-3 rounded-full bg-[var(--accent)]" />
                      <div className="text-sm text-foreground">
                        <span className="font-medium capitalize">
                          {a.action.replace(/_/g, ' ')}
                        </span>
                        {' — '}
                        <span className="text-muted-foreground">{a.grant.principal}</span>
                      </div>
                      {a.notes && (
                        <div className="text-xs text-muted-foreground mt-0.5">{a.notes}</div>
                      )}
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        by {a.by} · {relativeTime(a.at)}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </TabsContent>
          </Tabs>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">{label}</dt>
      <dd className="text-foreground mt-0.5 break-words">{value}</dd>
    </div>
  );
}

function relativeTime(iso: string): string {
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return iso;
  const sec = Math.max(1, Math.round((Date.now() - d) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

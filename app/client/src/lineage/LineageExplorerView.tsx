/**
 * Lineage Explorer — the app's hero page.
 *
 *   KPI strip  (KpiCards)      — governed assets · new edges · blast radius $ · PII exposure
 *   Asset picker (search)      — defaults to the top asset by downstream_count
 *                                (mv_exec_revenue_daily), so the demo opens on the story
 *   Lineage graph (LineageGraph) — upstream sources → selected asset → downstream consumers.
 *     Clicking a node RE-SCOPES the graph to that object's lineage (it becomes
 *     the seed). Every node has an expand (⤢) icon that reveals its columns
 *     inline; edge arrow controls reveal mappings between endpoint columns.
 *   Access panel (AccessPanel) — every principal that can access the selected node.
 *
 * Refetches KPIs + neighborhood + grants on `dataMutated`.
 */
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Search, Network } from 'lucide-react';
import {
  fetchAssets,
  fetchLineage,
  fetchKpis,
  fetchAssetGrants,
} from '@/lib/lineage';
import type {
  AssetRow,
  GrantRow,
  LineageKpis,
  LineageNeighborhood,
} from '@/shared/types';
import { dataMutated } from '@/lib/events';
import { KpiCards } from './KpiCards';
import { LineageGraph } from './LineageGraph';
import { AccessPanel } from './AccessPanel';
import { assetTypeLabel } from './assetVisuals';

const DEFAULT_SEED_NAME = 'mv_exec_revenue_daily';

export function LineageExplorerView() {
  const [searchParams, setSearchParams] = useSearchParams();
  const assetParam = searchParams.get('asset');

  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [seedId, setSeedId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [neighborhood, setNeighborhood] = useState<LineageNeighborhood | null>(null);
  const [kpis, setKpis] = useState<LineageKpis | null>(null);
  const [grants, setGrants] = useState<GrantRow[]>([]);
  const [grantsLoading, setGrantsLoading] = useState(false);
  const [search, setSearch] = useState('');

  // Load the asset catalog once; pick the seed (URL param → default MV → top asset).
  useEffect(() => {
    let alive = true;
    fetchAssets()
      .then((rows) => {
        if (!alive) return;
        setAssets(rows);
        if (seedId) return;
        let seed: AssetRow | undefined;
        if (assetParam) {
          seed = rows.find((a) => a.assetName === assetParam || a.id === assetParam);
        }
        if (!seed) seed = rows.find((a) => a.assetName === DEFAULT_SEED_NAME);
        if (!seed) seed = rows[0];
        if (seed) {
          setSeedId(seed.id);
          setSelectedId(seed.id);
        }
      })
      .catch((e) => console.error('[lineage] assets load failed', e));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetParam]);

  // Load neighborhood + KPIs whenever the seed changes (and on dataMutated).
  useEffect(() => {
    if (!seedId) return;
    let alive = true;
    const load = () => {
      Promise.all([fetchLineage(seedId, 3), fetchKpis(seedId)])
        .then(([n, k]) => {
          if (!alive) return;
          setNeighborhood(n);
          setKpis(k);
        })
        .catch((e) => console.error('[lineage] neighborhood load failed', e));
    };
    load();
    const unsub = dataMutated.subscribe(load);
    return () => {
      alive = false;
      unsub();
    };
  }, [seedId]);

  // Load grants for the selected node (right rail), refetch on dataMutated.
  useEffect(() => {
    const target = selectedId ?? seedId;
    if (!target) return;
    let alive = true;
    const load = () => {
      setGrantsLoading(true);
      fetchAssetGrants(target)
        .then((g) => {
          if (alive) setGrants(g);
        })
        .catch((e) => console.error('[lineage] grants load failed', e))
        .finally(() => {
          if (alive) setGrantsLoading(false);
        });
    };
    load();
    const unsub = dataMutated.subscribe(load);
    return () => {
      alive = false;
      unsub();
    };
  }, [selectedId, seedId]);

  const selectedAsset = useMemo(() => {
    const id = selectedId ?? seedId;
    return (
      neighborhood?.assets.find((a) => a.id === id) ??
      assets.find((a) => a.id === id) ??
      null
    );
  }, [selectedId, seedId, neighborhood, assets]);

  const filteredAssets = useMemo(() => {
    if (!search.trim()) return assets.slice(0, 12);
    const q = search.toLowerCase();
    return assets.filter((a) => a.assetName.toLowerCase().includes(q)).slice(0, 12);
  }, [assets, search]);

  const pickSeed = (a: AssetRow) => {
    setSeedId(a.id);
    setSelectedId(a.id);
    setSearch('');
    setSearchParams({ asset: a.assetName }, { replace: true });
  };

  // Clicking a graph node RE-SCOPES the graph: the clicked object becomes the
  // new seed, so the canvas shows just that object's lineage (its upstream
  // sources + downstream consumers).
  const onNodeSelect = (id: string) => {
    if (id === seedId) {
      setSelectedId(id);
      return;
    }
    const node =
      neighborhood?.assets.find((a) => a.id === id) ?? assets.find((a) => a.id === id);
    setSeedId(id);
    setSelectedId(id);
    if (node) setSearchParams({ asset: node.assetName }, { replace: true });
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-5 space-y-5">
        {/* Header + asset picker */}
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              <Network className="size-3.5" />
              Lineage Explorer
            </div>
            <h1 className="display text-2xl font-semibold text-foreground mt-1">
              {selectedAsset ? selectedAsset.assetName : 'Select an asset'}
              {selectedAsset && (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  {assetTypeLabel(selectedAsset.assetType)}
                </span>
              )}
            </h1>
          </div>
          <div className="relative w-full sm:w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search assets…"
              className="w-full rounded-lg border border-border bg-card pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-foreground/30"
            />
            {search.trim() && (
              <div className="absolute z-20 mt-1 w-full max-h-72 overflow-auto rounded-lg border border-border bg-card shadow-lg">
                {filteredAssets.length === 0 && (
                  <div className="px-3 py-2 text-sm text-muted-foreground">No matches</div>
                )}
                {filteredAssets.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => pickSeed(a)}
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                  >
                    <span className="truncate">{a.assetName}</span>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {assetTypeLabel(a.assetType)} · {a.downstreamCount}↓
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* KPI strip */}
        <KpiCards kpis={kpis} />

        {/* Graph + access panel */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4 items-start">
          <div className="rounded-xl border border-border bg-card p-3">
            <div className="flex items-center justify-between px-1 pb-2">
              <div className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
                Lineage graph — upstream sources → {selectedAsset?.assetName ?? 'asset'} → downstream consumers
              </div>
              <div className="text-[10px] text-muted-foreground hidden sm:block">
                ⤢ shows object columns · an edge arrow shows column mappings
              </div>
            </div>
            {seedId && neighborhood ? (
              <LineageGraph
                key={seedId}
                seedId={seedId}
                selectedId={selectedId}
                assets={neighborhood.assets}
                edges={neighborhood.edges}
                onSelect={onNodeSelect}
              />
            ) : (
              <div className="flex items-center justify-center h-[420px] text-sm text-muted-foreground">
                Loading lineage…
              </div>
            )}
          </div>
          <AccessPanel asset={selectedAsset} grants={grants} loading={grantsLoading} />
        </div>

      </div>
    </div>
  );
}

/**
 * Lineage Explorer — the app's hero page.
 *
 *   KPI strip  (KpiCards)      — governed assets · new edges · blast radius $ · PII exposure
 *   Asset picker               — empty until the user picks a Unity Catalog asset
 *   Lineage graph (LineageGraph) — upstream sources → selected asset → downstream consumers.
 *     Clicking a node selects it without re-laying out the graph; picking an
 *     asset outside the current graph loads its lineage. Every node has an
 *     expand (⤢) icon that reveals its columns
 *     inline; edge arrow controls reveal mappings between endpoint columns.
 *   Access panel (AccessPanel) — every principal that can access the selected node.
 *
 * Refetches KPIs + neighborhood + grants on `dataMutated`.
 */
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Network } from 'lucide-react';
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
import { useSession } from '@/lib/api';
import type { UcAsset } from '@/lib/unityCatalog';
import { KpiCards } from './KpiCards';
import { LineageGraph } from './LineageGraph';
import { AccessPanel } from './AccessPanel';
import { UcAssetBrowser } from './UcAssetBrowser';
import { assetTypeLabel } from './assetVisuals';

export function LineageExplorerView() {
  const { config } = useSession();
  const [searchParams, setSearchParams] = useSearchParams();
  const assetParam = searchParams.get('asset');

  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [seedId, setSeedId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [neighborhood, setNeighborhood] = useState<LineageNeighborhood | null>(null);
  const [kpis, setKpis] = useState<LineageKpis | null>(null);
  const [grants, setGrants] = useState<GrantRow[]>([]);
  const [grantsLoading, setGrantsLoading] = useState(false);
  const [selectedUcAsset, setSelectedUcAsset] = useState<UcAsset | null>(null);

  // Load the Lakebase catalog for graph lookups. Only open a graph when the
  // URL names an asset or the user picks one in the browser.
  useEffect(() => {
    let alive = true;
    fetchAssets()
      .then((rows) => {
        if (!alive) return;
        setAssets(rows);
        if (seedId || !assetParam) return;
        const ucParts = assetParam.split('.');
        if (ucParts.length === 3) {
          setSelectedUcAsset({
            catalogName: ucParts[0],
            schemaName: ucParts[1],
            name: ucParts[2],
            fullName: assetParam,
            tableType: '',
            owner: null,
            comment: null,
          });
          setSeedId(assetParam);
          setSelectedId(assetParam);
          return;
        }
        const seed = rows.find((a) => a.assetName === assetParam || a.id === assetParam);
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

  // Selecting a node already on the canvas only moves the selection (access
  // panel, title, URL); the graph and its layout stay put.
  const onNodeSelect = (id: string) => {
    const node =
      neighborhood?.assets.find((a) => a.id === id) ?? assets.find((a) => a.id === id);
    setSelectedId(id);
    const ucParts = id.split('.');
    if (ucParts.length === 3) {
      setSelectedUcAsset((current) =>
        current?.fullName === id
          ? current
          : {
              catalogName: ucParts[0],
              schemaName: ucParts[1],
              name: ucParts[2],
              fullName: id,
              tableType: node?.assetType ?? 'TABLE',
              owner: node?.ownerEmail ?? null,
              comment: null,
            },
      );
      setSearchParams({ asset: id }, { replace: true });
      return;
    }
    setSelectedUcAsset(null);
    if (node) setSearchParams({ asset: node.assetName }, { replace: true });
  };

  const onUcAssetSelect = (asset: UcAsset) => {
    setSelectedUcAsset(asset);
    if (neighborhood?.assets.some((a) => a.id === asset.fullName)) {
      setSelectedId(asset.fullName);
      setSearchParams({ asset: asset.fullName }, { replace: true });
      return;
    }
    setSeedId(asset.fullName);
    setSelectedId(asset.fullName);
    setNeighborhood(null);
    setKpis(null);
    setGrants([]);
    setGrantsLoading(false);
    setSearchParams({ asset: asset.fullName }, { replace: true });
  };

  const defaultCatalog = config?.ucExplorer.defaultCatalog ?? 'porto_catalog';
  const defaultSchema = config?.ucExplorer.defaultSchema ?? 'dbdemos_pipeline_bike';

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden">
      <div className="grid w-full min-w-0 grid-cols-1 gap-4 px-4 py-5 lg:grid-cols-[260px_minmax(0,1fr)]">
        <UcAssetBrowser
          defaultCatalog={defaultCatalog}
          defaultSchema={defaultSchema}
          selectedFullName={selectedUcAsset?.fullName ?? null}
          onSelect={onUcAssetSelect}
        />

        <div className="min-w-0 space-y-5">
          <div>
            <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              <Network className="size-3.5" />
              Lineage Explorer
            </div>
            <h1 className="display text-2xl font-semibold text-foreground mt-1">
              {selectedUcAsset?.name ?? selectedAsset?.assetName ?? 'Select an asset'}
              {(selectedUcAsset?.tableType || selectedAsset) && (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  {assetTypeLabel(
                    selectedUcAsset?.tableType || selectedAsset!.assetType,
                  ).toLowerCase()}
                </span>
              )}
            </h1>
            {selectedUcAsset && (
              <div className="mt-1 font-mono text-xs text-muted-foreground">
                {selectedUcAsset.fullName}
              </div>
            )}
          </div>

          <KpiCards kpis={kpis} />

          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(220px,260px)] gap-4 items-start min-w-0">
            <div className="min-w-0 rounded-xl border border-border bg-card p-3">
              <div className="flex items-center justify-between px-1 pb-2">
                <div className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
                  Lineage graph — upstream sources →{' '}
                  {selectedUcAsset?.name ?? selectedAsset?.assetName ?? 'asset'} → downstream
                  consumers
                </div>
                <div className="text-[10px] text-muted-foreground hidden sm:block">
                  ⤢ shows object columns · an edge arrow shows column mappings
                </div>
              </div>
              {seedId && neighborhood ? (
                <LineageGraph
                  key={seedId}
                  selectedId={selectedId}
                  assets={neighborhood.assets}
                  edges={neighborhood.edges}
                  onSelect={onNodeSelect}
                />
              ) : (
                <div className="flex items-center justify-center h-[420px] px-8 text-center text-sm text-muted-foreground">
                  {seedId ? 'Loading lineage…' : 'Select an asset to load lineage.'}
                </div>
              )}
            </div>
            <AccessPanel
              asset={selectedAsset}
              grants={grants}
              loading={grantsLoading}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

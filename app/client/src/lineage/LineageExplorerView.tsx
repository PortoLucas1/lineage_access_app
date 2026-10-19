/**
 * Lineage Explorer — the app's hero page.
 *
 *   Asset picker               — empty until the user picks a Unity Catalog asset
 *   Lineage graph (LineageGraph) — upstream sources → selected asset → downstream consumers.
 *     Clicking a node selects it without re-laying out the graph; picking an
 *     asset outside the current graph loads its lineage. Every node has an
 *     expand (⤢) icon that reveals its columns
 *     inline; edge arrow controls reveal mappings between endpoint columns.
 *   Access panel (AccessPanel) — every principal that can access the selected node.
 *
 * Refetches the neighborhood + grants on `dataMutated`.
 */
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  Maximize2,
  Minimize2,
  Network,
  PanelLeftOpen,
  PanelRightOpen,
} from 'lucide-react';
import {
  fetchAssets,
  fetchLineage,
  fetchAssetGrants,
} from '@/lib/lineage';
import type {
  AssetRow,
  GrantRow,
  LineageNeighborhood,
} from '@/shared/types';
import { dataMutated } from '@/lib/events';
import { useSession } from '@/lib/api';
import type { UcAsset } from '@/lib/unityCatalog';
import { LineageGraph } from './LineageGraph';
import { AccessPanel } from './AccessPanel';
import { UcAssetBrowser } from './UcAssetBrowser';
import { assetTypeLabel } from './assetVisuals';

// Fixed lineage depth — the hop selector was removed from the toolbar in
// favor of a sensible default that keeps graphs readable without exposing a
// tuning knob the user has to think about.
const LINEAGE_DEPTH = 3;

export function LineageExplorerView() {
  const { config } = useSession();
  const [searchParams, setSearchParams] = useSearchParams();
  const assetParam = searchParams.get('asset');

  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [seedId, setSeedId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [neighborhood, setNeighborhood] = useState<LineageNeighborhood | null>(null);
  const [grants, setGrants] = useState<GrantRow[]>([]);
  const [grantsLoading, setGrantsLoading] = useState(false);
  const [grantsError, setGrantsError] = useState<string | null>(null);
  const [selectedUcAsset, setSelectedUcAsset] = useState<UcAsset | null>(null);
  const [catalogOpen, setCatalogOpen] = useState(true);
  const [accessOpen, setAccessOpen] = useState(true);
  const [focusMode, setFocusMode] = useState(false);

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

  // Load the lineage neighborhood whenever the seed changes (and on dataMutated).
  useEffect(() => {
    if (!seedId) return;
    let alive = true;
    const load = () => {
      fetchLineage(seedId, LINEAGE_DEPTH)
        .then((n) => {
          if (!alive) return;
          setNeighborhood(n);
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
          if (!alive) return;
          setGrants(g);
          setGrantsError(null);
        })
        .catch((e: Error) => {
          if (!alive) return;
          console.error('[lineage] grants load failed', e);
          setGrants([]);
          setGrantsError(e.message);
        })
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
    setGrants([]);
    setGrantsError(null);
    setGrantsLoading(false);
    setSearchParams({ asset: asset.fullName }, { replace: true });
  };

  const defaultCatalog = config?.ucExplorer.defaultCatalog ?? '';
  const defaultSchema = config?.ucExplorer.defaultSchema ?? '';

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden">
      <div
        className={`grid w-full min-w-0 grid-cols-1 gap-4 px-4 py-5 ${
          !focusMode && catalogOpen ? 'lg:grid-cols-[260px_minmax(0,1fr)]' : ''
        }`}
      >
        {!focusMode && catalogOpen ? (
          <UcAssetBrowser
            defaultCatalog={defaultCatalog}
            defaultSchema={defaultSchema}
            selectedFullName={selectedUcAsset?.fullName ?? null}
            onSelect={onUcAssetSelect}
            onCollapse={() => setCatalogOpen(false)}
          />
        ) : null}

        <div className="min-w-0 space-y-5">
          {!focusMode && <div>
            <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {!catalogOpen && (
                <button
                  type="button"
                  onClick={() => setCatalogOpen(true)}
                  className="rounded-md border border-border bg-card p-1.5 text-muted-foreground hover:text-foreground"
                  title="Show Unity Catalog"
                  aria-label="Show Unity Catalog"
                >
                  <PanelLeftOpen className="size-3.5" />
                </button>
              )}
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
          </div>}

          <div
            className={`grid grid-cols-1 gap-4 items-start min-w-0 ${
              !focusMode && accessOpen
                ? 'lg:grid-cols-[minmax(0,1fr)_minmax(240px,280px)]'
                : ''
            }`}
          >
            <div className="min-w-0 rounded-xl border border-border bg-card p-3">
              <div className="flex items-center justify-between px-1 pb-2">
                <div className="min-w-0">
                  <div className="truncate text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
                    Lineage graph — upstream →{' '}
                    {selectedUcAsset?.name ?? selectedAsset?.assetName ?? 'asset'} → downstream
                  </div>
                  {focusMode && selectedUcAsset && (
                    <div className="truncate font-mono text-[10px] text-muted-foreground">
                      {selectedUcAsset.fullName}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {!focusMode && !accessOpen && (
                    <button
                      type="button"
                      onClick={() => setAccessOpen(true)}
                      className="rounded-md border border-border bg-background p-1.5 text-muted-foreground hover:text-foreground"
                      title="Show access panel"
                      aria-label="Show access panel"
                    >
                      <PanelRightOpen className="size-3.5" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setFocusMode((current) => !current)}
                    className="rounded-md border border-border bg-background p-1.5 text-muted-foreground hover:text-foreground"
                    title={focusMode ? 'Exit focus mode' : 'Focus graph'}
                    aria-label={focusMode ? 'Exit focus mode' : 'Focus graph'}
                  >
                    {focusMode ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
                  </button>
                </div>
              </div>
              {seedId && neighborhood ? (
                <LineageGraph
                  key={seedId}
                  selectedId={selectedId}
                  assets={neighborhood.assets}
                  edges={neighborhood.edges}
                  onSelect={onNodeSelect}
                  focusMode={focusMode}
                />
              ) : (
                <div className="flex items-center justify-center h-[420px] px-8 text-center text-sm text-muted-foreground">
                  {seedId ? 'Loading lineage…' : 'Select an asset to load lineage.'}
                </div>
              )}
            </div>
            {!focusMode && accessOpen && (
              <AccessPanel
                asset={selectedAsset}
                grants={grants}
                loading={grantsLoading}
                error={grantsError}
                onCollapse={() => setAccessOpen(false)}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

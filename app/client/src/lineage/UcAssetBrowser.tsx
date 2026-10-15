import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronRight, LoaderCircle, Search } from 'lucide-react';
import {
  fetchUcAssets,
  fetchUcCatalogs,
  fetchUcSchemas,
  searchUcAssets,
  type UcAsset,
  type UcCatalog,
  type UcSchema,
} from '@/lib/unityCatalog';
import { CatalogIcon, SchemaIcon, UcAssetIcon } from './ucIcons';

type Props = {
  defaultCatalog: string;
  defaultSchema: string;
  selectedFullName: string | null;
  onSelect: (asset: UcAsset) => void;
};

export function UcAssetBrowser({
  defaultCatalog,
  defaultSchema,
  selectedFullName,
  onSelect,
}: Props) {
  const [catalogs, setCatalogs] = useState<UcCatalog[]>([]);
  const [schemasByCatalog, setSchemasByCatalog] = useState<Record<string, UcSchema[]>>({});
  const [assetsBySchema, setAssetsBySchema] = useState<Record<string, UcAsset[]>>({});
  const [expandedCatalogs, setExpandedCatalogs] = useState(() => new Set([defaultCatalog]));
  const [expandedSchemas, setExpandedSchemas] = useState(
    () => new Set([`${defaultCatalog}.${defaultSchema}`]),
  );
  const [loadingKeys, setLoadingKeys] = useState<Set<string>>(new Set());
  const [catalogFilter, setCatalogFilter] = useState('');
  const [catalogsLoading, setCatalogsLoading] = useState(true);
  const [assetSearch, setAssetSearch] = useState('');
  const [searchResults, setSearchResults] = useState<UcAsset[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requested = useRef(new Set<string>());

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setCatalogsLoading(true);
      fetchUcCatalogs(catalogFilter)
        .then((rows) => {
          if (cancelled) return;
          setCatalogs(rows);
          setError(null);
        })
        .catch((cause: Error) => {
          if (!cancelled) setError(cause.message);
        })
        .finally(() => {
          if (!cancelled) setCatalogsLoading(false);
        });
    }, catalogFilter ? 250 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [catalogFilter]);

  const load = useCallback(<T,>(key: string, fetcher: () => Promise<T>, store: (rows: T) => void) => {
    if (requested.current.has(key)) return;
    requested.current.add(key);
    setLoadingKeys((current) => new Set(current).add(key));
    fetcher()
      .then((rows) => {
        store(rows);
        setError(null);
      })
      .catch((cause: Error) => {
        requested.current.delete(key);
        setError(cause.message);
      })
      .finally(() => {
        setLoadingKeys((current) => {
          const next = new Set(current);
          next.delete(key);
          return next;
        });
      });
  }, []);

  useEffect(() => {
    for (const catalog of expandedCatalogs) {
      load(catalog, () => fetchUcSchemas(catalog), (rows) =>
        setSchemasByCatalog((current) => ({ ...current, [catalog]: rows })),
      );
    }
  }, [expandedCatalogs, load]);

  useEffect(() => {
    for (const key of expandedSchemas) {
      const [catalog, schema] = key.split('.');
      if (!catalog || !schema) continue;
      load(key, () => fetchUcAssets(catalog, schema), (rows) =>
        setAssetsBySchema((current) => ({ ...current, [key]: rows })),
      );
    }
  }, [expandedSchemas, load]);

  // Reveal the selected asset in the tree, e.g. after a search or graph click.
  useEffect(() => {
    const [catalog, schema] = selectedFullName?.split('.') ?? [];
    if (!catalog || !schema) return;
    setExpandedCatalogs((current) => (current.has(catalog) ? current : new Set(current).add(catalog)));
    const key = `${catalog}.${schema}`;
    setExpandedSchemas((current) => (current.has(key) ? current : new Set(current).add(key)));
  }, [selectedFullName]);

  useEffect(() => {
    const query = assetSearch.trim();
    if (query.length < 2) {
      setSearchResults([]);
      return;
    }
    const [catalog, schema] = selectedFullName?.split('.') ?? [defaultCatalog, defaultSchema];
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setSearching(true);
      searchUcAssets(query, catalog, schema)
        .then((rows) => {
          if (!cancelled) setSearchResults(rows);
        })
        .catch((cause: Error) => {
          if (!cancelled) setError(cause.message);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [assetSearch, selectedFullName, defaultCatalog, defaultSchema]);

  const toggle = (setter: typeof setExpandedCatalogs, key: string) =>
    setter((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const chooseAsset = (asset: UcAsset) => {
    setAssetSearch('');
    setSearchResults([]);
    onSelect(asset);
  };

  return (
    <aside className="min-w-0 rounded-xl border border-border bg-card lg:sticky lg:top-4 lg:max-h-[calc(100vh-6.5rem)] flex flex-col overflow-hidden">
      <div className="p-3 border-b border-border space-y-2">
        <div className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
          Unity Catalog
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <input
            value={assetSearch}
            onChange={(event) => setAssetSearch(event.target.value)}
            placeholder="Search assets…"
            className="w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-8 text-xs focus:outline-none focus:border-foreground/30"
          />
          {searching && (
            <LoaderCircle className="absolute right-2.5 top-1/2 -translate-y-1/2 size-3.5 animate-spin text-muted-foreground" />
          )}
          {assetSearch.trim().length >= 2 && (
            <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-lg border border-border bg-card shadow-lg">
              {searchResults.map((asset) => (
                <AssetRow
                  key={asset.fullName}
                  asset={asset}
                  depth={0}
                  active={selectedFullName === asset.fullName}
                  showPath
                  onClick={() => chooseAsset(asset)}
                />
              ))}
              {!searching && searchResults.length === 0 && (
                <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                  No matching assets
                </div>
              )}
            </div>
          )}
        </div>
        <input
          value={catalogFilter}
          onChange={(event) => setCatalogFilter(event.target.value)}
          placeholder="Filter catalogs…"
          className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:border-foreground/30"
        />
      </div>

      {error && (
        <div className="border-b border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      <div role="tree" aria-label="Unity Catalog" className="min-h-0 flex-1 overflow-y-auto p-1">
        {catalogsLoading && catalogs.length === 0 && <TreeLoading depth={0} />}
        {catalogs.map((catalog) => {
          const catalogOpen = expandedCatalogs.has(catalog.name);
          const schemas = schemasByCatalog[catalog.name];
          return (
            <div key={catalog.name} role="none">
              <TreeRow
                depth={0}
                label={catalog.name}
                icon={<CatalogIcon className="size-3.5" />}
                expanded={catalogOpen}
                loading={loadingKeys.has(catalog.name)}
                onToggle={() => toggle(setExpandedCatalogs, catalog.name)}
              />
              {catalogOpen && schemas?.length === 0 && <TreeEmpty depth={1} label="No schemas" />}
              {catalogOpen && schemas?.map((schema) => {
                const schemaKey = `${catalog.name}.${schema.name}`;
                const schemaOpen = expandedSchemas.has(schemaKey);
                const assets = assetsBySchema[schemaKey];
                return (
                  <div key={schemaKey} role="none">
                    <TreeRow
                      depth={1}
                      label={schema.name}
                      icon={<SchemaIcon className="size-3.5" />}
                      expanded={schemaOpen}
                      loading={loadingKeys.has(schemaKey)}
                      onToggle={() => toggle(setExpandedSchemas, schemaKey)}
                    />
                    {schemaOpen && assets?.length === 0 && (
                      <TreeEmpty depth={2} label="No tables or views" />
                    )}
                    {schemaOpen && assets?.map((asset) => (
                      <AssetRow
                        key={asset.fullName}
                        asset={asset}
                        depth={2}
                        active={selectedFullName === asset.fullName}
                        onClick={() => chooseAsset(asset)}
                      />
                    ))}
                  </div>
                );
              })}
            </div>
          );
        })}
        {!catalogsLoading && catalogs.length === 0 && (
          <TreeEmpty depth={0} label="No catalogs" />
        )}
      </div>
    </aside>
  );
}

const INDENT_PX = 14;

function TreeRow({
  depth,
  label,
  icon,
  expanded,
  loading,
  onToggle,
}: {
  depth: number;
  label: string;
  icon: React.ReactNode;
  expanded: boolean;
  loading: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="treeitem"
      aria-expanded={expanded}
      onClick={onToggle}
      title={label}
      style={{ paddingLeft: 4 + depth * INDENT_PX }}
      className="flex w-full items-center gap-1 rounded-md py-1 pr-2 text-left text-xs text-foreground hover:bg-muted"
    >
      {loading ? (
        <LoaderCircle className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
      ) : (
        <ChevronRight
          className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${
            expanded ? 'rotate-90' : ''
          }`}
        />
      )}
      <span className="shrink-0 text-muted-foreground">{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  );
}

function AssetRow({
  asset,
  depth,
  active,
  showPath = false,
  onClick,
}: {
  asset: UcAsset;
  depth: number;
  active: boolean;
  showPath?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="treeitem"
      aria-selected={active}
      onClick={onClick}
      title={`${asset.fullName} · ${formatTableType(asset.tableType)}`}
      style={{ paddingLeft: 4 + depth * INDENT_PX + (showPath ? 0 : 18) }}
      className={`flex w-full min-w-0 max-w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left ${
        active ? 'bg-primary/10 text-primary' : 'hover:bg-muted'
      }`}
    >
      <UcAssetIcon
        tableType={asset.tableType}
        className={`size-3.5 shrink-0 ${active ? 'text-primary' : 'text-muted-foreground'}`}
      />
      <span className="min-w-0">
        <span className={`block truncate text-xs ${active ? 'font-medium' : ''}`}>
          {asset.name}
        </span>
        {showPath && (
          <span className="block truncate text-[10px] text-muted-foreground">
            {asset.catalogName}.{asset.schemaName} · {formatTableType(asset.tableType)}
          </span>
        )}
      </span>
    </button>
  );
}

function TreeLoading({ depth }: { depth: number }) {
  return (
    <div
      style={{ paddingLeft: 8 + depth * INDENT_PX }}
      className="flex items-center gap-1.5 py-1.5 text-xs text-muted-foreground"
    >
      <LoaderCircle className="size-3.5 animate-spin" />
      Loading…
    </div>
  );
}

function TreeEmpty({ depth, label }: { depth: number; label: string }) {
  return (
    <div
      style={{ paddingLeft: 8 + depth * INDENT_PX + 18 }}
      className="py-1 text-[11px] italic text-muted-foreground"
    >
      {label}
    </div>
  );
}

function formatTableType(value: string): string {
  if (value === 'MANAGED') return 'managed table';
  if (value === 'EXTERNAL') return 'external table';
  return value.toLowerCase().replaceAll('_', ' ');
}

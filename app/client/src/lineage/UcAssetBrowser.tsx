import { useEffect, useState } from 'react';
import { LoaderCircle, Search } from 'lucide-react';
import { CatalogIcon, SchemaIcon, UcAssetIcon } from './ucIcons';
import {
  fetchUcAssets,
  fetchUcCatalogs,
  fetchUcSchemas,
  searchUcAssets,
  type UcAsset,
  type UcCatalog,
  type UcSchema,
} from '@/lib/unityCatalog';

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
  const [schemas, setSchemas] = useState<UcSchema[]>([]);
  const [assets, setAssets] = useState<UcAsset[]>([]);
  const [catalog, setCatalog] = useState(defaultCatalog);
  const [schema, setSchema] = useState(defaultSchema);
  const [catalogFilter, setCatalogFilter] = useState('');
  const [assetSearch, setAssetSearch] = useState('');
  const [searchResults, setSearchResults] = useState<UcAsset[]>([]);
  const [loading, setLoading] = useState<'catalogs' | 'schemas' | 'assets' | 'search' | null>(
    'catalogs',
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading('catalogs');
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
          if (!cancelled) setLoading(null);
        });
    }, catalogFilter ? 250 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [catalogFilter]);

  useEffect(() => {
    if (!catalog) return;
    let cancelled = false;
    setLoading('schemas');
    fetchUcSchemas(catalog)
      .then((rows) => {
        if (cancelled) return;
        setSchemas(rows);
        const preferred =
          catalog === defaultCatalog && rows.some((row) => row.name === defaultSchema)
            ? defaultSchema
            : rows[0]?.name ?? '';
        setSchema((current) =>
          rows.some((row) => row.name === current) ? current : preferred,
        );
        setError(null);
      })
      .catch((cause: Error) => {
        if (!cancelled) setError(cause.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(null);
      });
    return () => {
      cancelled = true;
    };
  }, [catalog, defaultCatalog, defaultSchema]);

  useEffect(() => {
    if (!catalog || !schema) return;
    let cancelled = false;
    setLoading('assets');
    fetchUcAssets(catalog, schema)
      .then((rows) => {
        if (cancelled) return;
        setAssets(rows);
        setError(null);
      })
      .catch((cause: Error) => {
        if (!cancelled) setError(cause.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(null);
      });
    return () => {
      cancelled = true;
    };
  }, [catalog, schema]);

  useEffect(() => {
    const query = assetSearch.trim();
    if (query.length < 2) {
      setSearchResults([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading('search');
      searchUcAssets(query, catalog, schema)
        .then((rows) => {
          if (!cancelled) setSearchResults(rows);
        })
        .catch((cause: Error) => {
          if (!cancelled) setError(cause.message);
        })
        .finally(() => {
          if (!cancelled) setLoading(null);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [assetSearch, catalog, schema]);

  const chooseAsset = (asset: UcAsset) => {
    setCatalog(asset.catalogName);
    setSchema(asset.schemaName);
    setAssetSearch('');
    setSearchResults([]);
    onSelect(asset);
  };

  return (
    <aside className="min-w-0 rounded-xl border border-border bg-card lg:sticky lg:top-4 lg:max-h-[calc(100vh-6.5rem)] flex flex-col overflow-hidden">
      <div className="p-3 border-b border-border">
        <div className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
          Unity Catalog
        </div>
        <div className="relative mt-2">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <input
            value={assetSearch}
            onChange={(event) => setAssetSearch(event.target.value)}
            placeholder="Search assets…"
            className="w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-8 text-xs focus:outline-none focus:border-foreground/30"
          />
          {loading === 'search' && (
            <LoaderCircle className="absolute right-2.5 top-1/2 -translate-y-1/2 size-3.5 animate-spin text-muted-foreground" />
          )}
          {assetSearch.trim().length >= 2 && (
            <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-lg border border-border bg-card shadow-lg">
              {searchResults.map((asset) => (
                <AssetButton
                  key={asset.fullName}
                  asset={asset}
                  active={selectedFullName === asset.fullName}
                  showPath
                  onClick={() => chooseAsset(asset)}
                />
              ))}
              {loading !== 'search' && searchResults.length === 0 && (
                <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                  No matching assets
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="border-b border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-rows-[auto_auto_minmax(10rem,1fr)] divide-y divide-border">
        <BrowserSection
          title="Catalogs"
          loading={loading === 'catalogs'}
          filter={catalogFilter}
          onFilter={setCatalogFilter}
        >
          {catalogs.map((item) => (
            <TreeButton
              key={item.name}
              label={item.name}
              icon={<CatalogIcon className="size-3.5" />}
              active={catalog === item.name}
              onClick={() => {
                setCatalog(item.name);
                setSchema('');
                setAssets([]);
              }}
            />
          ))}
        </BrowserSection>

        <BrowserSection title="Schemas" loading={loading === 'schemas'}>
          {schemas.map((item) => (
            <TreeButton
              key={item.fullName}
              label={item.name}
              icon={<SchemaIcon className="size-3.5" />}
              active={schema === item.name}
              onClick={() => setSchema(item.name)}
            />
          ))}
        </BrowserSection>

        <BrowserSection title="Assets" loading={loading === 'assets'} grow>
          {assets.map((asset) => (
            <AssetButton
              key={asset.fullName}
              asset={asset}
              active={selectedFullName === asset.fullName}
              onClick={() => chooseAsset(asset)}
            />
          ))}
          {loading !== 'assets' && assets.length === 0 && (
            <div className="px-3 py-4 text-center text-xs text-muted-foreground">
              No tables or views
            </div>
          )}
        </BrowserSection>
      </div>
    </aside>
  );
}

function BrowserSection({
  title,
  loading,
  filter,
  onFilter,
  grow = false,
  children,
}: {
  title: string;
  loading: boolean;
  filter?: string;
  onFilter?: (value: string) => void;
  grow?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={`min-h-0 ${grow ? 'flex flex-col' : ''}`}>
      <div className="flex items-center gap-2 px-3 py-2">
        <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {title}
        </div>
        {loading && <LoaderCircle className="size-3 animate-spin text-muted-foreground" />}
      </div>
      {onFilter && (
        <div className="px-2 pb-2">
          <input
            value={filter}
            onChange={(event) => onFilter(event.target.value)}
            placeholder="Filter catalogs…"
            className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:border-foreground/30"
          />
        </div>
      )}
      <div className={`overflow-y-auto px-1 pb-2 ${grow ? 'flex-1' : 'max-h-32'}`}>
        {children}
      </div>
    </section>
  );
}

function TreeButton({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs ${
        active ? 'bg-primary/10 text-primary font-medium' : 'text-foreground hover:bg-muted'
      }`}
    >
      <span className="shrink-0 text-muted-foreground">{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  );
}

function AssetButton({
  asset,
  active,
  showPath = false,
  onClick,
}: {
  asset: UcAsset;
  active: boolean;
  showPath?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={asset.fullName}
      className={`flex w-full min-w-0 max-w-full items-start gap-2 rounded-md px-2 py-1.5 text-left ${
        active ? 'bg-primary/10 text-primary' : 'hover:bg-muted'
      }`}
    >
      <UcAssetIcon
        tableType={asset.tableType}
        className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
      />
      <span className="min-w-0">
        <span className="block truncate text-xs font-medium">{asset.name}</span>
        <span className="block truncate text-[10px] text-muted-foreground">
          {showPath ? `${asset.catalogName}.${asset.schemaName} · ` : ''}
          {formatTableType(asset.tableType)}
        </span>
      </span>
    </button>
  );
}

function formatTableType(value: string): string {
  if (value === 'MANAGED') return 'managed table';
  if (value === 'EXTERNAL') return 'external table';
  return value.toLowerCase().replaceAll('_', ' ');
}

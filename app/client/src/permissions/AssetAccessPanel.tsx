import { useMemo, useState, type ReactNode } from 'react';
import { Box, ChevronRight, FunctionSquare, Search } from 'lucide-react';
import { ACCESS_LEVEL_LABELS } from '@/lib/permissions';
import type { AccessLevel, MappedAsset, PermissionMap } from '@/shared/types';
import { CatalogIcon, SchemaIcon, UcAssetIcon } from '@/lineage/ucIcons';
import { assetTypeLabel } from '@/lineage/assetVisuals';

const LEVEL_STYLES: Record<AccessLevel, string> = {
  full_control: 'bg-rose-500/10 text-rose-700 dark:text-rose-300',
  write: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  read: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  discover: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
};

const INDENT_PX = 18;

type SchemaNode = {
  name: string;
  fullName: string;
  asset: MappedAsset | null;
  children: MappedAsset[];
};

type Tree = {
  catalog: { name: string; asset: MappedAsset | null };
  schemas: SchemaNode[];
};

export function AssetAccessPanel({
  map,
  loading,
  error,
}: {
  map: PermissionMap | null;
  loading: boolean;
  error: string | null;
}) {
  if (loading) return <PanelMessage>Loading effective access…</PanelMessage>;
  if (error) return <PanelMessage tone="error">{error}</PanelMessage>;
  if (!map) {
    return (
      <PanelMessage>
        Select a group, user, or service principal to see the assets they can access.
      </PanelMessage>
    );
  }
  return <AccessTree key={`${map.catalog}:${map.principal}`} map={map} />;
}

function AccessTree({ map }: { map: PermissionMap }) {
  const tree = useMemo(() => buildTree(map), [map]);
  const [query, setQuery] = useState('');
  const [catalogOpen, setCatalogOpen] = useState(true);
  const [openSchemas, setOpenSchemas] = useState<Set<string>>(() => new Set());
  const [openDetails, setOpenDetails] = useState<Set<string>>(() => new Set());

  const needle = query.trim().toLowerCase();
  const searching = needle.length > 0;
  const matches = (asset: { name: string; fullName: string }) =>
    asset.name.toLowerCase().includes(needle) || asset.fullName.toLowerCase().includes(needle);

  const visibleSchemas = useMemo(() => {
    if (!searching) return tree.schemas;
    return tree.schemas
      .map((schema) => {
        if (matches(schema)) return schema;
        const children = schema.children.filter(matches);
        return children.length ? { ...schema, children } : null;
      })
      .filter((schema): schema is SchemaNode => schema !== null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree, needle]);

  const total =
    (tree.catalog.asset ? 1 : 0)
    + tree.schemas.reduce((sum, schema) => sum + (schema.asset ? 1 : 0) + schema.children.length, 0);
  const matchCount = visibleSchemas.reduce(
    (sum, schema) => sum + (searching && matches(schema) ? 1 : 0) + (searching ? schema.children.filter(matches).length : 0),
    0,
  );

  const toggle = (setter: typeof setOpenSchemas, key: string) =>
    setter((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="rounded-xl border border-border bg-card min-h-0">
      <div className="px-4 py-3 border-b border-border space-y-2">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
            Effective access
          </div>
          <div className="text-sm text-muted-foreground mt-1">
            <span className="font-medium text-foreground">{total.toLocaleString()}</span>
            {' '}objects in <span className="font-mono">{map.catalog}</span>
          </div>
          {map.truncated && (
            <div className="mt-1 text-xs text-amber-700 dark:text-amber-300">
              Results were capped. Switch to a smaller catalog if you need a complete list.
            </div>
          )}
          {map.errors.length > 0 && (
            <div className="mt-1 text-xs text-muted-foreground">
              Some object types could not be loaded.
            </div>
          )}
        </div>
        <label className="flex items-center gap-2 rounded-md border border-border bg-background px-2 py-1.5">
          <Search className="size-3.5 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search assets this identity can access…"
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </label>
        {searching && (
          <div className="text-xs text-muted-foreground">
            {matchCount.toLocaleString()} matching {matchCount === 1 ? 'object' : 'objects'}
          </div>
        )}
      </div>

      {total === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-muted-foreground">
          No effective Unity Catalog privileges found in this catalog for this identity.
        </div>
      ) : (
        <div role="tree" aria-label="Effective access" className="p-1">
          <TreeRow
            depth={0}
            icon={<CatalogIcon className="size-4" />}
            name={tree.catalog.name}
            asset={tree.catalog.asset}
            expandable
            expanded={catalogOpen || searching}
            detailsOpen={openDetails.has(tree.catalog.name)}
            onToggle={() => setCatalogOpen((open) => !open)}
            onToggleDetails={() => toggle(setOpenDetails, tree.catalog.name)}
          />
          {(catalogOpen || searching) && (
            <>
              {visibleSchemas.length === 0 && (
                <TreeEmpty depth={1} label={searching ? 'No matching assets' : 'No schemas'} />
              )}
              {visibleSchemas.map((schema) => {
                const schemaOpen = searching || openSchemas.has(schema.fullName);
                return (
                  <div key={schema.fullName} role="none">
                    <TreeRow
                      depth={1}
                      icon={<SchemaIcon className="size-4" />}
                      name={schema.name}
                      asset={schema.asset}
                      expandable={schema.children.length > 0}
                      expanded={schemaOpen}
                      childCount={schema.children.length}
                      detailsOpen={openDetails.has(schema.fullName)}
                      onToggle={() => toggle(setOpenSchemas, schema.fullName)}
                      onToggleDetails={() => toggle(setOpenDetails, schema.fullName)}
                    />
                    {schemaOpen && schema.children.map((child) => (
                      <TreeRow
                        key={child.fullName}
                        depth={2}
                        icon={<LeafIcon asset={child} />}
                        name={child.name}
                        subtitle={leafSubtitle(child)}
                        asset={child}
                        expandable={false}
                        expanded={false}
                        detailsOpen={openDetails.has(child.fullName)}
                        onToggle={() => toggle(setOpenDetails, child.fullName)}
                        onToggleDetails={() => toggle(setOpenDetails, child.fullName)}
                      />
                    ))}
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function TreeRow({
  depth,
  icon,
  name,
  subtitle,
  asset,
  expandable,
  expanded,
  childCount,
  detailsOpen,
  onToggle,
  onToggleDetails,
}: {
  depth: number;
  icon: ReactNode;
  name: string;
  subtitle?: string;
  asset: MappedAsset | null;
  expandable: boolean;
  expanded: boolean;
  childCount?: number;
  detailsOpen: boolean;
  onToggle: () => void;
  onToggleDetails: () => void;
}) {
  return (
    <div role="none">
      <div
        role="treeitem"
        aria-expanded={expandable ? expanded : undefined}
        tabIndex={0}
        onClick={expandable ? onToggle : onToggleDetails}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            (expandable ? onToggle : onToggleDetails)();
          }
        }}
        style={{ paddingLeft: 6 + depth * INDENT_PX }}
        className="flex w-full cursor-pointer items-center gap-1.5 rounded-md py-1.5 pr-2 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        {expandable ? (
          <ChevronRight
            className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${
              expanded ? 'rotate-90' : ''
            }`}
          />
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        <span className="shrink-0 text-muted-foreground">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-foreground">{name}</span>
          {subtitle && (
            <span className="block truncate text-[11px] text-muted-foreground">{subtitle}</span>
          )}
        </span>
        {childCount !== undefined && childCount > 0 && (
          <span className="shrink-0 text-[11px] text-muted-foreground">{childCount}</span>
        )}
        {asset ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onToggleDetails();
            }}
            title="Show privileges"
            aria-expanded={detailsOpen}
            className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${LEVEL_STYLES[asset.accessLevel]}`}
          >
            {ACCESS_LEVEL_LABELS[asset.accessLevel]}
          </button>
        ) : (
          <span className="shrink-0 text-[10px] text-muted-foreground">No direct access</span>
        )}
      </div>
      {detailsOpen && asset && (
        <div
          style={{ paddingLeft: 6 + depth * INDENT_PX + 40 }}
          className="flex flex-wrap gap-1 pb-2 pr-2"
        >
          {asset.privileges.map((grant) => (
            <span
              key={`${grant.privilege}:${grant.conveyedBy}`}
              className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
              title={
                grant.inheritedFromName
                  ? `Inherited from ${grant.inheritedFromType} ${grant.inheritedFromName}`
                  : 'Granted directly on this object'
              }
            >
              {grant.privilege} · {grant.conveyedBy}
              {grant.inheritedFromName ? ` · from ${grant.inheritedFromName}` : ''}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function TreeEmpty({ depth, label }: { depth: number; label: string }) {
  return (
    <div
      style={{ paddingLeft: 6 + depth * INDENT_PX + 20 }}
      className="py-1.5 text-xs italic text-muted-foreground"
    >
      {label}
    </div>
  );
}

function PanelMessage({ children, tone }: { children: ReactNode; tone?: 'error' }) {
  return (
    <div
      className={`rounded-xl border border-border bg-card px-4 py-10 text-center text-sm ${
        tone === 'error' ? 'text-destructive' : 'text-muted-foreground'
      }`}
    >
      {children}
    </div>
  );
}

function LeafIcon({ asset }: { asset: MappedAsset }) {
  const className = 'size-4';
  if (asset.category === 'volume') return <Box className={className} />;
  if (asset.category === 'function') return <FunctionSquare className={className} />;
  return <UcAssetIcon tableType={asset.tableType ?? 'TABLE'} className={className} />;
}

function leafSubtitle(asset: MappedAsset): string {
  if (asset.category === 'volume') return 'volume';
  if (asset.category === 'function') return 'function';
  return assetTypeLabel(asset.tableType ?? 'table').toLowerCase();
}

const CATEGORY_RANK: Record<string, number> = { table: 0, volume: 1, function: 2 };

function buildTree(map: PermissionMap): Tree {
  const schemas = new Map<string, SchemaNode>();
  const ensureSchema = (fullName: string): SchemaNode => {
    let node = schemas.get(fullName);
    if (!node) {
      node = {
        name: fullName.split('.')[1] ?? fullName,
        fullName,
        asset: null,
        children: [],
      };
      schemas.set(fullName, node);
    }
    return node;
  };

  for (const schema of map.categories.schema) ensureSchema(schema.fullName).asset = schema;
  for (const leaf of [
    ...map.categories.table,
    ...map.categories.volume,
    ...map.categories.function,
  ]) {
    const [catalog, schema] = leaf.fullName.split('.');
    ensureSchema(`${catalog}.${schema}`).children.push(leaf);
  }

  for (const node of schemas.values()) {
    node.children.sort(
      (a, b) =>
        (CATEGORY_RANK[a.category] ?? 9) - (CATEGORY_RANK[b.category] ?? 9)
        || a.name.localeCompare(b.name),
    );
  }

  return {
    catalog: { name: map.catalog, asset: map.categories.catalog[0] ?? null },
    schemas: [...schemas.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

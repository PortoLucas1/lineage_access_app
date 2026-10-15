import { Box, FunctionSquare } from 'lucide-react';
import { ACCESS_LEVEL_LABELS, CATEGORY_LABELS } from '@/lib/permissions';
import type {
  AccessLevel,
  AssetCategory,
  MappedAsset,
  PermissionMap,
} from '@/shared/types';
import { CatalogIcon, SchemaIcon, UcAssetIcon } from '@/lineage/ucIcons';
import { assetTypeLabel } from '@/lineage/assetVisuals';

const CATEGORY_ORDER: AssetCategory[] = [
  'catalog',
  'schema',
  'table',
  'volume',
  'function',
];

const LEVEL_STYLES: Record<AccessLevel, string> = {
  full_control: 'bg-rose-500/10 text-rose-700 dark:text-rose-300',
  write: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  read: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  discover: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
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
  if (loading) {
    return (
      <div className="rounded-xl border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
        Loading effective access…
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-xl border border-border bg-card px-4 py-10 text-center text-sm text-destructive">
        {error}
      </div>
    );
  }
  if (!map) {
    return (
      <div className="rounded-xl border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
        Select a group, user, or service principal to see the assets they can access.
      </div>
    );
  }

  const total = CATEGORY_ORDER.reduce(
    (sum, category) => sum + map.categories[category].length,
    0,
  );

  return (
    <div className="rounded-xl border border-border bg-card min-h-0">
      <div className="px-4 py-3 border-b border-border">
        <div className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
          Effective access
        </div>
        <div className="text-sm text-muted-foreground mt-1">
          <span className="font-medium text-foreground">{total.toLocaleString()}</span>
          {' '}
          objects in
          {' '}
          <span className="font-mono">{map.catalog}</span>
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
      {total === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-muted-foreground">
          No effective Unity Catalog privileges found in this catalog for this identity.
        </div>
      ) : (
        CATEGORY_ORDER.map((category) => {
          const assets = map.categories[category];
          if (!assets.length) return null;
          return (
            <section key={category} className="border-b border-border last:border-b-0">
              <div className="px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                {CATEGORY_LABELS[category]}
                <span className="ml-1 font-normal">({assets.length})</span>
              </div>
              {assets.map((asset) => (
                <AssetRow key={asset.fullName} asset={asset} />
              ))}
            </section>
          );
        })
      )}
    </div>
  );
}

function AssetRow({ asset }: { asset: MappedAsset }) {
  return (
    <div className="flex items-start gap-3 px-4 py-2.5 hover:bg-muted/40">
      <div className="mt-0.5 text-muted-foreground">
        <CategoryIcon asset={asset} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm font-medium text-foreground truncate">{asset.name}</span>
          <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${LEVEL_STYLES[asset.accessLevel]}`}>
            {ACCESS_LEVEL_LABELS[asset.accessLevel]}
          </span>
        </div>
        <div className="font-mono text-[11px] text-muted-foreground truncate">{asset.fullName}</div>
        {asset.tableType && (
          <div className="text-[11px] text-muted-foreground">
            {assetTypeLabel(asset.tableType).toLowerCase()}
          </div>
        )}
        <div className="mt-1 flex flex-wrap gap-1">
          {asset.privileges.map((grant) => (
            <span
              key={`${grant.privilege}:${grant.conveyedBy}:${grant.inheritedFromName}`}
              className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
              title={
                grant.inheritedFromName
                  ? `${grant.privilege} via ${grant.conveyedBy}, inherited from ${grant.inheritedFromType} ${grant.inheritedFromName}`
                  : `${grant.privilege} via ${grant.conveyedBy}`
              }
            >
              {grant.privilege}
              {grant.conveyedBy !== asset.fullName ? ` · ${grant.conveyedBy}` : ''}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function CategoryIcon({ asset }: { asset: MappedAsset }) {
  const className = 'size-4';
  if (asset.category === 'catalog') return <CatalogIcon className={className} />;
  if (asset.category === 'schema') return <SchemaIcon className={className} />;
  if (asset.category === 'volume') return <Box className={className} />;
  if (asset.category === 'function') return <FunctionSquare className={className} />;
  return <UcAssetIcon tableType={asset.tableType ?? 'TABLE'} className={className} />;
}

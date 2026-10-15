import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Shield } from 'lucide-react';
import { useSession } from '@/lib/api';
import { fetchUcCatalogs } from '@/lib/unityCatalog';
import { fetchIdentityCapabilities, fetchPermissionMap } from '@/lib/permissions';
import type { DirectoryIdentity, PermissionMap } from '@/shared/types';
import { IdentityBrowser } from './IdentityBrowser';
import { AssetAccessPanel } from './AssetAccessPanel';

export function PermissionsMappingView() {
  const { config } = useSession();
  const [searchParams, setSearchParams] = useSearchParams();
  const defaultCatalog = config?.ucExplorer.defaultCatalog ?? 'porto_catalog';
  const catalog = searchParams.get('catalog');
  const selected = selectedFromParams(searchParams);

  const [canReadGroupMembers, setCanReadGroupMembers] = useState(false);
  const [catalogs, setCatalogs] = useState<string[]>([]);
  const [map, setMap] = useState<PermissionMap | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchIdentityCapabilities()
      .then((caps) => setCanReadGroupMembers(caps.canReadGroupMembers))
      .catch(() => setCanReadGroupMembers(false));
    fetchUcCatalogs()
      .then((rows) => setCatalogs(rows.map((row) => row.name)))
      .catch(() => setCatalogs(defaultCatalog ? [defaultCatalog] : []));
  }, [defaultCatalog]);

  useEffect(() => {
    if (!selected?.handle) {
      setMap(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchPermissionMap(catalog, selected.handle, selected.kind)
      .then((payload) => {
        if (cancelled) return;
        setMap(payload);
        setError(null);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setMap(null);
        setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [catalog, selected?.handle, selected?.kind]);

  const onSelect = (identity: DirectoryIdentity) => {
    setSearchParams(
      { principal: identity.handle, kind: identity.kind, id: identity.id },
      { replace: true },
    );
  };

  const catalogOptions =
    catalog && !catalogs.includes(catalog) ? [catalog, ...catalogs] : catalogs;

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden">
      <div className="grid w-full min-w-0 grid-cols-1 gap-4 px-4 py-5 lg:grid-cols-[320px_minmax(0,1fr)]">
        <IdentityBrowser
          canReadGroupMembers={canReadGroupMembers}
          selected={selected}
          onSelect={onSelect}
        />
        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                <Shield className="size-3.5" />
                Permissions mapping
              </div>
              <h1 className="display text-2xl font-semibold text-foreground mt-1">
                {selected?.displayName ?? 'Select an identity'}
              </h1>
              {selected && (
                <div className="mt-1 font-mono text-xs text-muted-foreground">
                  {selected.handle} · {selected.kind.replaceAll('_', ' ')}
                </div>
              )}
              {!canReadGroupMembers && (
                <div className="mt-2 text-xs text-muted-foreground">
                  Group membership is hidden because this session is not a workspace admin.
                  Selecting a group still shows that group&apos;s Unity Catalog grants.
                </div>
              )}
            </div>
            <label className="text-xs text-muted-foreground">
              Catalog
              <select
                value={catalog ?? ''}
                onChange={(event) => {
                  const next: Record<string, string> = {};
                  if (event.target.value) next.catalog = event.target.value;
                  if (selected) {
                    next.principal = selected.handle;
                    next.kind = selected.kind;
                    next.id = selected.id;
                  }
                  setSearchParams(next, { replace: true });
                }}
                className="ml-2 rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
              >
                <option value="">All catalogs</option>
                {catalogOptions.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <AssetAccessPanel map={map} loading={loading} error={error} />
        </div>
      </div>
    </div>
  );
}

function selectedFromParams(params: URLSearchParams): DirectoryIdentity | null {
  const handle = params.get('principal');
  const kind = params.get('kind');
  const id = params.get('id');
  if (!handle || (kind !== 'group' && kind !== 'user' && kind !== 'service_principal')) {
    return null;
  }
  return {
    id: id ?? handle,
    kind,
    displayName: handle,
    handle,
  };
}

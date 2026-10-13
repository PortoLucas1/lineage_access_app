/**
 * Access panel (right rail) — every principal that can access the selected
 * asset. Header stat: "N principals can access this asset".
 */
import { User, Users, Bot } from 'lucide-react';
import type { AssetRow, GrantRow } from '@/shared/types';

export function AccessPanel({
  asset,
  grants,
  loading,
}: {
  asset: AssetRow | null;
  grants: GrantRow[];
  loading: boolean;
}) {
  const totalPrincipals = grants.reduce((s, g) => s + (g.effectivePrincipals || 0), 0);

  return (
    <div className="rounded-xl border border-border bg-card flex flex-col min-h-0">
      <div className="px-4 py-3 border-b border-border">
        <div className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
          Access panel
        </div>
        <div className="text-sm font-semibold text-foreground mt-0.5 truncate">
          {asset ? asset.assetName : 'Select an asset'}
        </div>
        {asset && (
          <div className="text-xs text-muted-foreground mt-1">
            <span className="font-medium text-foreground">{totalPrincipals.toLocaleString()}</span>{' '}
            principals can access this asset
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-border max-h-[520px]">
        {loading && (
          <div className="px-4 py-6 text-sm text-muted-foreground text-center">Loading…</div>
        )}
        {!loading && grants.length === 0 && (
          <div className="px-4 py-6 text-sm text-muted-foreground text-center">
            {asset ? 'No access grants recorded for this asset.' : 'Pick an asset to see who can access it.'}
          </div>
        )}
        {!loading && grants.map((g) => <GrantRowItem key={g.id} grant={g} />)}
      </div>
    </div>
  );
}

function GrantRowItem({ grant }: { grant: GrantRow }) {
  const Icon =
    grant.principalType === 'group'
      ? Users
      : grant.principalType === 'service_principal'
        ? Bot
        : User;
  return (
    <div className="px-4 py-2.5">
      <div className="flex items-start gap-2.5">
        <div className="size-7 rounded-lg flex items-center justify-center shrink-0 bg-muted text-muted-foreground">
          <Icon className="size-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-medium text-foreground truncate">
              {grant.displayName ?? grant.principal}
            </span>
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            <span className="font-mono">{grant.privilege}</span>
            {' · '}
            {grant.principalType}
            {grant.principalType === 'group' && ` · ${grant.memberCount} members`}
            {grant.department ? ` · ${grant.department}` : ''}
          </div>
        </div>
      </div>
    </div>
  );
}

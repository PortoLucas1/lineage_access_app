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
  const isComparison = grants.some((grant) => grant.comparisonStatus);
  const totalPrincipals = isComparison
    ? new Set(
        grants
          .filter((grant) => grant.comparisonStatus !== 'declared_only')
          .map((grant) => grant.principal),
      ).size
    : grants.reduce((sum, grant) => sum + (grant.effectivePrincipals || 0), 0);

  return (
    <div className="rounded-xl border border-border bg-card flex flex-col min-h-0 min-w-0">
      <div className="px-4 py-3 border-b border-border">
        <div className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
          {isComparison ? 'Terraform vs effective' : 'Access panel'}
        </div>
        <div className="text-sm font-semibold text-foreground mt-0.5 truncate">
          {asset ? asset.assetName : 'Select an asset'}
        </div>
        {asset && (
          <div className="text-xs text-muted-foreground mt-1">
            <span className="font-medium text-foreground">{totalPrincipals.toLocaleString()}</span>{' '}
            effective principals can access this asset
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
            {grant.comparisonStatus && <ComparisonBadge status={grant.comparisonStatus} />}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            <span className="font-mono">{grant.privilege}</span>
            {' · '}
            {grant.principalType}
            {grant.principalType === 'group'
              && !grant.comparisonStatus
              && ` · ${grant.memberCount} members`}
            {grant.department ? ` · ${grant.department}` : ''}
          </div>
          {grant.comparisonStatus && (
            <div className="text-[11px] text-muted-foreground mt-1 break-words">
              {grant.comparisonStatus === 'declared_only'
                ? `Declared at ${grant.declaredScope}`
                : `Inherited from ${grant.inheritedFromType} ${grant.inheritedFromName}`}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ComparisonBadge({
  status,
}: {
  status: NonNullable<GrantRow['comparisonStatus']>;
}) {
  const styles = {
    in_sync: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    declared_only: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
    effective_only: 'bg-rose-500/10 text-rose-700 dark:text-rose-300',
  };
  const labels = {
    in_sync: 'In sync',
    declared_only: 'Declared only',
    effective_only: 'Effective only',
  };
  return (
    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}

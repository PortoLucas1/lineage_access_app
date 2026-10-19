/**
 * Access panel (right rail) — every principal that can access the selected
 * asset. Header stat: "N principals can access this asset".
 *
 * Built to stay usable when an account has 1k+ identities: a search box
 * filters the (already-fetched) grant list by principal/privilege/department,
 * and rendering is capped to a page at a time with a "Load more" button so we
 * never mount thousands of rows at once.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Bot,
  ChevronRight,
  Info,
  PanelRightClose,
  Search,
  User,
  Users,
} from 'lucide-react';
import type { AssetRow, GrantRow } from '@/shared/types';

const PAGE_SIZE = 50;

type ComparisonStatus = NonNullable<GrantRow['comparisonStatus']>;

const COMPARISON_DESCRIPTIONS: Record<ComparisonStatus, string> = {
  in_sync:
    'Declared in Terraform and actually effective in Unity Catalog. Code and reality match.',
  declared_only:
    'Declared in Terraform but not effective in Unity Catalog. Usually the grant has not been applied yet or was revoked outside Terraform.',
  effective_only:
    'Effective in Unity Catalog but not declared in Terraform. Typically granted manually or inherited from a scope Terraform does not manage (e.g. the metastore).',
};

export function AccessPanel({
  asset,
  grants,
  loading,
  error,
  onCollapse,
}: {
  asset: AssetRow | null;
  grants: GrantRow[];
  loading: boolean;
  error?: string | null;
  onCollapse?: () => void;
}) {
  const [search, setSearch] = useState('');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // Reset paging (and clear any stale search) whenever the selected asset's
  // grant set changes, so switching assets never shows a half-scrolled,
  // filtered-out view of the previous one.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [asset?.id]);

  const isComparison = grants.some((grant) => grant.comparisonStatus);
  const totalPrincipals = isComparison
    ? new Set(
        grants
          .filter((grant) => grant.comparisonStatus !== 'declared_only')
          .map((grant) => grant.principal),
      ).size
    : grants.reduce((sum, grant) => sum + (grant.effectivePrincipals || 0), 0);

  const needle = search.trim().toLowerCase();
  const filteredGrants = useMemo(() => {
    if (!needle) return grants;
    return grants.filter((grant) => {
      const haystack = [
        grant.principal,
        grant.displayName,
        grant.privilege,
        grant.department,
        grant.principalType,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [grants, needle]);

  // Cap how many filtered grants are actually mounted so a 1k+-identity
  // account never renders thousands of rows at once; "Load more" reveals the
  // rest PAGE_SIZE at a time. Group *totals* (the counter next to each
  // section header) are computed from the full filtered set so they don't
  // visibly shrink/grow as more pages load — only the rendered rows are capped.
  const visibleGrants = filteredGrants.slice(0, visibleCount);
  const hasMore = visibleGrants.length < filteredGrants.length;

  const groupDefs = [
    {
      key: 'direct',
      label: 'Direct grants',
      match: (grant: GrantRow) => grant.comparisonStatus !== 'declared_only' && !grant.inheritedFromName,
    },
    {
      key: 'inherited',
      label: 'Inherited grants',
      match: (grant: GrantRow) =>
        grant.comparisonStatus !== 'declared_only' && Boolean(grant.inheritedFromName),
    },
    {
      key: 'declared',
      label: 'Declared only',
      match: (grant: GrantRow) => grant.comparisonStatus === 'declared_only',
    },
  ];
  const groups = groupDefs
    .map((def) => ({
      key: def.key,
      label: def.label,
      total: filteredGrants.filter(def.match).length,
      grants: visibleGrants.filter(def.match),
    }))
    .filter((group) => group.total > 0);

  return (
    <div className="rounded-xl border border-border bg-card flex flex-col min-h-0 min-w-0">
      <div className="px-4 py-3 border-b border-border">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
            {isComparison ? 'Terraform vs effective' : 'Access panel'}
          </div>
          {onCollapse && (
            <button
              type="button"
              onClick={onCollapse}
              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              title="Collapse access panel"
              aria-label="Collapse access panel"
            >
              <PanelRightClose className="size-3.5" />
            </button>
          )}
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
        {asset && grants.length > 0 && (
          <label className="mt-2 flex items-center gap-2 rounded-md border border-border bg-background px-2 py-1.5">
            <Search className="size-3.5 text-muted-foreground shrink-0" />
            <input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setVisibleCount(PAGE_SIZE);
              }}
              placeholder="Search principal, privilege, department…"
              className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
            />
          </label>
        )}
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-border max-h-[520px]">
        {loading && (
          <div className="px-4 py-6 text-sm text-muted-foreground text-center">Loading…</div>
        )}
        {!loading && error && (
          <div className="px-4 py-6 text-center">
            <div className="text-sm font-medium text-destructive">Couldn&apos;t load permissions</div>
            <div className="mt-1 text-xs text-muted-foreground">
              Refresh the page or select the asset again.
            </div>
          </div>
        )}
        {!loading && !error && grants.length === 0 && (
          <div className="px-4 py-6 text-sm text-muted-foreground text-center">
            {asset ? 'No access grants recorded for this asset.' : 'Pick an asset to see who can access it.'}
          </div>
        )}
        {!loading && !error && grants.length > 0 && filteredGrants.length === 0 && (
          <div className="px-4 py-6 text-sm text-muted-foreground text-center">
            No principals match &quot;{search.trim()}&quot;.
          </div>
        )}
        {!loading && !error && groups.map((group) => (
          <GrantGroup
            key={group.key}
            label={group.label}
            total={group.total}
            grants={group.grants}
            defaultOpen={group.key !== 'declared'}
          />
        ))}
        {!loading && !error && hasMore && (
          <button
            type="button"
            onClick={() => setVisibleCount((current) => current + PAGE_SIZE)}
            className="w-full px-4 py-2.5 text-left text-xs font-medium text-primary hover:bg-muted"
          >
            Load more ({(filteredGrants.length - visibleGrants.length).toLocaleString()} more)
          </button>
        )}
      </div>
    </div>
  );
}

function GrantGroup({
  label,
  total,
  grants,
  defaultOpen,
}: {
  label: string;
  total: number;
  grants: GrantRow[];
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center gap-1.5 bg-muted/40 px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground hover:bg-muted"
        aria-expanded={open}
      >
        <ChevronRight className={`size-3 transition-transform ${open ? 'rotate-90' : ''}`} />
        <span className="flex-1">{label}</span>
        <span className="font-mono font-normal">{total.toLocaleString()}</span>
      </button>
      {open && grants.map((grant) => <GrantRowItem key={grant.id} grant={grant} />)}
    </section>
  );
}

function GrantRowItem({ grant }: { grant: GrantRow }) {
  const [open, setOpen] = useState(false);
  const Icon =
    grant.principalType === 'group'
      ? Users
      : grant.principalType === 'service_principal'
        ? Bot
        : User;
  return (
    <div className="border-t border-border first:border-t-0">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setOpen((current) => !current);
          }
        }}
        className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left hover:bg-muted/50"
        aria-expanded={open}
      >
        <ChevronRight className={`mt-1 size-3 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`} />
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
            {' · '}{grant.principalType}
            {grant.principalType === 'group'
              && !grant.comparisonStatus
              && ` · ${grant.memberCount} members`}
            {grant.department ? ` · ${grant.department}` : ''}
          </div>
          {open && (
            <div className="mt-2 space-y-1 rounded-md bg-muted/50 px-2 py-1.5 text-[11px] text-muted-foreground">
              <div><span className="font-medium text-foreground">Principal:</span> {grant.principal}</div>
              {grant.comparisonStatus === 'declared_only' && grant.declaredScope && (
                <div className="break-words">Declared at {grant.declaredScope}</div>
              )}
              {grant.inheritedFromName && (
                <div className="break-words">
                  Inherited from {grant.inheritedFromType} {grant.inheritedFromName}
                </div>
              )}
              {grant.grantedBy && <div>Granted by {grant.grantedBy}</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ComparisonBadge({ status }: { status: ComparisonStatus }) {
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
    <span className="inline-flex items-center gap-1">
      <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${styles[status]}`}>
        {labels[status]}
      </span>
      <InfoBalloon label={labels[status]} description={COMPARISON_DESCRIPTIONS[status]} />
    </span>
  );
}

const BALLOON_WIDTH = 240;

/** Rendered in a portal so the scrolling access list can't clip it. */
function InfoBalloon({ label, description }: { label: string; description: string }) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const balloonId = useId();

  const open = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const margin = 8;
    const centered = rect.left + rect.width / 2 - BALLOON_WIDTH / 2;
    const left = Math.min(
      Math.max(margin, centered),
      window.innerWidth - BALLOON_WIDTH - margin,
    );
    setPosition({ top: rect.bottom + 6, left });
  };
  const close = () => setPosition(null);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={`What does "${label}" mean?`}
        aria-describedby={position ? balloonId : undefined}
        onMouseEnter={open}
        onMouseLeave={close}
        onFocus={open}
        onBlur={close}
        className="inline-flex size-3.5 items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <Info className="size-3.5" />
      </button>
      {position
        && createPortal(
          <div
            id={balloonId}
            role="tooltip"
            style={{ top: position.top, left: position.left, width: BALLOON_WIDTH }}
            className="pointer-events-none fixed z-50 rounded-md border border-border bg-popover px-2.5 py-2 text-[11px] leading-snug text-popover-foreground shadow-md"
          >
            <div className="font-semibold mb-0.5">{label}</div>
            {description}
          </div>,
          document.body,
        )}
    </>
  );
}

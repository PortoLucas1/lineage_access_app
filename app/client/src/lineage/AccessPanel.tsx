/**
 * Access panel (right rail) — every principal that can access the selected
 * asset. Header stat: "N principals can access this asset".
 */
import { useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Bot,
  ChevronRight,
  Info,
  PanelRightClose,
  User,
  Users,
} from 'lucide-react';
import type { AssetRow, GrantRow } from '@/shared/types';

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
  onCollapse,
}: {
  asset: AssetRow | null;
  grants: GrantRow[];
  loading: boolean;
  onCollapse?: () => void;
}) {
  const isComparison = grants.some((grant) => grant.comparisonStatus);
  const totalPrincipals = isComparison
    ? new Set(
        grants
          .filter((grant) => grant.comparisonStatus !== 'declared_only')
          .map((grant) => grant.principal),
      ).size
    : grants.reduce((sum, grant) => sum + (grant.effectivePrincipals || 0), 0);

  const groups = [
    {
      key: 'direct',
      label: 'Direct grants',
      grants: grants.filter(
        (grant) => grant.comparisonStatus !== 'declared_only' && !grant.inheritedFromName,
      ),
    },
    {
      key: 'inherited',
      label: 'Inherited grants',
      grants: grants.filter(
        (grant) => grant.comparisonStatus !== 'declared_only' && Boolean(grant.inheritedFromName),
      ),
    },
    {
      key: 'declared',
      label: 'Declared only',
      grants: grants.filter((grant) => grant.comparisonStatus === 'declared_only'),
    },
  ].filter((group) => group.grants.length > 0);

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
        {!loading && groups.map((group) => (
          <GrantGroup
            key={group.key}
            label={group.label}
            grants={group.grants}
            defaultOpen={group.key !== 'declared'}
          />
        ))}
      </div>
    </div>
  );
}

function GrantGroup({
  label,
  grants,
  defaultOpen,
}: {
  label: string;
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
        <span className="font-mono font-normal">{grants.length}</span>
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
              {grant.comparisonStatus && <div className="break-words">
              {grant.comparisonStatus === 'declared_only'
                ? `Declared at ${grant.declaredScope}`
                : `Inherited from ${grant.inheritedFromType} ${grant.inheritedFromName}`}
              </div>}
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

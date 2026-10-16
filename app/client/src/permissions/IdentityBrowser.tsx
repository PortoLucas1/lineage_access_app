import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import { Bot, ChevronRight, LoaderCircle, Search, User, Users } from 'lucide-react';
import {
  fetchGroupMembers,
  fetchIdentities,
} from '@/lib/permissions';
import type { DirectoryIdentity, IdentityKind } from '@/shared/types';

type Props = {
  canReadGroupMembers: boolean;
  selected: DirectoryIdentity | null;
  onSelect: (identity: DirectoryIdentity) => void;
};

const KINDS: Array<{ kind: IdentityKind; label: string }> = [
  { kind: 'group', label: 'Groups' },
  { kind: 'service_principal', label: 'Service principals' },
  { kind: 'user', label: 'Users' },
];

export function IdentityBrowser({ canReadGroupMembers, selected, onSelect }: Props) {
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  return (
    <div className="rounded-xl border border-border bg-card flex flex-col min-h-0 max-h-[calc(100vh-7rem)]">
      <div className="px-4 py-3 border-b border-border">
        <div className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
          Identities
        </div>
        <label className="mt-2 flex items-center gap-2 rounded-md border border-border bg-background px-2 py-1.5">
          <Search className="size-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search groups, users, SPs…"
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </label>
      </div>
      <div className="flex-1 overflow-y-auto">
        {KINDS.map((section) => (
          <IdentitySection
            key={section.kind}
            kind={section.kind}
            label={section.label}
            search={debounced}
            canReadGroupMembers={canReadGroupMembers}
            selected={selected}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}

function IdentitySection({
  kind,
  label,
  search,
  canReadGroupMembers,
  selected,
  onSelect,
}: {
  kind: IdentityKind;
  label: string;
  search: string;
  canReadGroupMembers: boolean;
  selected: DirectoryIdentity | null;
  onSelect: (identity: DirectoryIdentity) => void;
}) {
  const [identities, setIdentities] = useState<DirectoryIdentity[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchIdentities(kind, search, 1, 25)
      .then((page) => {
        if (cancelled) return;
        setIdentities(page.identities);
        setTotal(page.total);
        setError(null);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [kind, search]);

  const loadMore = () => {
    setLoading(true);
    fetchIdentities(kind, search, identities.length + 1, 25)
      .then((page) => {
        setIdentities((current) => [...current, ...page.identities]);
        setTotal(page.total);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  };

  return (
    <section className="border-b border-border last:border-b-0">
      <div className="px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
        <span className="ml-1 font-normal">({total.toLocaleString()})</span>
      </div>
      {error && (
        <div className="px-4 pb-2 text-xs text-destructive" title={error}>
          Couldn't load identities.
        </div>
      )}
      {identities.map((identity) => (
        <IdentityRow
          key={`${identity.kind}:${identity.id}`}
          identity={identity}
          expandable={kind === 'group' && canReadGroupMembers}
          selected={selected}
          onSelect={onSelect}
        />
      ))}
      {loading && identities.length === 0 && (
        <div className="px-4 py-3 text-xs text-muted-foreground">Loading…</div>
      )}
      {!loading && identities.length === 0 && !error && (
        <div className="px-4 py-3 text-xs text-muted-foreground">No matches.</div>
      )}
      {identities.length < total && (
        <button
          type="button"
          onClick={loadMore}
          className="w-full px-4 py-2 text-left text-xs font-medium text-primary hover:bg-muted"
        >
          {loading ? 'Loading…' : 'Load more'}
        </button>
      )}
    </section>
  );
}

function IdentityRow({
  identity,
  expandable,
  selected,
  onSelect,
}: {
  identity: DirectoryIdentity;
  expandable: boolean;
  selected: DirectoryIdentity | null;
  onSelect: (identity: DirectoryIdentity) => void;
}) {
  const [open, setOpen] = useState(false);
  const [members, setMembers] = useState<DirectoryIdentity[] | null>(null);
  const [memberError, setMemberError] = useState<string | null>(null);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const isSelected = selected?.kind === identity.kind && selected.id === identity.id;
  const Icon = iconFor(identity.kind);

  const toggle = (event: MouseEvent) => {
    event.stopPropagation();
    const next = !open;
    setOpen(next);
    if (!next || members || loadingMembers) return;
    setLoadingMembers(true);
    fetchGroupMembers(identity.id)
      .then((rows) => {
        setMembers(rows);
        setMemberError(null);
      })
      .catch((err: Error) => setMemberError(err.message))
      .finally(() => setLoadingMembers(false));
  };

  const nested = useMemo(() => members ?? [], [members]);

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={() => onSelect(identity)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onSelect(identity);
          }
        }}
        className={`flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-muted/70 ${
          isSelected ? 'bg-muted' : ''
        }`}
      >
        {expandable ? (
          <button
            type="button"
            aria-label={open ? 'Collapse members' : 'Expand members'}
            onClick={toggle}
            className="mt-0.5 rounded p-0.5 text-muted-foreground hover:bg-background"
          >
            {loadingMembers ? (
              <LoaderCircle className="size-3.5 animate-spin" />
            ) : (
              <ChevronRight className={`size-3.5 transition-transform ${open ? 'rotate-90' : ''}`} />
            )}
          </button>
        ) : (
          <span className="w-4" />
        )}
        <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-foreground">
            {identity.displayName}
          </span>
          {identity.handle !== identity.displayName && (
            <span className="block truncate font-mono text-[11px] text-muted-foreground">
              {identity.handle}
            </span>
          )}
        </span>
      </div>
      {open && (
        <div className="ml-6 border-l border-border">
          {memberError && (
            <div className="px-3 py-2 text-xs text-destructive">{memberError}</div>
          )}
          {nested.map((member) => (
            <IdentityRow
              key={`${member.kind}:${member.id}`}
              identity={member}
              expandable={member.kind === 'group' && expandable}
              selected={selected}
              onSelect={onSelect}
            />
          ))}
          {!loadingMembers && nested.length === 0 && !memberError && (
            <div className="px-3 py-2 text-xs text-muted-foreground">No members returned.</div>
          )}
        </div>
      )}
    </div>
  );
}

function iconFor(kind: IdentityKind) {
  if (kind === 'group') return Users;
  if (kind === 'service_principal') return Bot;
  return User;
}

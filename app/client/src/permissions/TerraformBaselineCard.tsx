import { useEffect, useState } from 'react';
import { FolderGit2 } from 'lucide-react';
import type { TerraformBaseline } from '@/lib/api';

const STORAGE_KEY = 'lineage-access.terraform-baseline';

type Draft = {
  modulePath: string;
  catalog: string;
  schema: string;
};

function readStored(): Draft | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Draft;
    if (!parsed.modulePath && !parsed.catalog && !parsed.schema) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function TerraformBaselineCard({
  baseline,
}: {
  baseline?: TerraformBaseline;
}) {
  const defaults: Draft = {
    modulePath: baseline?.modulePath || 'terraform',
    catalog: baseline?.catalog || '',
    schema: baseline?.schema || '',
  };
  const [draft, setDraft] = useState<Draft>(defaults);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const stored = readStored();
    setDraft({
      modulePath: stored?.modulePath || defaults.modulePath,
      catalog: stored?.catalog || defaults.catalog,
      schema: stored?.schema || defaults.schema,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaults.modulePath, defaults.catalog, defaults.schema]);

  const save = () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1500);
  };

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start gap-2">
        <FolderGit2 className="mt-0.5 size-4 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
            Terraform grant baseline
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Declared privileges come from <code className="font-mono text-xs">terraform/declared-grants.json</code>.
            Point the module at the catalog you manage, then run <code className="font-mono text-xs">terraform plan</code>.
            Values here are remembered in this browser; production still uses env vars on the app.
          </p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="text-xs text-muted-foreground">
          Module path
          <input
            value={draft.modulePath}
            onChange={(event) => setDraft((current) => ({ ...current, modulePath: event.target.value }))}
            placeholder="terraform"
            className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
          />
        </label>
        <label className="text-xs text-muted-foreground">
          Catalog
          <input
            value={draft.catalog}
            onChange={(event) => setDraft((current) => ({ ...current, catalog: event.target.value }))}
            placeholder="your_catalog"
            className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
          />
        </label>
        <label className="text-xs text-muted-foreground">
          Schema
          <input
            value={draft.schema}
            onChange={(event) => setDraft((current) => ({ ...current, schema: event.target.value }))}
            placeholder="your_schema"
            className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
          />
        </label>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={save}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
        >
          {saved ? 'Saved' : 'Save locally'}
        </button>
        <span className="font-mono text-[11px] text-muted-foreground">
          terraform -chdir={draft.modulePath || 'terraform'} plan
          {draft.catalog ? ` -var='catalog_name=${draft.catalog}'` : ''}
          {draft.schema ? ` -var='schema_name=${draft.schema}'` : ''}
        </span>
      </div>
    </section>
  );
}

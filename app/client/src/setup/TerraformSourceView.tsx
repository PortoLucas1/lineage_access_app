import { useState } from 'react';
import { useNavigate } from 'react-router';
import { FolderGit2 } from 'lucide-react';
import { okOrThrow } from '@/lib/api';
import { readSetupState, writeSetupState } from '@/lib/setup';

type SourceResponse = {
  path: string | null;
  bundledPath: string;
  catalogPrincipals: number;
  schemaCount: number;
  tableCount: number;
};

export function TerraformSourceView() {
  const navigate = useNavigate();
  const initial = readSetupState();
  const [path, setPath] = useState(initial.path);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SourceResponse | null>(null);

  const skip = () => {
    writeSetupState({ status: 'skipped', path: path.trim() });
    navigate('/lineage', { replace: true });
  };

  const save = async () => {
    const nextPath = path.trim();
    if (!nextPath) {
      setError('Enter a Databricks workspace folder path.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await okOrThrow(
        await fetch('/api/terraform/source', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: nextPath }),
        }),
        '/api/terraform/source',
      );
      const body = (await response.json()) as SourceResponse;
      writeSetupState({ status: 'configured', path: body.path ?? nextPath });
      setSaved(body);
      navigate('/lineage', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10">
        <div>
          <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            <FolderGit2 className="size-3.5" />
            Terraform source
          </div>
          <h1 className="display mt-1 text-2xl font-semibold text-foreground">
            Point the app at your Terraform grants
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Provide a Databricks workspace folder with the Terraform that declares who can
            access your assets. The Lineage Explorer then compares that baseline with live
            Unity Catalog and external-lineage access — in sync, Terraform-only, or granted
            outside Terraform (UI, SQL, or other tools).
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <label className="block text-sm font-medium text-foreground">
            Workspace folder path
            <input
              value={path}
              onChange={(event) => setPath(event.target.value)}
              placeholder="/Workspace/Users/you@company.com/uc-grants"
              className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </label>
          <p className="text-sm text-muted-foreground">
            The folder must be readable by this app&apos;s service principal. Grant the App SP
            <span className="font-medium text-foreground"> CAN_READ </span>
            on the workspace folder (or Git folder / Repo) before saving.
          </p>
          <p className="text-sm text-muted-foreground">
            Include Terraform for Unity Catalog assets and for external systems registered
            through External Lineage — for example
            {' '}<code className="font-mono text-xs">databricks_permissions.tf</code>
            {' '}(tables, schemas, catalogs) and
            {' '}<code className="font-mono text-xs">extsystem_permissions.tf</code>
            {' '}(Tableau and other external lineage objects). A
            {' '}<code className="font-mono text-xs">declared-grants.json</code>
            {' '}manifest in the same folder is used for the in-app comparison.
          </p>
          <p className="text-sm text-muted-foreground">
            This step is optional.
          </p>
          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
          {saved && (
            <div className="text-xs text-muted-foreground">
              Loaded {saved.catalogPrincipals} catalog principal{saved.catalogPrincipals === 1 ? '' : 's'},
              {' '}{saved.schemaCount} schema{saved.schemaCount === 1 ? '' : 's'},
              {' '}{saved.tableCount} table{saved.tableCount === 1 ? '' : 's'}.
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-60"
            >
              {saving ? 'Checking folder…' : 'Save and continue'}
            </button>
            <button
              type="button"
              onClick={skip}
              disabled={saving}
              className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted"
            >
              Skip
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const STORAGE_KEY = 'lineage-access.terraform-setup';

export type SetupStatus = 'pending' | 'configured' | 'skipped';

export type SetupState = {
  status: SetupStatus;
  path: string;
};

export function readSetupState(): SetupState {
  if (typeof window === 'undefined') return { status: 'pending', path: '' };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { status: 'pending', path: '' };
    const parsed = JSON.parse(raw) as Partial<SetupState>;
    if (parsed.status === 'configured' || parsed.status === 'skipped') {
      return { status: parsed.status, path: typeof parsed.path === 'string' ? parsed.path : '' };
    }
  } catch {
    /* ignore */
  }
  return { status: 'pending', path: '' };
}

export function writeSetupState(state: SetupState): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function isSetupComplete(): boolean {
  const status = readSetupState().status;
  return status === 'configured' || status === 'skipped';
}

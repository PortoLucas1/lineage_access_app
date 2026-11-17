import { createHash } from 'node:crypto';
import type { Request } from 'express';

/**
 * Optional dbdemos usage tracking (Node port of the BuildPad / dbdemos-tracker
 * app-view event). Fire-and-forget: never delays a response, swallows errors.
 * Disable with DBDEMOS_TRACKER_DISABLED=1.
 *
 * Spec: https://github.com/databricks-field-eng/dbdemos-tracker
 */

export const DEMO_NAME = 'lineage-access-hub-f52d';
const TRACK_URL =
  'https://ppxrzfxige.execute-api.us-west-2.amazonaws.com/v1/analytics';
const TIMEOUT_MS = 2000;

// Same static extensions the Python FastAPI helper ignores.
const STATIC_EXT =
  /\.(js|css|png|jpe?g|gif|svg|ico|woff2?|ttf|eot|map|webmanifest)$/i;

let warnedMissingOrg = false;
/** Cached org id; null = not resolved yet, '' = missing. */
let cachedOrgId: string | null | undefined = null;

/**
 * True for SPA document loads (HTML shell). False for /api and static assets.
 * Client-side navigations don't hit the server again — only full page loads.
 */
export function isTrackedPagePath(path: string): boolean {
  if (path.startsWith('/api') || path.startsWith('/query')) return false;
  if (STATIC_EXT.test(path)) return false;
  return true;
}

/**
 * Resolve the workspace / org id for tracking.
 * Prefer DATABRICKS_WORKSPACE_ID (set in app.yaml or injected by Apps).
 * Fall back to the numeric suffix in the Apps URL if present.
 */
export function resolveOrgId(
  explicit?: string | undefined,
): string | undefined {
  if (explicit?.trim()) return explicit.trim();
  if (cachedOrgId !== null) return cachedOrgId || undefined;

  const fromEnv = process.env.DATABRICKS_WORKSPACE_ID?.trim();
  if (fromEnv) {
    cachedOrgId = fromEnv;
    return fromEnv;
  }

  // e.g. https://dbgen-lineage-access-1444828305810485.aws.databricksapps.com
  const appUrl =
    process.env.DATABRICKS_APP_URL ||
    process.env.DATABRICKS_HOST ||
    '';
  const fromUrl = appUrl.match(/-(\d{10,})\.(?:aws\.)?databricksapps\.com/);
  if (fromUrl) {
    cachedOrgId = fromUrl[1];
    return fromUrl[1];
  }

  cachedOrgId = '';
  if (!warnedMissingOrg) {
    warnedMissingOrg = true;
    console.warn(
      '[dbdemos-tracker] DATABRICKS_WORKSPACE_ID is unset — APP-VIEW events are skipped. Set it in app.yaml (e.g. 1444828305810485).',
    );
  }
  return undefined;
}

/**
 * Every view is sent; the email only for @databricks.com users, hashed.
 * Anyone else is an anonymous view. Call without awaiting.
 */
export function trackView(
  req: Request,
  appPath: string,
  orgId?: string | undefined,
): void {
  try {
    if (process.env.DBDEMOS_TRACKER_DISABLED === '1') return;

    const resolved = resolveOrgId(orgId);
    if (!resolved) return;

    const body: Record<string, string> = {
      category: 'demo-app',
      event: 'APP-VIEW',
      version: '1',
      demo_name: DEMO_NAME,
      org_id: resolved,
      path: `/_dbdemos/demo-app/${DEMO_NAME}`,
      app_path: appPath,
    };

    const email = req.headers['x-forwarded-email'];
    if (typeof email === 'string' && email.endsWith('@databricks.com')) {
      body.user_hash = createHash('sha256').update(email).digest('hex');
    }

    fetch(TRACK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }).catch(() => {});
  } catch {
    // Telemetry must never affect the app.
  }
}

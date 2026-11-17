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
 * Every view is sent; the email only for @databricks.com users, hashed.
 * Anyone else is an anonymous view. Call without awaiting.
 */
export function trackView(
  req: Request,
  appPath: string,
  orgId: string | undefined,
): void {
  try {
    if (process.env.DBDEMOS_TRACKER_DISABLED === '1') return;
    if (!orgId) return;

    const body: Record<string, string> = {
      category: 'demo-app',
      event: 'APP-VIEW',
      version: '1',
      demo_name: DEMO_NAME,
      org_id: orgId,
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

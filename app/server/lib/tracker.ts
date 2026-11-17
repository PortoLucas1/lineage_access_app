import { createHash } from 'node:crypto';
import type { Request } from 'express';

/**
 * Optional dbdemos usage tracking (Node port of dbdemos-tracker's app-view
 * event). Fire-and-forget: it never delays a response and swallows every
 * error. Disable with DBDEMOS_TRACKER_DISABLED=1.
 */

export const DEMO_NAME = 'lineage-access-hub-f52d';
const TRACK_URL =
  'https://ppxrzfxige.execute-api.us-west-2.amazonaws.com/v1/analytics';
const TIMEOUT_MS = 2000;
// Test / dev workspace the dbdemos tracker ignores.
const TEST_WORKSPACE_ID = '1660015457675682';
const TRACKED_PAGE_PATHS = new Set(['/', '/index.html']);

export function isTrackedPagePath(path: string): boolean {
  return TRACKED_PAGE_PATHS.has(path);
}

function userHash(email: string | undefined): string | undefined {
  if (!email || !email.endsWith('@databricks.com')) return undefined;
  return createHash('sha256').update(email).digest('hex');
}

/**
 * Sends one app-view event. Returns immediately; callers must not await it.
 * Only @databricks.com users are hashed; everyone else is an anonymous view.
 */
export function trackView(req: Request): void {
  try {
    if (process.env.DBDEMOS_TRACKER_DISABLED === '1') return;

    const workspaceId = process.env.DATABRICKS_WORKSPACE_ID;
    if (!workspaceId || workspaceId === TEST_WORKSPACE_ID) return;

    const header = req.headers['x-forwarded-email'];
    const email = Array.isArray(header) ? header[0] : header;
    const hash = userHash(email);

    const payload: Record<string, string | number> = {
      category: 'demo-app',
      event: 'APP-VIEW',
      version: 1,
      demo_name: DEMO_NAME,
      org_id: workspaceId,
      path: `/_dbdemos/demo-app/${DEMO_NAME}`,
      app_path: req.path,
    };
    if (hash) payload.user_hash = hash;

    void fetch(TRACK_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }).catch(() => undefined);
  } catch {
    // Telemetry must never affect the app.
  }
}

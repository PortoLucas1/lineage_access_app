import type { Application } from 'express';
import { recentActivity } from '../db/queries/index.js';
import type { AppDb } from '../db/index.js';

/**
 * Unified activity feed — the append-only audit trail across all access
 * grants (grants flagged for review, reviews). Powers the home-page
 * "Recent activity" list.
 */
export function registerActivityRoutes(
  app: Application,
  deps: { db: AppDb },
): void {
  app.get('/api/activity/recent', async (req, res) => {
    const raw = Number(req.query.limit);
    const limit = Number.isFinite(raw) && raw >= 1 ? Math.min(Math.floor(raw), 100) : 20;
    const events = await recentActivity(deps.db, limit);
    res.json(events);
  });
}

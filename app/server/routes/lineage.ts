import type { Application } from 'express';
import {
  getAsset,
  getGrantsForAsset,
  getKpis,
  getLineageNeighborhood,
  getColumnLineage,
  listAssets,
} from '../db/queries/index.js';
import type { AppDb } from '../db/index.js';
import {
  getUcAsset,
  getUcColumnLineage,
  getUcKpis,
  getUcLineageNeighborhood,
  isUcFullName,
} from '../uc/lineage.js';
import { getUcGrantComparison } from '../uc/permissions.js';

/**
 * Lineage & Access read routes — drive the Lineage Explorer page.
 *   GET /api/assets                 — asset catalog (search/type filter)
 *   GET /api/assets/:id             — one asset's metadata
 *   GET /api/assets/:id/grants      — access panel for an asset
 *   GET /api/lineage/:id            — lineage neighborhood (graph) for a seed
 *   GET /api/lineage/:id/kpis       — KPI strip for a seed asset's sub-graph
 */

function strParam(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function intParam(v: unknown, fallback: number, max: number): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.floor(n), max);
}

export function registerLineageRoutes(app: Application, deps: { db: AppDb }): void {
  const { db } = deps;

  app.get('/api/assets', async (req, res) => {
    const rows = await listAssets(db, {
      search: strParam(req.query.search),
      type: strParam(req.query.type),
      limit: intParam(req.query.limit, 500, 2000),
    });
    res.json(rows);
  });

  app.get('/api/assets/:id', async (req, res) => {
    const row = isUcFullName(req.params.id)
      ? await getUcAsset(req, req.params.id)
      : await getAsset(db, req.params.id);
    if (!row) {
      res.status(404).json({ error: 'asset not found' });
      return;
    }
    res.json(row);
  });

  app.get('/api/assets/:id/grants', async (req, res) => {
    const rows = isUcFullName(req.params.id)
      ? await getUcGrantComparison(req, req.params.id)
      : await getGrantsForAsset(db, req.params.id);
    res.json(rows);
  });

  app.get('/api/lineage/:id', async (req, res) => {
    const hops = intParam(req.query.hops, 2, 4);
    const graph = isUcFullName(req.params.id)
      ? await getUcLineageNeighborhood(req, req.params.id, hops)
      : await getLineageNeighborhood(db, req.params.id, hops);
    res.json(graph);
  });

  app.get('/api/lineage/:id/kpis', async (req, res) => {
    const kpis = isUcFullName(req.params.id)
      ? await getUcKpis(req, req.params.id)
      : await getKpis(db, req.params.id);
    res.json(kpis);
  });

  // Column-level lineage for any governed object — the graph expansion payload.
  app.get('/api/assets/:id/columns', async (req, res) => {
    const cl = isUcFullName(req.params.id)
      ? await getUcColumnLineage(req, req.params.id)
      : await getColumnLineage(db, req.params.id);
    res.json(cl);
  });
}

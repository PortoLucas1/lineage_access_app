import type { Application, Response } from 'express';
import {
  bundledManifestPath,
  clearDeclaredSource,
  getDeclaredManifest,
  getDeclaredSourcePath,
  loadDeclaredSourceFromWorkspace,
} from '../uc/declared-grants.js';

function strParam(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function routeError(res: Response, error: unknown, fallback = 502): void {
  const message = error instanceof Error ? error.message : String(error);
  const status = message.includes('required') || message.includes('not found') || message.includes('valid JSON')
    ? 400
    : fallback;
  res.status(status).json({ error: message });
}

export function registerTerraformRoutes(app: Application): void {
  app.get('/api/terraform/source', (_req, res) => {
    const manifest = getDeclaredManifest();
    res.json({
      path: getDeclaredSourcePath(),
      bundledPath: bundledManifestPath,
      catalogPrincipals: Object.keys(manifest.catalog).length,
      schemaCount: Object.keys(manifest.schemas).length,
      tableCount: Object.keys(manifest.tables).length,
    });
  });

  app.post('/api/terraform/source', async (req, res) => {
    try {
      const path = strParam((req.body as { path?: string } | undefined)?.path);
      if (!path) throw new Error('folder path is required');
      const manifest = await loadDeclaredSourceFromWorkspace(path);
      res.json({
        path: manifest.sourcePath,
        bundledPath: bundledManifestPath,
        catalogPrincipals: Object.keys(manifest.catalog).length,
        schemaCount: Object.keys(manifest.schemas).length,
        tableCount: Object.keys(manifest.tables).length,
      });
    } catch (error) {
      routeError(res, error);
    }
  });

  app.delete('/api/terraform/source', (_req, res) => {
    const manifest = clearDeclaredSource();
    res.json({
      path: null,
      bundledPath: bundledManifestPath,
      catalogPrincipals: Object.keys(manifest.catalog).length,
      schemaCount: Object.keys(manifest.schemas).length,
      tableCount: Object.keys(manifest.tables).length,
    });
  });
}

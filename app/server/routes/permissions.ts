import type { Application, Response } from 'express';
import {
  DEFAULT_COUNT,
  getGroupMembers,
  getIdentityCapabilities,
  listIdentities,
  type IdentityKind,
} from '../uc/identities.js';
import { getPermissionMap } from '../uc/permission-map.js';

function strParam(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function intParam(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.floor(parsed);
}

function routeError(res: Response, error: unknown, fallback = 502): void {
  const message = error instanceof Error ? error.message : String(error);
  const status = message.includes('must') || message.includes('required') ? 400 : fallback;
  res.status(status).json({ error: message });
}

function parseKind(value: unknown): IdentityKind {
  if (value === 'group' || value === 'user' || value === 'service_principal') return value;
  throw new Error('kind must be group, user, or service_principal');
}

export function registerPermissionRoutes(app: Application): void {
  app.get('/api/identities/capabilities', async (req, res) => {
    try {
      res.json(await getIdentityCapabilities(req));
    } catch (error) {
      routeError(res, error);
    }
  });

  app.get('/api/identities', async (req, res) => {
    try {
      const kind = parseKind(req.query.kind);
      const page = await listIdentities(
        req,
        kind,
        strParam(req.query.q),
        intParam(req.query.startIndex, 1),
        intParam(req.query.count, DEFAULT_COUNT),
      );
      res.json(page);
    } catch (error) {
      routeError(res, error);
    }
  });

  app.get('/api/identities/groups/:id/members', async (req, res) => {
    try {
      const result = await getGroupMembers(req, req.params.id);
      if (!result.canReadGroupMembers) {
        res.status(403).json({
          error: 'Group membership is only visible to workspace admins.',
          canReadGroupMembers: false,
          members: [],
        });
        return;
      }
      res.json(result);
    } catch (error) {
      routeError(res, error);
    }
  });

  app.get('/api/permissions/map', async (req, res) => {
    try {
      const catalog = strParam(req.query.catalog);
      const principal = strParam(req.query.principal);
      if (!catalog) throw new Error('catalog is required');
      if (!principal) throw new Error('principal is required');
      res.json(await getPermissionMap(req, catalog, principal));
    } catch (error) {
      routeError(res, error);
    }
  });
}

/**
 * REST helpers for the lineage & access domain (assets / lineage graph /
 * access grants / activity feed). Types live in `shared/types.ts`.
 */
import { okOrThrow } from './api';
import type {
  ActivityEvent,
  AssetRow,
  ColumnLineage,
  GrantRow,
  LineageKpis,
  LineageNeighborhood,
} from '@/shared/types';

export async function fetchAssets(
  filters: { search?: string; type?: string } = {},
): Promise<AssetRow[]> {
  const qs = new URLSearchParams();
  if (filters.search) qs.set('search', filters.search);
  if (filters.type) qs.set('type', filters.type);
  const res = await okOrThrow(await fetch(`/api/assets?${qs}`), '/api/assets');
  return res.json();
}

export async function fetchAsset(id: string): Promise<AssetRow> {
  const res = await okOrThrow(
    await fetch(`/api/assets/${encodeURIComponent(id)}`),
    `/api/assets/${id}`,
  );
  return res.json();
}

export async function fetchAssetGrants(id: string): Promise<GrantRow[]> {
  const res = await okOrThrow(
    await fetch(`/api/assets/${encodeURIComponent(id)}/grants`),
    `/api/assets/${id}/grants`,
  );
  return res.json();
}

export async function fetchLineage(
  id: string,
  hops = 2,
): Promise<LineageNeighborhood> {
  const res = await okOrThrow(
    await fetch(`/api/lineage/${encodeURIComponent(id)}?hops=${hops}`),
    `/api/lineage/${id}`,
  );
  return res.json();
}

export async function fetchKpis(id: string): Promise<LineageKpis> {
  const res = await okOrThrow(
    await fetch(`/api/lineage/${encodeURIComponent(id)}/kpis`),
    `/api/lineage/${id}/kpis`,
  );
  return res.json();
}

export async function fetchColumnLineage(id: string): Promise<ColumnLineage> {
  const res = await okOrThrow(
    await fetch(`/api/assets/${encodeURIComponent(id)}/columns`),
    `/api/assets/${id}/columns`,
  );
  return res.json();
}

export async function fetchActivity(limit = 20): Promise<ActivityEvent[]> {
  const res = await okOrThrow(
    await fetch(`/api/activity/recent?limit=${limit}`),
    '/api/activity/recent',
  );
  return res.json();
}

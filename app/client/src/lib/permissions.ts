import { okOrThrow } from './api';
import type {
  AssetCategory,
  DirectoryIdentity,
  DirectoryPage,
  IdentityCapabilities,
  IdentityKind,
  MappedAsset,
  PermissionMap,
} from '@/shared/types';

export function fetchIdentityCapabilities(): Promise<IdentityCapabilities> {
  return json('/api/identities/capabilities', '/api/identities/capabilities');
}

export function fetchIdentities(
  kind: IdentityKind,
  search = '',
  startIndex = 1,
  count = 25,
): Promise<DirectoryPage> {
  const query = new URLSearchParams({
    kind,
    startIndex: String(startIndex),
    count: String(count),
  });
  if (search.trim()) query.set('q', search.trim());
  return json(`/api/identities?${query}`, '/api/identities');
}

export async function fetchGroupMembers(groupId: string): Promise<DirectoryIdentity[]> {
  const response = await fetch(`/api/identities/groups/${encodeURIComponent(groupId)}/members`);
  if (response.status === 403) {
    const error = new Error('Group membership is only visible to workspace admins.');
    (error as Error & { code?: string }).code = 'forbidden';
    throw error;
  }
  const body = await okOrThrow(response, `/api/identities/groups/${groupId}/members`);
  const payload = (await body.json()) as { members?: DirectoryIdentity[] };
  return payload.members ?? [];
}

export function fetchPermissionMap(
  catalog: string | null,
  principal: string,
  kind?: IdentityKind,
  source?: 'declared' | 'effective',
): Promise<PermissionMap> {
  const query = new URLSearchParams({ principal });
  if (catalog) query.set('catalog', catalog);
  if (kind) query.set('kind', kind);
  if (source) query.set('source', source);
  return json(`/api/permissions/map?${query}`, '/api/permissions/map');
}

export async function fetchPermissionMapChildren(
  catalog: string,
  schema: string,
  principal: string,
  kind?: IdentityKind,
): Promise<MappedAsset[]> {
  const query = new URLSearchParams({ catalog, schema, principal });
  if (kind) query.set('kind', kind);
  const payload = await json<{ assets?: MappedAsset[] }>(
    `/api/permissions/map/children?${query}`,
    '/api/permissions/map/children',
  );
  return payload.assets ?? [];
}

export const CATEGORY_LABELS: Record<AssetCategory, string> = {
  catalog: 'Catalogs',
  schema: 'Schemas',
  table: 'Tables and views',
  volume: 'Volumes',
  function: 'Functions',
};

export const ACCESS_LEVEL_LABELS = {
  full_control: 'Full control',
  write: 'Write',
  read: 'Read / execute',
  discover: 'Discover / use',
} as const;

async function json<T>(url: string, label: string): Promise<T> {
  const response = await okOrThrow(await fetch(url), label);
  return response.json() as Promise<T>;
}

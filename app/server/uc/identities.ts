import type { Request } from 'express';
import { authHeaders } from '../lib/auth.js';
import { workspaceHost } from '../lib/statement-execution.js';

export type IdentityKind = 'group' | 'user' | 'service_principal';

export type DirectoryIdentity = {
  id: string;
  kind: IdentityKind;
  displayName: string;
  handle: string;
};

export type DirectoryPage = {
  identities: DirectoryIdentity[];
  total: number;
  startIndex: number;
  count: number;
};

export type IdentityCapabilities = {
  canReadGroupMembers: boolean;
};

type ScimListResponse = {
  Resources?: Array<Record<string, unknown>>;
  totalResults?: number;
  startIndex?: number;
  itemsPerPage?: number;
};

type ScimGroup = {
  id?: string;
  displayName?: string;
  members?: Array<{
    value?: string;
    display?: string;
    $ref?: string;
    type?: string;
  }>;
};

const DEFAULT_COUNT = 25;
const MAX_COUNT = 50;

export async function listIdentities(
  req: Request,
  kind: IdentityKind,
  search: string,
  startIndex: number,
  count: number,
): Promise<DirectoryPage> {
  const safeCount = Math.min(Math.max(count, 1), MAX_COUNT);
  const safeStart = Math.max(startIndex, 1);
  const filter = scimFilter(kind, search);
  const qs = new URLSearchParams({
    startIndex: String(safeStart),
    count: String(safeCount),
  });
  if (filter) qs.set('filter', filter);
  const path = `${scimCollection(kind)}?${qs.toString()}`;
  const body = await scimJson<ScimListResponse>(req, path);
  return {
    identities: (body.Resources ?? []).map((row) => toIdentity(kind, row)),
    total: Number(body.totalResults ?? 0),
    startIndex: Number(body.startIndex ?? safeStart),
    count: Number(body.itemsPerPage ?? safeCount),
  };
}

export async function getIdentityCapabilities(req: Request): Promise<IdentityCapabilities> {
  try {
    const page = await listIdentities(req, 'group', '', 1, 1);
    const probe = page.identities[0];
    if (!probe) return { canReadGroupMembers: false };
    const result = await getGroupMembers(req, probe.id);
    return { canReadGroupMembers: result.canReadGroupMembers };
  } catch {
    return { canReadGroupMembers: false };
  }
}

export async function getGroupMembers(
  req: Request,
  groupId: string,
): Promise<{ members: DirectoryIdentity[]; canReadGroupMembers: boolean }> {
  if (!/^[0-9]+$/.test(groupId)) {
    throw new Error('group id must be numeric');
  }
  const headers = await authHeaders(req);
  const response = await fetch(
    `${workspaceHost()}/api/2.0/preview/scim/v2/Groups/${groupId}`,
    { headers },
  );
  if (response.status === 403) {
    return { members: [], canReadGroupMembers: false };
  }
  if (!response.ok) {
    throw new Error(`SCIM group lookup returned ${response.status}: ${await response.text()}`);
  }
  const body = (await response.json()) as ScimGroup;
  const members: DirectoryIdentity[] = [];
  for (const member of body.members ?? []) {
    const mapped = toMember(member);
    if (mapped) members.push(mapped);
    if (members.length >= 100) break;
  }
  return { members, canReadGroupMembers: true };
}

function scimCollection(kind: IdentityKind): string {
  switch (kind) {
    case 'group':
      return '/api/2.0/preview/scim/v2/Groups';
    case 'user':
      return '/api/2.0/preview/scim/v2/Users';
    case 'service_principal':
      return '/api/2.0/preview/scim/v2/ServicePrincipals';
  }
}

function scimFilter(kind: IdentityKind, search: string): string {
  const q = search.trim().replace(/"/g, '');
  if (q.length < 2) return '';
  const tokens = q.split(/\s+/).filter((token) => token.length >= 1);
  const andContains = (attr: string) =>
    tokens.map((token) => `${attr} co "${token}"`).join(' and ');
  if (kind === 'group') return andContains('displayName');
  if (kind === 'user') return `(${andContains('userName')}) or (${andContains('displayName')})`;
  return `(${andContains('displayName')}) or (${andContains('applicationId')})`;
}

function toIdentity(kind: IdentityKind, row: Record<string, unknown>): DirectoryIdentity {
  const id = String(row.id ?? '');
  if (kind === 'user') {
    const userName = String(row.userName ?? '');
    return {
      id,
      kind,
      displayName: String(row.displayName ?? userName),
      handle: userName,
    };
  }
  if (kind === 'service_principal') {
    const applicationId = String(row.applicationId ?? '');
    return {
      id,
      kind,
      displayName: String(row.displayName ?? applicationId),
      handle: applicationId,
    };
  }
  const displayName = String(row.displayName ?? '');
  return { id, kind, displayName, handle: displayName };
}

function toMember(member: NonNullable<ScimGroup['members']>[number]): DirectoryIdentity | null {
  const id = String(member.value ?? '');
  const displayName = String(member.display ?? id);
  const ref = String(member.$ref ?? member.type ?? '').toLowerCase();
  if (ref.includes('serviceprincipal')) {
    return { id, kind: 'service_principal', displayName, handle: displayName };
  }
  if (ref.includes('group')) {
    return { id, kind: 'group', displayName, handle: displayName };
  }
  return { id, kind: 'user', displayName, handle: displayName };
}

async function scimJson<T>(req: Request, path: string): Promise<T> {
  const headers = await authHeaders(req);
  const response = await fetch(`${workspaceHost()}${path}`, { headers });
  if (!response.ok) {
    throw new Error(`SCIM ${path} returned ${response.status}: ${await response.text()}`);
  }
  return (await response.json()) as T;
}

export { DEFAULT_COUNT };

import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  appAuthHeaders: vi.fn(
    () => Promise.resolve(new Headers({ Authorization: 'Bearer app-sp-token' })),
  ),
  executeStatement: vi.fn(() => Promise.resolve([] as unknown[][])),
}));

vi.mock('../lib/auth.js', () => ({
  appAuthHeaders: mocks.appAuthHeaders,
}));

vi.mock('../lib/statement-execution.js', () => ({
  executeStatement: mocks.executeStatement,
  sqlLiteral: (value: string) => value.split("'").join("''"),
  workspaceHost: () => 'https://workspace.example.com',
}));

import { getPermissionMap, principalsToQuery } from './permission-map.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('principalsToQuery', () => {
  it('keeps only the selected group, ignoring account-users conveyors', () => {
    expect(principalsToQuery('FinOps-team', 'group', ['account users', 'FinOps-team'])).toEqual([
      'FinOps-team',
    ]);
  });

  it('includes conveying groups for a user', () => {
    expect(principalsToQuery('lucas.porto@databricks.com', 'user', ['account users'])).toEqual([
      'lucas.porto@databricks.com',
      'account users',
    ]);
  });
});

describe('getPermissionMap', () => {
  it('uses app service-principal auth for effective permissions', async () => {
    const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(
      () => Promise.resolve(new Response(JSON.stringify({
        privilege_assignments: [{
          principal: 'FinOps-team',
          privileges: [{ privilege: 'USE_CATALOG' }],
        }],
      }), { status: 200 })),
    );
    vi.stubGlobal('fetch', fetchMock);

    const req = {
      headers: { 'x-forwarded-access-token': 'user-obo-token' },
    } as unknown as Request;
    const result = await getPermissionMap(
      req,
      'porto_catalog',
      'lucas.porto@databricks.com',
      'user',
    );

    expect(mocks.appAuthHeaders).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain(
      '/effective-permissions/catalog/porto_catalog?principal=lucas.porto%40databricks.com',
    );
    expect(init?.headers).toBeInstanceOf(Headers);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(result.errors).toEqual([]);
    expect(result.categories.catalog[0]).toMatchObject({
      fullName: 'porto_catalog',
      accessLevel: 'discover',
    });
  });
});

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

import { getDeclaredPermissionMap, getPermissionMap, principalsToQuery } from './permission-map.js';

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

describe('getDeclaredPermissionMap', () => {
  it('returns catalog grants from the Terraform manifest without calling UC', () => {
    const previous = process.env.DEMO_CATALOG;
    process.env.DEMO_CATALOG = 'porto_catalog';
    const result = getDeclaredPermissionMap(null, 'account users');
    process.env.DEMO_CATALOG = previous;
    expect(result.source).toBe('declared');
    expect(result.categories.catalog[0]).toMatchObject({
      fullName: 'porto_catalog',
    });
    expect(result.categories.catalog[0]?.privileges.map((grant) => grant.privilege)).toEqual(
      expect.arrayContaining(['SELECT', 'USE_CATALOG']),
    );
  });

  it('applies account-users catalog grants to a user who is not listed by name', () => {
    const previous = process.env.DEMO_CATALOG;
    process.env.DEMO_CATALOG = 'porto_catalog';
    const result = getDeclaredPermissionMap(
      'porto_catalog',
      'lucas.porto@databricks.com',
      'user',
    );
    process.env.DEMO_CATALOG = previous;
    expect(result.source).toBe('declared');
    expect(result.categories.catalog[0]).toMatchObject({ fullName: 'porto_catalog' });
    expect(result.categories.catalog[0]?.privileges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ privilege: 'SELECT', conveyedBy: 'account users' }),
        expect.objectContaining({ privilege: 'USE_CATALOG', conveyedBy: 'account users' }),
      ]),
    );
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
    expect(result.source).toBe('effective');
    expect(result.categories.catalog[0]).toMatchObject({
      fullName: 'porto_catalog',
      accessLevel: 'discover',
    });
    const sql = mocks.executeStatement.mock.calls.map(
      (call) => String((call as unknown as unknown[])[1]),
    );
    expect(sql.some((statement) => statement.includes('information_schema.tables'))).toBe(false);
    expect(sql.some((statement) => statement.includes('information_schema.schemata'))).toBe(true);
    expect(sql.some((statement) => statement.includes('information_schema.catalog_privileges'))).toBe(true);
  });

  it('shows schemas that inherit USE_SCHEMA from the catalog without listing every table', async () => {
    mocks.executeStatement.mockImplementation((...args: unknown[]) => {
      const sql = String(args[1] ?? '');
      if (sql.includes('schemata')) {
        return Promise.resolve([['dbdemos_pipeline_bike'], ['governance_app']]);
      }
      return Promise.resolve([]);
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify({
        privilege_assignments: [{
          principal: 'account users',
          privileges: [
            { privilege: 'USE_CATALOG' },
            { privilege: 'USE_SCHEMA' },
            { privilege: 'SELECT' },
          ],
        }],
      }), { status: 200 }))),
    );

    const result = await getPermissionMap(
      { headers: {} } as unknown as Request,
      'porto_catalog',
      'lucas.porto@databricks.com',
      'user',
    );

    expect(result.categories.schema.map((schema) => schema.fullName)).toEqual([
      'porto_catalog.dbdemos_pipeline_bike',
      'porto_catalog.governance_app',
    ]);
    expect(result.categories.schema[0]?.privileges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ privilege: 'USE_SCHEMA', conveyedBy: 'account users' }),
      ]),
    );
    expect(result.categories.table).toEqual([]);
  });
});

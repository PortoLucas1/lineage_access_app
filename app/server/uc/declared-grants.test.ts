import { describe, expect, it } from 'vitest';
import { parseDeclaredManifest, privilegesForTable } from './declared-grants.js';

describe('parseDeclaredManifest', () => {
  it('keeps the legacy principal-to-privileges catalog map', () => {
    const manifest = parseDeclaredManifest(
      { 'account users': ['SELECT', 'USE_CATALOG'] },
      null,
    );
    expect(manifest.catalog['account users']).toEqual(['SELECT', 'USE_CATALOG']);
    expect(manifest.tables).toEqual({});
  });

  it('reads catalog, schema, and table grants for the rides example', () => {
    const manifest = parseDeclaredManifest(
      {
        catalog: { 'account users': ['USE_CATALOG', 'SELECT'] },
        schemas: { dbdemos_pipeline_bike: { rides_analysts: ['USE_SCHEMA'] } },
        tables: {
          'dbdemos_pipeline_bike.rides': {
            'account users': ['SELECT'],
            rides_ops: ['SELECT', 'MODIFY'],
          },
        },
      },
      'terraform/declared-grants.json',
    );
    const rows = privilegesForTable(manifest, 'porto_catalog.dbdemos_pipeline_bike.rides');
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          principal: 'account users',
          privilege: 'SELECT',
          inheritedFromType: 'TABLE',
        }),
        expect.objectContaining({
          principal: 'rides_ops',
          privilege: 'MODIFY',
          inheritedFromType: 'TABLE',
        }),
        expect.objectContaining({
          principal: 'rides_analysts',
          privilege: 'USE_SCHEMA',
          inheritedFromType: 'SCHEMA',
        }),
      ]),
    );
  });
});

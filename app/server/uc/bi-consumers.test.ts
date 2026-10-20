import { describe, expect, it } from 'vitest';
import { grantRowsFromWorkspaceAcl, lakeviewDisplayName, tableMatches } from './bi-consumers.js';

describe('tableMatches', () => {
  it('matches a full three-level name', () => {
    expect(tableMatches('main.ops.rides', 'main.ops.rides')).toBe(true);
  });

  it('matches a leaf-name wildcard used for tenant-agnostic overlays', () => {
    expect(tableMatches('acme_catalog.bike.rides', '*.rides')).toBe(true);
    expect(tableMatches('acme_catalog.bike.stations', '*.rides')).toBe(false);
  });
});

describe('grantRowsFromWorkspaceAcl', () => {
  it('maps users, groups, and inherited folder permissions', () => {
    const rows = grantRowsFromWorkspaceAcl(
      'bi:dbsql_dashboard:dash-1',
      'Bike Insights',
      'dbsql_dashboard',
      [
        {
          group_name: 'users',
          all_permissions: [{
            permission_level: 'CAN_READ',
            inherited: true,
            inherited_from_object: ['/directories/'],
          }],
        },
        {
          user_name: 'marc.pretorius@databricks.com',
          display_name: 'Marc Pretorius',
          all_permissions: [{
            permission_level: 'CAN_MANAGE',
            inherited: true,
            inherited_from_object: ['/directories/2087788579799729'],
          }],
        },
        {
          user_name: 'owner@databricks.com',
          display_name: 'Owner',
          all_permissions: [{ permission_level: 'CAN_MANAGE', inherited: false }],
        },
      ],
    );
    expect(rows).toHaveLength(3);
    expect(rows.find((row) => row.principal === 'users')).toMatchObject({
      principalType: 'group',
      privilege: 'CAN_READ',
      inheritedFromType: 'DIRECTORY',
      inheritedFromName: '/directories/',
    });
    expect(rows.find((row) => row.principal === 'marc.pretorius@databricks.com')).toMatchObject({
      displayName: 'Marc Pretorius',
      privilege: 'CAN_MANAGE',
    });
    expect(rows.find((row) => row.principal === 'owner@databricks.com')?.inheritedFromName).toBeNull();
  });
});

describe('lakeviewDisplayName', () => {
  it('reads snake_case and camelCase display names', () => {
    expect(lakeviewDisplayName({ display_name: '[dbdemos] Bike Insights' })).toBe('[dbdemos] Bike Insights');
    expect(lakeviewDisplayName({ displayName: 'Bike Insights' })).toBe('Bike Insights');
    expect(lakeviewDisplayName({ display_name: '  ' })).toBeNull();
    expect(lakeviewDisplayName({})).toBeNull();
  });
});
